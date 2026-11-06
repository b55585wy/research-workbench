"""Narrow, loopback-only companion service for paper presentations.

Purpose
-------
An already running production core keeps serving its owner data, old PPT
request receipts, Agent, analysis and translation work.  This process is a
*separate*, feature-specific entry point for the new
``/api/v1/paper-presentations/*`` family only.  It never creates guest spaces,
never recovers them, never serves notes uploads or any other API, and never
mounts the frontend.

Data access
-----------
* ``PassiveRegistry`` reuses the audited ``GuestRegistry.lookup/space_root``
  over a ``mode=ro`` connection to an *already initialized* schema-2 registry.
* ``PresentationReadStore`` reuses ``Store`` read methods over a ``mode=ro``
  workspace connection for an exact schema-29 workspace.
* ``PassiveDatasets``/``PassiveAnalyses``/``Charts``/``Presentations`` form the
  existing read service graph; ``RuntimeCatalog`` (Rscript probe), Agent,
  analysis workers and translation services are never constructed.
* The only writable path is a companion-owned temporary directory created
  inside the guest's already verified ``exports`` directory.  Each exported
  PPTX is removed after the download, exactly like the existing route.

Trust boundary
--------------
``LocalBoundary`` is unchanged: the TCP peer must be loopback *and* the Host
header must be ``localhost``/``127.0.0.1``/``::1``; a cross-site
``Sec-Fetch-Site`` or a foreign ``Origin`` is rejected.  When Caddy (or any
other proxy) is placed in front of this process, it must be inserted *inside*
the current public origin and its authentication/security guards, and it must
normalize the request so these invariants hold:

    reverse_proxy 127.0.0.1:3154 {
        header_up Host 127.0.0.1:3154      # loopback Host, not the public host
        header_up -Origin                  # or exactly http://127.0.0.1:3154
        header_up -Sec-Fetch-Site          # or same-origin
        header_up -Forwarded-For           # do not spoof the loopback peer
    }

The proxy must also strip hop-by-hop/credential headers it does not need and
must not accept arbitrary client ``Host``/``Origin`` values.  This companion
deliberately does not weaken ``LocalBoundary`` or invent a trusted-origin
header.

Run::

    python -m research_workbench.presentation_companion \
        --root <existing guest-registry root> \
        --shared-model <server-owned shared model file> \
        --host 127.0.0.1 --port 3154

``--shared-model`` (or ``RESEARCH_PRESENTATION_SHARED_MODEL``) is a
server-owned path only; it is never accepted from a request.  The guest's own
``.agent-model.json`` keeps priority; an invalid personal file fails closed and
never falls back to the platform connection.  No credential is read out, copied
or returned by this process.
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
import ipaddress
import os
from pathlib import Path
import re
import sqlite3
import threading
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from . import __version__
from .charts import Charts
from .guest_gateway import GuestModelConnection, _ApiNoStore, _guest_from_request
from .guest_registry import GuestRegistryError
from .main import LocalBoundary
from .models import WorkspaceError
from .paper_presentation_api import API_FAMILY, router as paper_router
from .presentation_passive import (PassiveAnalyses, PassiveDatasets,
                                   PassiveRegistry, PresentationReadStore)
from .presentation_service import OUTLINE_TTL, Presentations
from .shared_model import SharedModel

MAX_BUNDLES = 32
MAX_CONCURRENT_REQUESTS = 2
DEFAULT_PORT = 3154
CAPABILITIES_PATH = '/api/v1/paper-presentations/capabilities'
_DOCUMENT_ALIAS = re.compile(
    r'^/api/v1/documents/[^/]+/paper-presentations/(context|outline|export)$')


class CompanionCapacity(Exception):
    """No bundle can be released without dropping live or unexpired receipts."""


@dataclass
class _Bundle:
    guest_id: str
    root: Path
    service: Presentations
    created: float
    last_used: float
    in_flight: int = 0


def _receipts_expired(service, now):
    """True only when every retained outline receipt is past its 1h lifetime."""
    receipts = getattr(service, '_receipts', None)
    lock = getattr(service, '_receipts_lock', None)
    if receipts is None or lock is None:
        # Unknown receipt shape: never evict a possibly billing-relevant bundle.
        return False
    with lock:
        return all(now - item.get('created', now) > OUTLINE_TTL
                   for item in receipts.values())


class CompanionState:
    """Thread-safe, process-local bundle cache and request gate.

    No async lock is held across blocking work: callers run ``acquire`` in the
    threadpool.  At most ``max_bundles`` per-guest services are cached lazily on
    POST, and a full cache returns capacity (429) instead of evicting a bundle
    that is in use or still holds unexpired receipts.
    """

    def __init__(self, registry, shared_model, max_bundles=MAX_BUNDLES,
                 max_requests=MAX_CONCURRENT_REQUESTS):
        if isinstance(max_bundles, bool) or not isinstance(max_bundles, int) \
                or not 1 <= max_bundles <= MAX_BUNDLES:
            raise ValueError(f'max_bundles must be between 1 and {MAX_BUNDLES}')
        if isinstance(max_requests, bool) or not isinstance(max_requests, int) \
                or not 1 <= max_requests <= MAX_CONCURRENT_REQUESTS:
            raise ValueError(
                f'max_requests must be between 1 and {MAX_CONCURRENT_REQUESTS}')
        self.registry = registry
        self.shared_model = shared_model
        self.max_bundles = max_bundles
        self._bundles = {}
        self._lock = threading.Lock()
        self._requests = threading.BoundedSemaphore(max_requests)

    # ---------------------------------------------------------- request slots
    def try_request(self):
        return self._requests.acquire(blocking=False)

    def release_request(self):
        self._requests.release()

    # --------------------------------------------------------------- provider
    def provider(self, guest):
        # Passive: only the explicit shared file path and the guest's own file
        # are resolved on demand.  No request input selects an origin.
        return GuestModelConnection(guest.root, self.shared_model)

    def capability_service(self, guest):
        # Cheap capabilities: no Store/read graph, no PDF, no Rscript, no job.
        return Presentations(None, None, None, None, self.provider(guest))

    # ---------------------------------------------------------------- bundles
    def _build_service(self, guest):
        store = PresentationReadStore(guest.root)
        datasets = PassiveDatasets(store)
        analysis = PassiveAnalyses(store, datasets)
        charts = Charts(store, datasets, analysis)
        return Presentations(store, datasets, analysis, charts,
                             self.provider(guest))

    def acquire(self, guest):
        """Return an in-flight bundle for this guest, or raise Capacity."""
        with self._lock:
            now = time.monotonic()
            bundle = self._bundles.get(guest.guest_id)
            if bundle is not None:
                if bundle.root == guest.root:
                    bundle.in_flight += 1
                    bundle.last_used = now
                    return bundle
                if bundle.in_flight:
                    raise CompanionCapacity()
                del self._bundles[guest.guest_id]
            if len(self._bundles) >= self.max_bundles:
                victim = self._evictable_locked(now)
                if victim is None:
                    raise CompanionCapacity()
                del self._bundles[victim.guest_id]
            service = self._build_service(guest)
            bundle = _Bundle(guest.guest_id, guest.root, service, now, now, 1)
            self._bundles[guest.guest_id] = bundle
            return bundle

    def release(self, bundle):
        with self._lock:
            current = self._bundles.get(bundle.guest_id)
            if current is bundle:
                bundle.in_flight = max(0, bundle.in_flight - 1)
                bundle.last_used = time.monotonic()

    def _evictable_locked(self, now):
        for bundle in self._bundles.values():
            if bundle.in_flight:
                continue
            if _receipts_expired(bundle.service, now):
                return bundle
        return None

    def cached(self, guest_id):
        with self._lock:
            return self._bundles.get(guest_id)


# ------------------------------------------------------------------ responses
def _json(payload, status=200, headers=None):
    merged = {'Cache-Control': 'no-store', 'Pragma': 'no-cache'}
    if headers:
        merged.update(headers)
    return JSONResponse(payload, status_code=status, headers=merged)


def _error(code, message, status, headers=None):
    return _json({'detail': {'code': code, 'message': message}}, status, headers)


def _is_companion_path(path):
    if path == CAPABILITIES_PATH or path.startswith('/api/v1/paper-presentations'):
        return True
    return _DOCUMENT_ALIAS.fullmatch(path) is not None


class _Reservations:
    """One owned request slot plus, once acquired, one bundle reservation.

    Both are released *exactly once*, from the shielded work coroutine's
    ``finally``.  An outer request that is cancelled must never free a slot or a
    bundle that a still-running acquisition, route or provider call depends on:
    a late eviction there would drop the in-memory receipt and the same
    ``request_id`` would be billed again.
    """

    __slots__ = ('_state', '_lock', '_released', '_bundle', 'abandoned')

    def __init__(self, state):
        self._state = state
        self._lock = threading.Lock()
        self._released = False
        self._bundle = None
        self.abandoned = False

    def hold_bundle(self, bundle):
        with self._lock:
            self._bundle = bundle

    def release(self):
        """Release the held reservations once; later calls are no-ops."""
        with self._lock:
            if self._released:
                return False
            self._released = True
            bundle, self._bundle = self._bundle, None
        try:
            if bundle is not None:
                self._state.release(bundle)
        finally:
            self._state.release_request()
        return True


def _consume_task(task):
    """Retrieve a finished task's outcome so a late failure never warns."""
    if task.cancelled():
        return
    try:
        task.exception()
    except BaseException:
        pass


async def _drain(task):
    """Wait for owned work to settle, consuming late exceptions.

    Cancellation can be delivered again while unwinding.  Keep waiting for the
    real acquisition/dispatch instead of orphaning it, so no reservation is
    left behind and no "never retrieved" task exception is logged.
    """
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
        except Exception:
            break
    _consume_task(task)


class AsgiResponseStart:
    """Track whether the downstream already started its response."""

    __slots__ = ('started',)

    def __init__(self):
        self.started = False

    def wrap(self, send):
        async def tracked_send(message):
            if message['type'] == 'http.response.start':
                self.started = True
            await send(message)
        return tracked_send


class _CompanionGate:
    """Authenticate every alias request, then attach the per-guest service.

    Authentication runs before any cache lookup, so a cached bundle is never a
    substitute for a valid, unexpired credential.

    The global request slot and the bundle in-flight count are owned by one
    shielded inner task that performs acquisition *and* dispatch.  A cancelled
    outer request only marks that task abandoned (so it never starts new
    downstream/model work after a delayed acquisition) and then drains it; both
    reservations are released by the inner task itself when the real work is
    over.  Normal responses, errors, body failures and disconnects therefore all
    release exactly once, and a still-running provider call can never be evicted
    or replayed as a new billable request.
    """

    def __init__(self, app, state):
        self.app = app
        self.state = state

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path = scope.get('path', '')
        if not _is_companion_path(path):
            return await self.app(scope, receive, send)

        request = Request(scope)
        guest, error = await _guest_from_request(self.state.registry, request)
        if error is not None:
            return await error(scope, receive, send)

        if scope['method'] == 'POST' and _DOCUMENT_ALIAS.fullmatch(path):
            if not self.state.try_request():
                return await _error(
                    'paper_presentation_busy',
                    '正在处理其他论文演示文稿请求，请稍后重试。', 429,
                    {'Retry-After': '3'})(scope, receive, send)
            reservations = _Reservations(self.state)
            response = AsgiResponseStart()
            try:
                work = asyncio.ensure_future(
                    self._reserved(scope, receive, send, guest, reservations,
                                   response))
            except BaseException:
                reservations.release()
                raise
            work.add_done_callback(_consume_task)
            try:
                await asyncio.shield(work)
            except asyncio.CancelledError:
                # The client is gone but the true work is not: never start new
                # downstream/model work, then drain and let the inner task
                # release both reservations when it really settles.
                reservations.abandoned = True
                await _drain(work)
                raise
            except CompanionCapacity:
                return await self._failure(
                    scope, receive, send, response, 'paper_presentation_capacity',
                    '论文演示文稿缓存已满，请稍后重试。', 429, {'Retry-After': '30'})
            except GuestRegistryError:
                return await self._failure(
                    scope, receive, send, response, 'guest_storage_unavailable',
                    '访客工作区暂时无法读取，请稍后重试。', 503)
            except Exception:
                if response.started:
                    # The downstream already answered and logged; keep its
                    # exception semantics and do not append a second response.
                    raise
                return await self._failure(
                    scope, receive, send, response,
                    'paper_presentation_unavailable',
                    '论文演示文稿服务暂时不可用，请稍后重试。', 503)
            return

        try:
            service = await run_in_threadpool(
                self.state.capability_service, guest)
        except Exception:
            return await _error(
                'paper_presentation_unavailable',
                '论文演示文稿服务暂时不可用，请稍后重试。', 503)(scope, receive, send)
        scope.setdefault('state', {})['paper_presentation'] = service
        await self.app(scope, receive, send)

    async def _reserved(self, scope, receive, send, guest, reservations,
                        response):
        """Acquire the bundle and dispatch, owning both reservations."""
        try:
            bundle = await run_in_threadpool(self.state.acquire, guest)
            reservations.hold_bundle(bundle)
            if reservations.abandoned:
                # Cancelled while bundle construction was still running: skip
                # the delayed downstream/model work and release safely.
                return
            scope.setdefault('state', {})['paper_presentation'] = bundle.service
            await self.app(scope, receive, response.wrap(send))
        finally:
            # ``CompanionState.release`` waits on the shared bundle lock, which a
            # *different* request can hold across its own blocking bundle build.
            # Releasing inline would block this event loop (health included)
            # until that build finished, so the exactly-once release runs in a
            # worker thread instead.  The creation-failure path above stays
            # synchronous because it holds no bundle and only frees the slot.
            await run_in_threadpool(reservations.release)

    @staticmethod
    async def _failure(scope, receive, send, response, code, message, status,
                       headers=None):
        if response.started:
            # The downstream already answered/logged; never append a second
            # response on a live request.
            return None
        return await _error(code, message, status, headers)(scope, receive, send)


# --------------------------------------------------------------------- factory
def create_companion_app(root, *, shared_model_config=None,
                         max_bundles=MAX_BUNDLES,
                         max_requests=MAX_CONCURRENT_REQUESTS):
    """Build the loopback companion app for one existing guest-registry root."""
    registry = PassiveRegistry(root)
    shared_model = (SharedModel(shared_model_config, forbidden_root=registry.root)
                    if shared_model_config is not None else None)
    state = CompanionState(registry, shared_model, max_bundles=max_bundles,
                           max_requests=max_requests)
    app = FastAPI(title='Research workbench paper presentations companion',
                  version=__version__, docs_url=None, redoc_url=None,
                  openapi_url=None)
    app.state.guest_registry = registry
    app.state.companion = state

    app.include_router(paper_router)

    @app.get('/api/v1/health')
    def health():
        return {'status': 'ok', 'version': __version__,
                'service': 'paper-presentations-companion',
                'api_family': API_FAMILY}

    @app.exception_handler(WorkspaceError)
    async def workspace_error(request, error):
        return _error(error.code, error.message, error.status)

    @app.exception_handler(GuestRegistryError)
    async def guest_storage_error(request, error):
        # Never surface a registry path, SQLite message or credential.
        return _error('guest_storage_unavailable',
                      '访客工作区暂时无法读取，请稍后重试。', 503)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Never echo the request body (it may carry selectors or receipts).
        return _error('validation_error', '请检查请求内容和长度。', 422)

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        if isinstance(error.detail, dict):
            return JSONResponse({'detail': error.detail},
                                status_code=error.status_code,
                                headers={'Cache-Control': 'no-store',
                                         'Pragma': 'no-cache'})
        return _error('not_found', '找不到请求的资料或页面。', error.status_code)

    @app.exception_handler(OSError)
    @app.exception_handler(sqlite3.Error)
    async def storage_error(request, error):
        return _error('storage_unavailable',
                      '无法读取资料，请检查存储后重试。', 503)

    # Added last -> outermost.  Requests pass the no-store marker, the unchanged
    # loopback/origin boundary, then authentication before reaching a route.
    app.add_middleware(_CompanionGate, state=state)
    app.add_middleware(LocalBoundary)
    app.add_middleware(_ApiNoStore)
    return app


def _loopback(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog='python -m research_workbench.presentation_companion',
        description='Loopback-only paper presentation companion for an '
                    'existing guest-registry root.')
    parser.add_argument('--root', required=True,
                        help='existing guest-registry root (read-only)')
    parser.add_argument('--shared-model', default=os.environ.get(
                            'RESEARCH_PRESENTATION_SHARED_MODEL'),
                        help='server-owned shared model file (optional)')
    parser.add_argument('--host', default='127.0.0.1',
                        help='loopback bind address only (default 127.0.0.1)')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)
    if not _loopback(args.host):
        parser.error('--host must be a loopback address')
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    app = create_companion_app(
        args.root, shared_model_config=args.shared_model)
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port,
                log_level='warning', access_log=False)


if __name__ == '__main__':
    main()
