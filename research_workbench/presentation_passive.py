"""Read-only facade over an existing guest workspace for paper presentations.

This module never initializes, migrates, backfills, purges or resumes anything.
It opens the registry and workspace SQLite files with ``mode=ro`` (not
``immutable=1`` so a live WAL stays visible), verifies the exact expected schema
first, and reuses the existing ancestor/reparse/location checks.  The only
directory it may create is a companion-owned temporary export directory inside
an already verified ``exports`` directory; no other write can happen through
these objects.

It deliberately does not use ``GuestRegistry.__init__`` or ``Store.__init__``:
both of those initialize/migrate and may resume purge work.  The passive
initializers below keep only the attributes the reused read methods need.
"""
from __future__ import annotations

from collections import deque
from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
import tempfile
import threading

from .analyses import Analyses
from . import datasets as datasets_module
from .datasets import Datasets
from .guest_registry import (
    MAX_SPACES, RECOVERY_MAX_FAILURES,
    SCHEMA_VERSION as REGISTRY_SCHEMA_VERSION, GuestRegistry, GuestSecurityError,
    GuestStorageError, _assert_safe_ancestors, _is_reparse_point, _same_location)
from .library import Library
from .note_lifecycle import NoteLifecycle
from .store import Store

# Exact workspace schema this companion understands.  Older or newer layouts
# are refused instead of being read partially.
WORKSPACE_SCHEMA_VERSION = 29
REGISTRY_TABLES = frozenset({'guests'})
REGISTRY_COLUMNS = frozenset({
    'guest_id', 'session_digest', 'recovery_digest', 'recovery_generation',
    'created_at', 'last_seen_at', 'session_issued_at'})
REQUIRED_WORKSPACE_TABLES = frozenset({
    'documents', 'document_metadata', 'document_trash', 'document_purges',
    'purged_notes', 'notes', 'note_states', 'note_rich_content',
    'study_note_sources', 'note_text_annotations', 'note_shape_annotations',
    'note_source_segments', 'note_mastery', 'datasets', 'analysis_jobs',
    'charts', 'chart_skills', 'chart_skill_versions'})
SQLITE_TIMEOUT = 10
EXPORT_PREFIX = 'presentation-companion-'


def _absolute(value):
    return Path(os.path.abspath(os.path.expanduser(os.fspath(value))))


def _existing_directory(path):
    """Verify an existing real directory without creating or tightening it."""
    _assert_safe_ancestors(path)
    if _is_reparse_point(path) or not path.is_dir():
        raise GuestSecurityError('guest_path_invalid')
    if not _same_location(path):
        raise GuestSecurityError('guest_path_symlink')


def _optional_directory(path):
    """A workspace subdirectory may be absent; if present it must be real."""
    _assert_safe_ancestors(path)
    if _is_reparse_point(path):
        raise GuestSecurityError('guest_path_symlink')
    if not path.exists():
        return
    if not path.is_dir():
        raise GuestSecurityError('guest_path_invalid')
    if not _same_location(path):
        raise GuestSecurityError('guest_path_symlink')


def _existing_file(path):
    _assert_safe_ancestors(path.parent)
    if path.is_symlink() or _is_reparse_point(path) or not path.is_file():
        raise GuestStorageError('workspace_unavailable')
    if not _same_location(path):
        raise GuestSecurityError('guest_path_symlink')


def _readonly_uri(database):
    return database.as_uri() + '?mode=ro'


class PassiveRegistry(GuestRegistry):
    """``GuestRegistry`` read methods over an already initialized registry.

    ``__init__`` intentionally skips ``super().__init__``: no directory is
    created, no schema is applied and no migration/backfill runs.  ``lookup``
    and ``space_root`` are the inherited, audited implementations and now use
    the read-only connection below.
    """

    def __init__(self, root):
        if root is None or not str(root).strip():
            raise GuestSecurityError('guest_root_required')
        value = _absolute(root)
        if value == Path(value.anchor):
            raise GuestSecurityError('guest_root_invalid')
        self.max_spaces = MAX_SPACES
        self._lock = threading.RLock()
        self._recovery_failures = deque(maxlen=RECOVERY_MAX_FAILURES * 2)
        self.root = value
        self.spaces = value / 'spaces'
        self.database = value / 'registry.sqlite3'
        self._verify()

    def _verify(self):
        _existing_directory(self.root)
        _existing_directory(self.spaces)
        _existing_file(self.database)
        if self.database.is_symlink():
            raise GuestSecurityError('registry_symlink')
        try:
            with self._connection() as connection:
                version = connection.execute('PRAGMA user_version').fetchone()[0]
                if version != REGISTRY_SCHEMA_VERSION:
                    raise GuestStorageError('registry_schema_mismatch')
                tables = {row['name'] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'")}
                if not REGISTRY_TABLES.issubset(tables):
                    raise GuestStorageError('registry_schema_mismatch')
                columns = {row['name'] for row in connection.execute(
                    'PRAGMA table_info(guests)')}
                if columns != REGISTRY_COLUMNS:
                    raise GuestStorageError('registry_schema_mismatch')
        except sqlite3.Error as error:
            raise GuestStorageError('registry_unavailable') from error

    @contextmanager
    def _connection(self):
        # Re-run the complete ancestor/reparse/location validation on every
        # open, exactly like the audited GuestRegistry: an ancestor swapped to a
        # symlink or junction after startup must fail closed *before* any SQLite
        # file is opened through the redirect.
        _existing_file(self.database)
        try:
            connection = sqlite3.connect(
                _readonly_uri(self.database), uri=True, timeout=SQLITE_TIMEOUT)
        except sqlite3.Error as error:
            raise GuestStorageError('registry_unavailable') from error
        try:
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA busy_timeout=10000')
            connection.execute('PRAGMA foreign_keys=ON')
            yield connection
        finally:
            connection.close()


class PresentationReadStore(Store):
    """``Store`` read methods without running ``Store.__init__``.

    The workspace database is opened ``mode=ro`` with a thread-local nested
    connection, exactly like the writable Store.  ``lifecycle`` and ``library``
    are the only collaborators constructed, and both are read-only here.
    """

    def __init__(self, root):
        self._connections = threading.local()
        self.root = _absolute(root)
        _existing_directory(self.root)
        self.files = self.root / 'documents'
        _existing_directory(self.files)
        self.incoming = self.root / 'incoming'
        _existing_directory(self.incoming)
        self.excerpts = self.root / 'excerpts'
        _existing_directory(self.excerpts)
        self._exports_root = self.root / 'exports'
        _existing_directory(self._exports_root)
        self.database = self.root / 'workspace.sqlite3'
        _existing_file(self.database)
        self._exports = None
        self._exports_lock = threading.Lock()
        self._verify_schema()
        self.lifecycle = NoteLifecycle(self)
        self.library = Library(self)

    def _verify_schema(self):
        with self.connection() as connection:
            version = connection.execute('PRAGMA user_version').fetchone()[0]
            if version != WORKSPACE_SCHEMA_VERSION:
                raise GuestStorageError('workspace_schema_mismatch')
            tables = {row['name'] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            if not REQUIRED_WORKSPACE_TABLES.issubset(tables):
                raise GuestStorageError('workspace_schema_mismatch')

    @contextmanager
    def connection(self):
        current = getattr(self._connections, 'current', None)
        if current is not None:
            yield current
            return
        if (_is_reparse_point(self.database) or not self.database.is_file()
                or not _same_location(self.database)):
            raise GuestStorageError('workspace_unavailable')
        try:
            connection = sqlite3.connect(
                _readonly_uri(self.database), uri=True, timeout=SQLITE_TIMEOUT)
        except sqlite3.Error as error:
            raise GuestStorageError('workspace_unavailable') from error
        connection.row_factory = sqlite3.Row
        try:
            connection.execute('PRAGMA busy_timeout=10000')
            connection.execute('PRAGMA foreign_keys=ON')
        except sqlite3.Error:
            connection.close()
            raise
        self._connections.current = connection
        try:
            yield connection
        finally:
            self._connections.current = None
            connection.close()

    @property
    def exports(self):
        """A lazily created, companion-owned directory inside guest exports."""
        with self._exports_lock:
            if self._exports is None:
                self._exports = self._create_export_directory()
            return self._exports

    def _create_export_directory(self):
        _existing_directory(self._exports_root)
        try:
            path = Path(tempfile.mkdtemp(prefix=EXPORT_PREFIX,
                                         dir=self._exports_root))
        except OSError as error:
            raise GuestStorageError('workspace_unavailable') from error
        _assert_safe_ancestors(path)
        if _is_reparse_point(path) or not path.is_dir():
            raise GuestSecurityError('guest_path_invalid')
        if not _same_location(path):
            raise GuestSecurityError('guest_path_symlink')
        if path.parent != self._exports_root:
            raise GuestSecurityError('guest_path_invalid')
        return path


class PassiveDatasets(Datasets):
    """``Datasets`` with its read attributes but no directory creation."""

    def __init__(self, store, timeout=8):
        self.store = store
        self.root = store.root / 'datasets'
        _optional_directory(self.root)
        self.timeout = timeout
        self.probe = Path(datasets_module.__file__).with_name('tabular.py')
        self.capacity = threading.BoundedSemaphore(2)


class PassiveAnalyses(Analyses):
    """``Analyses`` read view: no catalog probe, no supervisor, no mkdir."""

    def __init__(self, store, datasets):
        self.store, self.datasets, self.catalog = store, datasets, None
        self.root = store.root / 'analyses'
        _optional_directory(self.root)
        self.supervisor = None


__all__ = ['PassiveRegistry', 'PresentationReadStore', 'PassiveDatasets',
           'PassiveAnalyses', 'WORKSPACE_SCHEMA_VERSION']
