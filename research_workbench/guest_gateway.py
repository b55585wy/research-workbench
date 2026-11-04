"""Opt-in public guest gateway: isolated child applications per data space.

The owner application created by ``main.create_app`` stays a single-tenant,
single-Store process.  This module is an optional outer ASGI application that
maps an opaque bearer cookie to a *separate* child ``create_app`` bound to that
guest's own data root.  It never selects a Store through a client-supplied
document/project ID and never mutates shared ``app.state`` to switch tenants.

The bearer is an unverified data-space credential, not a login.  The registry
keeps a stable workspace UUID for future explicit verified identity binding;
no registration, claim or password API is introduced here.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from . import __version__
from .agent_provider import ModelConnection
from .guest_registry import (
    COOKIE_MAX_AGE, COOKIE_NAME, HINT_COOKIE_NAME, HINT_MAX_AGE, MAX_SPACES,
    TOKEN_PATTERN, GuestCapacityError, GuestNotFound, GuestRegistry,
    GuestRegistryError, GuestSecurityError, GuestSpace, GuestStorageError,
    IssuedSession, RecoveryRateLimited, new_bearer_token)
from .main import LocalBoundary, ROOT, create_app
from .models import WorkspaceError

GUEST_MODEL_HOST = 'api.deepseek.com'
GUEST_MODEL_PATHS = ('', '/v1')
MAX_ACTIVE_CHILDREN = 2
ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']


class GuestBusy(Exception):
    """No child slot can be made without interrupting another guest."""


class _ApiNoStore:
    """Mark every API response no-store, including outer boundary rejections."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path = scope.get('path', '')
        if path != '/api' and not path.startswith('/api/'):
            return await self.app(scope, receive, send)

        async def wrapped_send(message):
            if message['type'] == 'http.response.start':
                headers = message.setdefault('headers', [])
                if not any(key.lower() == b'cache-control' for key, _ in headers):
                    headers.append((b'cache-control', b'no-store'))
                if not any(key.lower() == b'pragma' for key, _ in headers):
                    headers.append((b'pragma', b'no-cache'))
            await send(message)

        await self.app(scope, receive, wrapped_send)


class GuestModelConnection(ModelConnection):
    """Per-guest model connection with an explicit public-guest endpoint policy.

    Public guests may use the DeepSeek official endpoint only.  The check runs
    both when saving a connection and when resolving an existing configuration,
    so a config file that predates or bypasses the API is not used.  The owner
    process keeps the original unrestricted ``ModelConnection`` behaviour.
    """

    def __init__(self, root):
        # Never inherit the owner's agent config or credentials.
        super().__init__(root, None)

    @staticmethod
    def validate(config):
        ModelConnection.validate(config)
        raw = str(config.get('base_url', '')).strip()
        try:
            url = urlsplit(raw)
            valid = (
                url.scheme == 'https'
                and url.hostname == GUEST_MODEL_HOST
                and url.port is None
                and not url.username
                and not url.password
                and not url.query
                and not url.fragment
                and url.path in GUEST_MODEL_PATHS
                and raw == f'https://{GUEST_MODEL_HOST}{url.path}')
        except ValueError:
            valid = False
        if not valid:
            raise WorkspaceError(
                'agent_endpoint_not_allowed',
                '公共访客模式仅支持 DeepSeek 官方模型地址。', 422)

    def config(self):
        if self.path.is_symlink():
            return {}, 'none'
        try:
            config, source = super().config()
        except Exception:
            return {}, 'none'
        if not config:
            return {}, 'none'
        try:
            self.validate(config)
        except Exception:
            # Malformed or non-official existing configuration is unusable
            # rather than being trusted or silently rewritten.
            return {}, 'none'
        return config, source


# --------------------------------------------------------------------- cookies
def read_guest_cookie(raw_headers):
    """Strictly parse the credential cookie.

    Returns ``(present, token, problem)``.  Duplicate credential cookies and
    malformed credential values are rejected instead of being resolved to an
    ambiguous token.  Unrelated cookies are ignored.
    """
    values = []
    for key, value in raw_headers:
        if key.lower() != b'cookie':
            continue
        try:
            decoded = value.decode('latin-1')
        except UnicodeDecodeError:
            return True, None, 'malformed'
        for part in decoded.split(';'):
            part = part.strip()
            if not part or '=' not in part:
                continue
            name, _, token = part.partition('=')
            if name.strip() == COOKIE_NAME:
                values.append(token)
    if len(values) > 1:
        return True, None, 'duplicate'
    if not values:
        return False, None, None
    token = values[0]
    if not TOKEN_PATTERN.fullmatch(token):
        return True, None, 'malformed'
    return True, token, None


def _cookie_header(token):
    return (f'{COOKIE_NAME}={token}; Path=/; Max-Age={COOKIE_MAX_AGE}; '
            f'HttpOnly; Secure; SameSite=Lax')


def _hint_header():
    return (f'{HINT_COOKIE_NAME}={new_bearer_token()}; Path=/; '
            f'Max-Age={HINT_MAX_AGE}; HttpOnly; Secure; SameSite=Lax')


def read_guest_hint(raw_headers):
    """Return whether this browser carries the non-credential continuity marker.

    The value is never used for access or routing.  It only prevents GET / from
    silently creating a new empty space when the credential cookie is gone.
    """
    for key, value in raw_headers:
        if key.lower() != b'cookie':
            continue
        decoded = value.decode('latin-1', 'replace')
        for part in decoded.split(';'):
            name, separator, token = part.strip().partition('=')
            if separator and name.strip() == HINT_COOKIE_NAME and token.strip():
                return True
    return False


def _set_cookie(response, token):
    response.set_cookie(
        COOKIE_NAME, token, max_age=COOKIE_MAX_AGE, path='/', secure=True,
        httponly=True, samesite='Lax')
    response.set_cookie(
        HINT_COOKIE_NAME, new_bearer_token(), max_age=HINT_MAX_AGE, path='/',
        secure=True, httponly=True, samesite='Lax')


def _json(payload, status=200, headers=None):
    merged = {'Cache-Control': 'no-store', 'Pragma': 'no-cache'}
    if headers:
        merged.update(headers)
    return JSONResponse(payload, status_code=status, headers=merged)


def _error(code, message, status, headers=None):
    return _json({'detail': {'code': code, 'message': message}}, status, headers)


# --------------------------------------------------------------- child manager
@dataclass
class _ChildEntry:
    guest_id: str
    root: Path
    app: FastAPI
    lifespan: object
    in_flight: int
    last_used: float


def _stop_partial_services(app):
    """Explicitly stop services when a child lifespan failed before ``yield``.

    ``main.create_app`` starts the translation supervisor, analysis recovery and
    agent thread *before* entering its own try/finally, so an exception there
    means the child's ``__aexit__`` never runs and those threads/processes would
    leak.  This fallback closes only services that may own such resources and
    verifies that they actually stopped.  ``False`` means cleanup could not be
    confirmed and the manager must fail closed.
    """
    state = app.state
    ok = True

    reading_pages = getattr(state, 'reading_pages', None)
    if reading_pages is not None:
        try:
            reading_pages.close()
            if not reading_pages.stop.is_set():
                ok = False
        except Exception:
            ok = False

    translations = getattr(state, 'translations', None)
    supervisor = (getattr(translations, 'supervisor', None)
                  if translations is not None else None)
    if supervisor is not None:
        try:
            monitor = getattr(supervisor, 'monitor', None)
            process = getattr(supervisor, 'process', None)
            stop = getattr(supervisor, 'stop', None)
            started = (monitor is not None or process is not None
                       or (stop is not None and stop.is_set())
                       # Unknown supervisor shape: close rather than leak.
                       or not hasattr(supervisor, 'monitor'))
            if started:
                supervisor.close()
            alive = getattr(supervisor, 'monitor', None)
            if alive is not None and alive.is_alive():
                ok = False
            if getattr(supervisor, 'process', None) is not None:
                ok = False
        except Exception:
            ok = False

    agent = getattr(state, 'agent', None)
    if agent is not None:
        try:
            agent.close()
            if not agent.stop.is_set():
                ok = False
            if agent.thread is not None and agent.thread.is_alive():
                ok = False
        except Exception:
            ok = False

    analysis = getattr(state, 'analysis', None)
    supervisor = (getattr(analysis, 'supervisor', None)
                  if analysis is not None else None)
    if supervisor is not None:
        try:
            process = getattr(supervisor, 'process', None)
            if process is not None or not hasattr(supervisor, 'process'):
                supervisor.close()
            if getattr(supervisor, 'process', None) is not None:
                ok = False
        except Exception:
            ok = False
    return ok


def _space_has_active_work(root):
    """Read actual persisted work before evicting a child.

    Idle supervisor processes and the always-alive agent thread are stopped on
    eviction.  Any queued/running agent turn, active task, analysis job or
    translation job keeps the space resident; this function never cancels work.

    ``agent_tasks.status='waiting_confirmation'`` stays conservative on purpose:
    ``AgentTasks.recover()`` rewrites that persisted state to ``paused`` (and
    bumps the generation) on every child startup.  Evicting it would therefore
    mutate a pending task/proposal rather than leave it idle, so it is treated
    as busy exactly like a queued/running turn.
    """
    database = Path(root) / 'workspace.sqlite3'
    if database.is_symlink() or not database.is_file():
        return True
    try:
        connection = sqlite3.connect(
            database.as_uri() + '?mode=ro', uri=True, timeout=1)
    except sqlite3.Error:
        return True
    try:
        checks = (
            ('agent_turns', "status IN ('queued','running')"),
            ('agent_tasks',
             "status IN ('running','waiting_confirmation','waiting_analysis')"),
            ('analysis_jobs', "status IN ('queued','running')"),
            ('translation_jobs', "status IN ('queued','running')"),
        )
        for table, condition in checks:
            try:
                row = connection.execute(
                    f'SELECT 1 FROM {table} WHERE {condition} LIMIT 1').fetchone()
            except sqlite3.Error:
                # Unknown state is treated as busy, never as evictable.
                return True
            if row is not None:
                return True
        return False
    finally:
        connection.close()


class GuestSpaceManager:
    """Bounded LRU cache of child applications with owned lifespans."""

    def __init__(self, registry, max_active, child_factory):
        if isinstance(max_active, bool) or not isinstance(max_active, int):
            raise ValueError('max_active must be an integer')
        if not 1 <= max_active <= MAX_ACTIVE_CHILDREN:
            raise ValueError(
                f'max_active must be between 1 and {MAX_ACTIVE_CHILDREN}')
        self.registry = registry
        self.max_active = max_active
        self.child_factory = child_factory
        self._entries = OrderedDict()
        self._async_lock = None
        self._loop = None
        self._closed = False
        # Sticky fail-closed marker: once a child graph may still be alive we
        # never open another graph or evict on top of it.  Replacement requests
        # receive 503 until the process is restarted.
        self._failed = False

    def _guard(self):
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            self._loop = loop
            self._async_lock = asyncio.Lock()
        return self._async_lock

    async def _close_entry(self, entry):
        context = entry.lifespan
        if context is None:
            return True
        try:
            await context.__aexit__(None, None, None)
            # ``main.lifespan`` only joins its agent thread for ~1s, so a
            # normal context exit is not evidence that every worker is gone: a
            # network-blocked thread can outlive ``agent.close()``.  Verify the
            # actual service state through the same idempotent helper before
            # admitting a replacement graph.
            if not await run_in_threadpool(_stop_partial_services, entry.app):
                self._failed = True
                return False
        except asyncio.CancelledError:
            # Keep the entry and the capacity occupied, mark the manager
            # unhealthy, then let cancellation propagate.  The fallback runs in
            # a shielded thread so a cancelled request does not abandon the
            # services it just interrupted.
            self._failed = True
            try:
                await asyncio.shield(run_in_threadpool(
                    _stop_partial_services, entry.app))
            except BaseException:
                pass
            raise
        except Exception:
            # Cleanup is uncertain: do not forget the graph and do not allow a
            # replacement to be opened over it.  Try the explicit fallback so
            # a failing lifespan close does not leave live workers behind.
            self._failed = True
            try:
                await run_in_threadpool(_stop_partial_services, entry.app)
            except Exception:
                pass
            return False
        entry.lifespan = None
        return True

    async def _make_room_locked(self):
        if self._failed:
            raise GuestBusy('unhealthy')
        if len(self._entries) < self.max_active:
            return
        victim = None
        for candidate in list(self._entries.values()):
            if candidate.in_flight:
                continue
            try:
                busy = await run_in_threadpool(
                    _space_has_active_work, candidate.root)
            except Exception:
                busy = True
            if busy:
                continue
            victim = candidate
            break
        if victim is None:
            raise GuestBusy('capacity')
        if not await self._close_entry(victim):
            # Keep the victim entry resident so capacity stays occupied and a
            # second graph is never opened over an unclosed one.
            raise GuestBusy('cleanup_failed')
        self._entries.pop(victim.guest_id, None)

    async def acquire(self, guest_id, root):
        guard = self._guard()
        async with guard:
            if self._closed or self._failed:
                raise GuestBusy('closed')
            entry = self._entries.get(guest_id)
            if entry is not None:
                entry.in_flight += 1
                entry.last_used = time.monotonic()
                self._entries.move_to_end(guest_id)
                return entry
            await self._make_room_locked()
            app = await run_in_threadpool(self.child_factory, guest_id, root)
            context = app.router.lifespan_context(app)
            try:
                await context.__aenter__()
            except asyncio.CancelledError:
                # Startup was interrupted; still attempt cleanup and fail
                # closed because the partial state cannot be verified here.
                try:
                    cleaned = await run_in_threadpool(
                        _stop_partial_services, app)
                except BaseException:
                    cleaned = False
                if not cleaned:
                    self._failed = True
                raise
            except BaseException:
                try:
                    cleaned = await run_in_threadpool(
                        _stop_partial_services, app)
                except BaseException:
                    cleaned = False
                if not cleaned:
                    self._failed = True
                raise
            entry = _ChildEntry(guest_id, root, app, context, 1,
                                time.monotonic())
            self._entries[guest_id] = entry
            return entry

    async def release(self, entry):
        guard = self._guard()
        async with guard:
            if entry.in_flight > 0:
                entry.in_flight -= 1

    async def can_open(self):
        guard = self._guard()
        async with guard:
            if self._closed or self._failed:
                return False
            if len(self._entries) < self.max_active:
                return True
            for candidate in list(self._entries.values()):
                if candidate.in_flight:
                    continue
                try:
                    busy = await run_in_threadpool(
                        _space_has_active_work, candidate.root)
                except Exception:
                    busy = True
                if not busy:
                    return True
            return False

    async def close_all(self):
        guard = self._guard()
        async with guard:
            self._closed = True
            entries = list(self._entries.values())
            self._entries.clear()
        # Give already-running responses a bounded chance to release.  This is
        # shutdown, not capacity eviction: no new child is opened meanwhile.
        deadline = time.monotonic() + 10
        while any(entry.in_flight for entry in entries) and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        for entry in entries:
            await self._close_entry(entry)

    def open_for_lifespan(self):
        """Allow reuse after a clean TestClient/server lifespan.

        ``_failed`` is deliberately sticky: if a previous close could not be
        verified, reopening could put a new graph over an unclosed one.
        """
        self._closed = False


# ------------------------------------------------------------- proxy response
class _GuestProxyResponse(Response):
    def __init__(self, manager, entry, *, cookie=None, hint=False,
                 no_store=False):
        super().__init__()
        self.manager = manager
        self.entry = entry
        self.cookie = cookie
        self.hint = hint
        self.no_store = no_store

    async def __call__(self, scope, receive, send):
        async def wrapped_send(message):
            if message['type'] == 'http.response.start':
                headers = message.setdefault('headers', [])
                if self.cookie is not None:
                    headers.append(
                        (b'set-cookie', _cookie_header(self.cookie).encode('latin-1')))
                if self.hint:
                    headers.append(
                        (b'set-cookie', _hint_header().encode('latin-1')))
                if self.no_store:
                    headers.append((b'cache-control', b'no-store'))
                    headers.append((b'pragma', b'no-cache'))
            await send(message)

        # Copy the scope per request; the child app sets scope["app"] to itself.
        child_scope = dict(scope)
        child_scope['app'] = self.entry.app
        try:
            await self.entry.app(child_scope, receive, wrapped_send)
        finally:
            await self.manager.release(self.entry)


# --------------------------------------------------------------------- factory
def guest_child_app(root, analysis_rscript=None, statistics_root=None,
                    import_root=None, translation_runtime=None):
    """Build one isolated child app bound to exactly this guest data root."""
    root = Path(root)
    return create_app(
        root,
        agent_provider=GuestModelConnection(root),
        # Explicit guest path: create_app must not fall back to
        # RESEARCH_AGENT_CONFIG, and translation workers use this same file.
        agent_config=root / '.agent-model.json',
        analysis_rscript=analysis_rscript,
        statistics_root=statistics_root,
        import_root=import_root,
        translation_runtime=translation_runtime)


async def _guest_from_request(registry, request):
    present, token, problem = read_guest_cookie(request.scope['headers'])
    if problem == 'duplicate':
        return None, _error(
            'guest_cookie_invalid',
            '访客会话无法识别。请使用恢复码在 /recover.html 找回工作区。', 401)
    if problem:
        return None, _error(
            'guest_cookie_invalid',
            '访客会话无法识别。请使用恢复码在 /recover.html 找回工作区。', 401)
    if not present:
        return None, _error(
            'guest_session_required',
            '需要访客工作区。请打开首页，或使用恢复码在 /recover.html 找回工作区。',
            401)
    try:
        guest = await run_in_threadpool(registry.lookup, token)
    except GuestRegistryError:
        return None, _error(
            'guest_storage_unavailable', '访客工作区暂时无法读取，请稍后重试。', 503)
    if guest is None:
        return None, _error(
            'guest_session_invalid',
            '访客会话已失效。请使用恢复码在 /recover.html 找回工作区。', 401)
    if guest.root.is_symlink() or not guest.root.is_dir():
        return None, _error(
            'guest_storage_unavailable', '访客工作区目录暂时不可用，请稍后重试。', 503)
    return guest, None


def _recovery_redirect():
    """Send a human page view to recovery without echoing any credential.

    Only the HTML entry point uses this; ``/api`` keeps returning 401 JSON.
    The recovery page and its static assets are served outside the credential
    check, so the redirect works even with a malformed or revoked cookie.
    """
    return RedirectResponse('/recover.html', status_code=303, headers={
        'Cache-Control': 'no-store', 'Pragma': 'no-cache'})


async def _guest_for_page(registry, request):
    """Resolve GET / without conflating bad credentials and storage failure.

    Returns ``(guest, response)``.  A bad, revoked or expired credential yields
    a recovery redirect; a registry/storage failure yields a 503 JSON response
    so a capacity or disk problem is never reported as if the cookie were bad.
    """
    present, token, problem = read_guest_cookie(request.scope['headers'])
    if problem:
        return None, _recovery_redirect()
    if not present:
        return None, None
    try:
        guest = await run_in_threadpool(registry.lookup, token)
    except GuestRegistryError:
        return None, _error(
            'guest_storage_unavailable', '访客工作区暂时无法读取，请稍后重试。', 503)
    if guest is None:
        return None, _recovery_redirect()
    if guest.root.is_symlink() or not guest.root.is_dir():
        return None, _error(
            'guest_storage_unavailable', '访客工作区目录暂时不可用，请稍后重试。', 503)
    return guest, None


async def _dispatch(manager, guest, request, *, cookie=None, hint=False,
                    no_store=False):
    try:
        entry = await manager.acquire(guest.guest_id, guest.root)
    except GuestBusy:
        return _error(
            'guest_capacity_busy', '当前访客工作区忙碌，请稍后重试。', 503,
            {'Retry-After': '5'})
    except Exception:
        return _error(
            'guest_start_failed', '访客工作区暂时无法启动，请稍后重试。', 503)
    return _GuestProxyResponse(
        manager, entry, cookie=cookie, hint=hint, no_store=no_store)


class RecoveryRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    recovery_code: str = Field(min_length=1, max_length=256)

    @field_validator('recovery_code')
    @classmethod
    def clean_code(cls, value):
        value = value.strip()
        if not value or '\x00' in value:
            raise ValueError('Invalid recovery code')
        return value


def _owner_root():
    value = os.environ.get('RESEARCH_WORKBENCH_DATA')
    return Path(value) if value else ROOT / 'data'


def _within(child, parent):
    """Case-normalized Windows-safe absolute containment check."""
    child_value = os.path.normcase(os.path.abspath(os.fspath(child)))
    parent_value = os.path.normcase(os.path.abspath(os.fspath(parent)))
    if child_value == parent_value:
        return True
    try:
        return os.path.commonpath([child_value, parent_value]) == parent_value
    except ValueError:
        # Different Windows drives can never contain one another.
        return False


def _reject_owner_store(guest_root):
    """Refuse a guest root that overlaps the owner Store in either direction.

    Guest mode must never open, share or sit above the owner's Store.  The
    comparison uses resolved absolute targets only and performs no write, so a
    rejected configuration leaves owner data completely untouched.  A guest
    root is identified by its own registry/spaces layout, not by the owner's
    workspace.sqlite3/documents layout.
    """
    try:
        guest = Path(guest_root).expanduser().resolve()
        owner = _owner_root().expanduser().resolve()
    except OSError as error:
        raise GuestStorageError('guest_root_unavailable') from error
    if _within(guest, owner) or _within(owner, guest):
        raise GuestSecurityError('guest_root_overlaps_owner_data')
    try:
        application = ROOT.resolve()
    except OSError as error:
        raise GuestStorageError('guest_root_unavailable') from error
    if _within(application, guest):
        # The application itself or one of its ancestors would receive the
        # registry/spaces layout; reject before any directory is created.
        raise GuestSecurityError('guest_root_is_application')
    if (guest / 'workspace.sqlite3').exists() or (guest / 'documents').is_dir():
        raise GuestSecurityError('guest_root_contains_owner_store')


def create_guest_gateway(guest_root, *, max_spaces=MAX_SPACES, max_active=2,
                         analysis_rscript=None, statistics_root=None,
                         import_root=None, translation_runtime=None):
    """Create the opt-in public guest ASGI application.

    ``guest_root`` is the only tenant data location; the caller must keep it
    separate from the owner data root.  The owner server continues to use
    ``create_app`` directly and is unaffected by this factory.
    """
    _reject_owner_store(guest_root)
    registry = GuestRegistry(guest_root, max_spaces=max_spaces)

    def child_factory(guest_id, root):
        return guest_child_app(
            root, analysis_rscript=analysis_rscript,
            statistics_root=statistics_root, import_root=import_root,
            translation_runtime=translation_runtime)

    manager = GuestSpaceManager(registry, max_active, child_factory)

    @asynccontextmanager
    async def lifespan(app):
        manager.open_for_lifespan()
        try:
            yield
        finally:
            await manager.close_all()

    app = FastAPI(
        title='Research workbench guest gateway', version=__version__,
        docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.guest_registry = registry
    app.state.guest_manager = manager
    app.add_middleware(LocalBoundary)
    app.add_middleware(_ApiNoStore)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Never echo request bodies: the recovery code is a credential.
        return _error('validation_error', '请检查请求内容和长度。', 422)

    @app.get('/api/v1/health')
    async def health():
        return _json({'status': 'ok', 'version': __version__})

    @app.get('/api/v1/access')
    async def access(request: Request):
        guest, error = await _guest_from_request(registry, request)
        if error is not None:
            return error
        return _json({
            'mode': 'guest',
            'workspace_id': guest.guest_id,
            'storage': 'server',
            'registration_available': False,
            'recovery_available': True,
            'model_policy': 'personal_key',
        })

    @app.post('/api/v1/access/recovery-code')
    async def recovery_code(request: Request):
        guest, error = await _guest_from_request(registry, request)
        if error is not None:
            return error
        try:
            code = await run_in_threadpool(
                registry.issue_recovery, guest.guest_id)
        except GuestNotFound:
            return _error(
                'guest_session_invalid',
                '访客会话已失效。请使用恢复码在 /recover.html 找回工作区。', 401)
        except GuestRegistryError:
            return _error(
                'guest_storage_unavailable', '访客工作区暂时无法写入，请稍后重试。',
                503)
        return _json({'recovery_code': code})

    @app.post('/api/v1/access/recover')
    async def recover(payload: RecoveryRequest):
        try:
            session = await run_in_threadpool(
                registry.redeem, payload.recovery_code)
        except RecoveryRateLimited:
            return _error(
                'recovery_rate_limited', '恢复码尝试次数过多，请稍后再试。', 429,
                {'Retry-After': '60'})
        except GuestRegistryError:
            return _error(
                'guest_storage_unavailable', '访客工作区暂时无法读取，请稍后重试。',
                503)
        if session is None:
            return _error(
                'recovery_failed', '恢复码无效，请核对后重试。', 401)
        response = _json({'workspace_id': session.guest_id})
        _set_cookie(response, session.token)
        return response

    @app.get('/')
    async def root(request: Request):
        # Only an explicit server choice may allocate a persistent space.
        if request.scope['method'] != 'GET':
            return _error('method_not_allowed', '请使用 GET 打开工作台。', 405)

        guest, response = await _guest_for_page(registry, request)
        if response is not None:
            return response
        if guest is not None:
            return await _dispatch(
                manager, guest, request, hint=True, no_store=True)

        # The credential is absent.  If this browser still carries the
        # non-credential continuity marker, do not silently hand it a new empty
        # space: point it at recovery instead.  The old space and data remain.
        # No allocation, write or cookie change happens on this path.
        if read_guest_hint(request.scope['headers']):
            return _recovery_redirect()

        if request.query_params.get('storage') != 'server':
            from .device_pages import choice_response
            return choice_response(ROOT / 'frontend')

        # The new visitor explicitly selected server storage.
        try:
            can_open = await manager.can_open()
        except Exception:
            can_open = False
        if not can_open:
            return _error(
                'guest_capacity_busy',
                '当前访客工作区已满或忙碌，请稍后重试，或使用恢复码在 '
                '/recover.html 找回已有工作区。', 503, {'Retry-After': '5'})
        try:
            issued = await run_in_threadpool(registry.create)
        except GuestCapacityError:
            return _error(
                'guest_capacity_full',
                '当前访客工作区数量已达上限，请稍后重试，或使用恢复码在 '
                '/recover.html 找回已有工作区。', 503,
                {'Retry-After': '300'})
        except GuestRegistryError:
            return _error(
                'guest_storage_unavailable', '访客工作区暂时无法创建，请稍后重试。',
                503)
        try:
            guest = GuestSpace(issued.guest_id, registry.space_root(issued.guest_id))
            entry = await manager.acquire(guest.guest_id, guest.root)
        except GuestBusy:
            await _discard_unserved(registry, issued)
            return _error(
                'guest_capacity_busy',
                '当前访客工作区忙碌，请稍后重试，或使用恢复码在 /recover.html '
                '找回已有工作区。', 503, {'Retry-After': '5'})
        except GuestRegistryError:
            await _discard_unserved(registry, issued)
            return _error(
                'guest_storage_unavailable', '访客工作区暂时无法创建，请稍后重试。',
                503)
        except Exception:
            await _discard_unserved(registry, issued)
            return _error(
                'guest_start_failed', '访客工作区暂时无法启动，请稍后重试。', 503)
        return _GuestProxyResponse(
            manager, entry, cookie=issued.token, hint=True, no_store=True)

    @app.api_route('/api/{path:path}', methods=ALL_METHODS)
    async def api_proxy(path: str, request: Request):
        guest, error = await _guest_from_request(registry, request)
        if error is not None:
            return error
        return await _dispatch(manager, guest, request, no_store=True)

    @app.api_route('/api', methods=ALL_METHODS)
    async def api_root(request: Request):
        guest, error = await _guest_from_request(registry, request)
        if error is not None:
            return error
        return _error('not_found', '找不到接口。', 404)

    # Static frontend (including Kimi-owned recover.html/guest-recovery.js) is
    # served without a session and without allocating a space.  API paths are
    # matched above and cannot fall through to this HTML mount.
    from .device_pages import FrontendFiles, install_device_pages
    install_device_pages(app, ROOT / 'frontend')
    app.mount('/', FrontendFiles(directory=ROOT / 'frontend', html=True),
              name='guest-frontend')
    return app


async def _discard_unserved(registry, issued: IssuedSession):
    """Best-effort removal of a fresh space whose cookie was never sent."""
    try:
        await run_in_threadpool(registry.discard, issued.guest_id)
    except Exception:
        pass
