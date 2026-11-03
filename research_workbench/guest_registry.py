"""Persistent, password-free guest data spaces.

The registry stores a stable server-generated workspace UUID and the SHA-256
digests of the browser bearer secret and optional recovery code.  A guest is an
unverified, bearer-controlled data space; it is deliberately not a user account,
an authenticated actor, a login or a password table.

This module owns identity/storage layout only.  The ASGI gateway in
``guest_gateway`` maps the cookie to a child application and enforces access.
"""
from __future__ import annotations

from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import threading
import time
from uuid import uuid4

COOKIE_NAME = '__Host-rw_guest'
COOKIE_MAX_AGE = 31536000
# A non-credential continuity marker.  It is never accepted as access and is
# never stored by the registry; it only lets GET / notice that this browser had
# a guest space whose credential cookie has expired or been revoked.
HINT_COOKIE_NAME = '__Host-rw_guest_hint'
HINT_MAX_AGE = COOKIE_MAX_AGE * 2
TOKEN_BYTES = 32
TOKEN_PATTERN = re.compile(r'^[0-9a-f]{64}$')
UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
MAX_SPACES = 32
RECOVERY_WINDOW = 60.0
RECOVERY_MAX_FAILURES = 20
# Bump when the on-disk registry shape changes.
SCHEMA_VERSION = 2
# Tolerated clock drift for a persisted session issue timestamp.
SESSION_CLOCK_SKEW = 300.0
FILE_ATTRIBUTE_REPARSE_POINT = 0x400

SCHEMA = '''
CREATE TABLE IF NOT EXISTS guests (
 guest_id TEXT PRIMARY KEY,
 session_digest TEXT NOT NULL UNIQUE,
 recovery_digest TEXT UNIQUE,
 recovery_generation INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 last_seen_at TEXT NOT NULL,
 session_issued_at TEXT NOT NULL,
 CHECK(length(guest_id)=36),
 CHECK(length(session_digest)=64),
 CHECK(recovery_digest IS NULL OR length(recovery_digest)=64)
);
'''


class GuestRegistryError(Exception):
    """Base class for guest registry failures."""


class GuestCapacityError(GuestRegistryError):
    """The configured persistent-space cap is exhausted."""


class GuestNotFound(GuestRegistryError):
    """No guest matches the supplied credential."""


class GuestStorageError(GuestRegistryError):
    """The registry or a guest directory cannot be used."""


class GuestSecurityError(GuestRegistryError):
    """The configured path or a space directory is unsafe."""


class RecoveryRateLimited(GuestRegistryError):
    """Too many failed recovery-code attempts in the bounded window."""


@dataclass(frozen=True)
class IssuedSession:
    guest_id: str
    token: str


@dataclass(frozen=True)
class GuestSpace:
    guest_id: str
    root: Path


def new_bearer_token():
    return secrets.token_hex(TOKEN_BYTES)


def new_recovery_code():
    # 32 random bytes -> 256 bits; URL-safe so copy/paste stays unambiguous.
    return secrets.token_urlsafe(TOKEN_BYTES)


def digest_secret(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def utc_timestamp():
    return datetime.now(timezone.utc).isoformat()


def _parse_session_timestamp(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        issued = datetime.fromisoformat(value)
    except ValueError:
        return None
    if issued.tzinfo is None:
        # The registry always writes timezone-aware UTC values; a naive value
        # is malformed rather than silently treated as local time.
        return None
    return issued.astimezone(timezone.utc)


def session_expired(value, now=None):
    """Server-side session age check.

    Cookie ``Max-Age`` only asks the browser to forget a value; a copied cookie
    survives client retention indefinitely.  The registry therefore persists
    the issue time and rejects anything older than ``COOKIE_MAX_AGE``.  Missing
    or malformed values, and values implausibly far in the future, are also
    rejected.  Rejection never deletes the saved space; recovery is still
    possible with the recovery code.
    """
    issued = _parse_session_timestamp(value)
    if issued is None:
        return True
    current = now or datetime.now(timezone.utc)
    age = (current - issued).total_seconds()
    if age < -SESSION_CLOCK_SKEW:
        return True
    return age > COOKIE_MAX_AGE


def _posix():
    return os.name == 'posix'


def _same_location(path):
    """True when path does not resolve through a symlink/junction redirect."""
    try:
        resolved = path.resolve()
    except OSError as error:
        raise GuestStorageError('guest_storage_unavailable') from error
    return (os.path.normcase(os.path.abspath(os.fspath(resolved)))
            == os.path.normcase(os.path.abspath(os.fspath(path))))


def _is_reparse_point(path):
    """True for a symlink, Windows junction or any other reparse directory."""
    try:
        info = os.lstat(path)
    except OSError:
        return False
    if stat.S_ISLNK(info.st_mode):
        return True
    if os.name == 'nt':
        return bool(getattr(info, 'st_file_attributes', 0)
                    & FILE_ATTRIBUTE_REPARSE_POINT)
    return False


def _absolute_chain(path):
    """Absolute components of ``path`` from the filesystem root downwards.

    The walk deliberately does not call ``resolve()``: resolving first would
    hide the very symlink/junction we must observe and reject.
    """
    absolute = Path(os.path.abspath(os.fspath(path)))
    chain = [absolute, *absolute.parents]
    chain.reverse()
    return chain


def _assert_safe_ancestors(path):
    """Validate every existing component before the caller creates anything.

    Symlinks/junctions anywhere at or above ``path`` are rejected, as are
    non-directory components.  On POSIX, a non-sticky group/other-writable
    ancestor is rejected; sticky shared directories (for example /tmp) remain
    usable because other local users cannot remove entries they do not own.
    """
    for current in _absolute_chain(path):
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            # A component that does not exist yet cannot be a redirect.  The
            # caller re-runs this check after creation to catch races.
            continue
        except OSError as error:
            raise GuestStorageError('guest_storage_unavailable') from error
        if stat.S_ISLNK(info.st_mode) or (
                os.name == 'nt' and getattr(info, 'st_file_attributes', 0)
                & FILE_ATTRIBUTE_REPARSE_POINT):
            raise GuestSecurityError('guest_path_symlink')
        if not stat.S_ISDIR(info.st_mode):
            raise GuestSecurityError('guest_path_invalid')
        if _posix() and info.st_mode & 0o022 and not info.st_mode & 0o1000:
            raise GuestSecurityError('guest_root_insecure')


def _ensure_private_directory(path):
    # Refuse an ancestor symlink/junction *before* mkdir/chmod.  This ordering
    # is the security property: a redirected configured root must never be
    # created or tightened through the redirect.
    _assert_safe_ancestors(path)
    if path.exists():
        if _is_reparse_point(path) or not path.is_dir():
            raise GuestSecurityError('guest_path_invalid')
    else:
        try:
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
        except OSError as error:
            raise GuestStorageError('guest_storage_unavailable') from error
    # Re-walk after creation so a racing redirect is still caught before use.
    _assert_safe_ancestors(path)
    if _is_reparse_point(path) or not path.is_dir():
        raise GuestSecurityError('guest_path_invalid')
    if not _same_location(path):
        raise GuestSecurityError('guest_path_symlink')
    if _posix():
        try:
            os.chmod(path, 0o700)
        except OSError as error:
            raise GuestStorageError('guest_storage_unavailable') from error


class GuestRegistry:
    """Bounded SQLite registry for opaque guest data spaces."""

    def __init__(self, root, max_spaces=MAX_SPACES):
        if isinstance(max_spaces, bool) or not isinstance(max_spaces, int):
            raise ValueError('max_spaces must be an integer')
        if not 1 <= max_spaces <= MAX_SPACES:
            raise ValueError(f'max_spaces must be between 1 and {MAX_SPACES}')
        if root is None or not str(root).strip():
            raise GuestSecurityError('guest_root_required')
        value = Path(os.path.abspath(os.path.expanduser(os.fspath(root))))
        if value == Path(value.anchor):
            raise GuestSecurityError('guest_root_invalid')
        self.max_spaces = max_spaces
        self._lock = threading.RLock()
        self._recovery_failures = deque(maxlen=RECOVERY_MAX_FAILURES * 2)
        _ensure_private_directory(value)
        self.root = value
        self.spaces = value / 'spaces'
        _ensure_private_directory(self.spaces)
        self.database = value / 'registry.sqlite3'
        if self.database.is_symlink():
            raise GuestSecurityError('registry_symlink')
        self._initialize()

    # ------------------------------------------------------------- connection
    @contextmanager
    def _connection(self):
        if self.database.is_symlink():
            raise GuestSecurityError('registry_symlink')
        if self.database.exists() and not _same_location(self.database):
            raise GuestSecurityError('registry_symlink')
        try:
            connection = sqlite3.connect(
                self.database, timeout=10, isolation_level=None)
        except sqlite3.Error as error:
            raise GuestStorageError('registry_unavailable') from error
        try:
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA busy_timeout=10000')
            connection.execute('PRAGMA foreign_keys=ON')
            if _posix():
                try:
                    os.chmod(self.database, 0o600)
                except OSError:
                    pass
            yield connection
        finally:
            connection.close()

    def _initialize(self):
        try:
            with self._connection() as connection:
                version = connection.execute('PRAGMA user_version').fetchone()[0]
                if version > SCHEMA_VERSION:
                    raise GuestStorageError('registry_requires_newer_application')
                connection.executescript(SCHEMA)
                columns = {row['name'] for row in connection.execute(
                    'PRAGMA table_info(guests)')}
                if 'session_issued_at' not in columns:
                    # Version 1 rows only recorded creation/last-seen times.
                    # Backfill from created_at so an old cookie ages from its
                    # real issue time instead of becoming valid forever.
                    connection.execute(
                        "ALTER TABLE guests ADD COLUMN session_issued_at TEXT "
                        "NOT NULL DEFAULT ''")
                connection.execute(
                    "UPDATE guests SET session_issued_at=created_at "
                    "WHERE session_issued_at IS NULL OR session_issued_at=''")
                connection.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
        except sqlite3.Error as error:
            raise GuestStorageError('registry_unavailable') from error

    # ------------------------------------------------------------- path rules
    def space_root(self, guest_id):
        if not isinstance(guest_id, str) or not UUID_PATTERN.fullmatch(guest_id):
            raise GuestSecurityError('guest_id_invalid')
        path = self.spaces / guest_id
        if path.parent != self.spaces:
            raise GuestSecurityError('guest_path_invalid')
        _assert_safe_ancestors(path.parent)
        if _is_reparse_point(path):
            raise GuestSecurityError('guest_path_symlink')
        if path.exists() and not _same_location(path):
            raise GuestSecurityError('guest_path_symlink')
        try:
            if path.parent.resolve() != self.spaces.resolve():
                raise GuestSecurityError('guest_path_invalid')
        except OSError as error:
            raise GuestStorageError('guest_storage_unavailable') from error
        return path

    def _remove_empty_allocation(self, path, guest_id):
        """Remove only a freshly allocated, completely empty space directory.

        Returns ``True`` when nothing is left to remove.  A directory that
        contains any entry is left untouched and reported as ``False`` so the
        caller keeps the registry row and the capacity occupied.  Recursive
        deletion is never used because it could erase saved research data after
        an unrelated failure.
        """
        try:
            expected = self.spaces.resolve() / guest_id
            actual = path.resolve()
        except OSError as error:
            raise GuestStorageError('guest_storage_unavailable') from error
        if (os.path.normcase(os.path.abspath(os.fspath(actual)))
                != os.path.normcase(os.path.abspath(os.fspath(expected)))):
            # The resolved target is not the space we allocated; do nothing.
            return False
        if _is_reparse_point(path):
            return False
        if not path.exists():
            return True
        if not path.is_dir():
            return False
        try:
            if any(path.iterdir()):
                return False
            path.rmdir()
        except OSError:
            return False
        return True

    # --------------------------------------------------------------- issuance
    def create(self):
        """Allocate one persistent space.  The cookie is issued by the gateway."""
        with self._lock:
            guest_id = str(uuid4())
            token = new_bearer_token()
            session_digest = digest_secret(token)
            stamp = utc_timestamp()
            path = self.space_root(guest_id)
            if path.exists() or path.is_symlink():
                raise GuestStorageError('guest_space_exists')
            created = False
            try:
                with self._connection() as connection:
                    connection.execute('BEGIN IMMEDIATE')
                    try:
                        count = connection.execute(
                            'SELECT COUNT(*) FROM guests').fetchone()[0]
                        if count >= self.max_spaces:
                            raise GuestCapacityError('guest_capacity_full')
                        try:
                            path.mkdir(mode=0o700)
                            created = True
                            if _posix():
                                os.chmod(path, 0o700)
                        except OSError as error:
                            raise GuestStorageError('guest_storage_unavailable') from error
                        connection.execute(
                            'INSERT INTO guests (guest_id,session_digest,recovery_digest,'
                            'recovery_generation,created_at,last_seen_at,session_issued_at) '
                            'VALUES (?,?,NULL,0,?,?,?)',
                            (guest_id, session_digest, stamp, stamp, stamp))
                        connection.execute('COMMIT')
                    except BaseException:
                        try:
                            connection.execute('ROLLBACK')
                        except sqlite3.Error:
                            pass
                        if created:
                            # Only the empty directory just allocated may be
                            # removed.  Never recurse, never touch saved data.
                            try:
                                self._remove_empty_allocation(path, guest_id)
                            except GuestRegistryError:
                                pass
                        raise
            except sqlite3.IntegrityError as error:
                raise GuestStorageError('guest_credential_collision') from error
            except sqlite3.Error as error:
                raise GuestStorageError('registry_unavailable') from error
            return IssuedSession(guest_id, token)

    def lookup(self, token):
        if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
            return None
        digest = digest_secret(token)
        try:
            with self._connection() as connection:
                row = connection.execute(
                    'SELECT guest_id,session_issued_at FROM guests '
                    'WHERE session_digest=?', (digest,)).fetchone()
        except sqlite3.Error as error:
            raise GuestStorageError('registry_unavailable') from error
        if row is None:
            return None
        # Server-side expiry: a retained cookie must not outlive the issuance
        # window even when the browser still presents it.  Do not update
        # last_seen_at or session_issued_at here, and never delete the space;
        # the recovery code remains the only way back in.
        if session_expired(row['session_issued_at']):
            return None
        return GuestSpace(row['guest_id'], self.space_root(row['guest_id']))

    def issue_recovery(self, guest_id):
        """Create or rotate the recovery code; only its digest is stored."""
        with self._lock:
            code = new_recovery_code()
            digest = digest_secret(code)
            stamp = utc_timestamp()
            try:
                with self._connection() as connection:
                    connection.execute('BEGIN IMMEDIATE')
                    try:
                        row = connection.execute(
                            'SELECT guest_id FROM guests WHERE guest_id=?',
                            (guest_id,)).fetchone()
                        if row is None:
                            raise GuestNotFound('guest_not_found')
                        path = self.space_root(guest_id)
                        if not path.is_dir() or path.is_symlink():
                            raise GuestStorageError('guest_storage_unavailable')
                        connection.execute(
                            'UPDATE guests SET recovery_digest=?,'
                            'recovery_generation=recovery_generation+1,'
                            'last_seen_at=? WHERE guest_id=?',
                            (digest, stamp, guest_id))
                        connection.execute('COMMIT')
                    except BaseException:
                        try:
                            connection.execute('ROLLBACK')
                        except sqlite3.Error:
                            pass
                        raise
            except sqlite3.IntegrityError as error:
                raise GuestStorageError('guest_credential_collision') from error
            except sqlite3.Error as error:
                raise GuestStorageError('registry_unavailable') from error
            return code

    def redeem(self, code):
        """Validate and consume a recovery code, rotating the session secret.

        Returns ``None`` for an unknown code.  A successful redemption revokes
        the previous browser cookie (the old token digest no longer matches) and
        consumes the code so replay fails.  It never deletes or merges spaces.
        """
        with self._lock:
            now = time.monotonic()
            while (self._recovery_failures
                   and now - self._recovery_failures[0] > RECOVERY_WINDOW):
                self._recovery_failures.popleft()
            if len(self._recovery_failures) >= RECOVERY_MAX_FAILURES:
                raise RecoveryRateLimited('recovery_rate_limited')
            digest = digest_secret(code)
            token = new_bearer_token()
            session_digest = digest_secret(token)
            stamp = utc_timestamp()
            try:
                with self._connection() as connection:
                    connection.execute('BEGIN IMMEDIATE')
                    try:
                        row = connection.execute(
                            'SELECT guest_id FROM guests WHERE recovery_digest=?',
                            (digest,)).fetchone()
                        if row is None:
                            connection.execute('ROLLBACK')
                            self._recovery_failures.append(now)
                            return None
                        guest_id = row['guest_id']
                        path = self.space_root(guest_id)
                        if not path.is_dir() or path.is_symlink():
                            raise GuestStorageError('guest_storage_unavailable')
                        connection.execute(
                            'UPDATE guests SET session_digest=?,recovery_digest=NULL,'
                            'recovery_generation=recovery_generation+1,'
                            'last_seen_at=?,session_issued_at=? WHERE guest_id=?',
                            (session_digest, stamp, stamp, guest_id))
                        connection.execute('COMMIT')
                    except BaseException:
                        try:
                            connection.execute('ROLLBACK')
                        except sqlite3.Error:
                            pass
                        raise
            except sqlite3.IntegrityError as error:
                raise GuestStorageError('guest_credential_collision') from error
            except sqlite3.Error as error:
                raise GuestStorageError('registry_unavailable') from error
            self._recovery_failures.clear()
            return IssuedSession(guest_id, token)

    # ----------------------------------------------------------- bookkeeping
    def space_ready(self, guest_id):
        try:
            path = self.space_root(guest_id)
        except GuestSecurityError:
            return False
        return path.is_dir() and not _is_reparse_point(path)

    def count(self):
        try:
            with self._connection() as connection:
                return connection.execute(
                    'SELECT COUNT(*) FROM guests').fetchone()[0]
        except sqlite3.Error as error:
            raise GuestStorageError('registry_unavailable') from error

    def discard(self, guest_id):
        """Remove a just-allocated space whose cookie was never issued.

        The gateway calls this only when child creation fails before any
        response or cookie is sent.  It is never used for saved research data.

        Only a completely empty directory is removed, using ``rmdir`` after
        comparing resolved absolute targets.  If even one entry exists, nothing
        is deleted and the row is kept so the space stays capacity-accounted
        rather than being silently orphaned.
        """
        if not isinstance(guest_id, str) or not UUID_PATTERN.fullmatch(guest_id):
            return False
        with self._lock:
            path = self.space_root(guest_id)
            if not self._remove_empty_allocation(path, guest_id):
                return False
            try:
                with self._connection() as connection:
                    connection.execute('BEGIN IMMEDIATE')
                    try:
                        connection.execute(
                            'DELETE FROM guests WHERE guest_id=?', (guest_id,))
                        connection.execute('COMMIT')
                    except BaseException:
                        try:
                            connection.execute('ROLLBACK')
                        except sqlite3.Error:
                            pass
                        raise
            except sqlite3.Error as error:
                raise GuestStorageError('registry_unavailable') from error
            return True
