"""Explicit local-device selected-text translation relay.

The browser owns the PDF bytes and the selection coordinates; this module only
forwards the text the user explicitly confirmed, the target language and the
chosen model name to the fixed DeepSeek official endpoint.  The user supplied
credential lives in memory for the duration of one call and is never written to
a file, cookie, cache or log.  No owner/guest model configuration or data file
is read, and no Agent turn, tool loop or retry is involved.

The selected text is sent to the configured provider through one transient
request.  The relay does not claim that it never leaves the browser.

The relay keeps a bounded in-memory receipt cache so an immediate retry of the
same confirmed request can reuse the recorded outcome while that terminal
receipt is retained.  This is bounded in-process dedupe only, never external
exact-once billing: after expiry, eviction or a restart, or when a transport
acknowledgement is lost, a retry may reach the provider and be charged again.
The cache retains only request fingerprints, results and safe errors, not raw
selected text, credentials or model configuration.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal
from uuid import UUID

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import (
    BaseModel, ConfigDict, StrictBool, StrictStr, ValidationError,
    field_validator,
)
from starlette.concurrency import run_in_threadpool

from .agent_provider import ModelConnection, NoRedirect
from .models import WorkspaceError
from .shared_model import SharedModel, shared_connection_status
from .selection_translation import SYSTEM_PROMPT

DEVICE_AI_PATH = '/device/ai/selection-translation'
DEVICE_CONNECTION_PATH = '/device/ai/connection'
PROVIDER_BASE_URL = 'https://api.deepseek.com/v1'

SOURCE_HEADER = b'x-research-model-source'
SOURCE_SHARED = 'shared'
SOURCE_PERSONAL = 'personal'

MAX_BODY_BYTES = 16384
MAX_TEXT_CHARS = 3000
MAX_RESULT_CHARS = 6000
MAX_MODEL_CHARS = 120
MAX_CREDENTIAL_BYTES = 512
MAX_ACTIVE_CALLS = 2
MAX_ACTIVE_PER_CREDENTIAL = 1
MAX_RECEIPTS = 32
RECEIPT_TTL_SECONDS = 600.0

# Bounded printable ASCII model identifier: visible characters only, no spaces,
# controls or NUL.  It is only ever placed in the provider JSON body by
# ``json.dumps``, never in a header or filesystem path.
_MODEL = re.compile(r'^[!-~]{1,%d}$' % MAX_MODEL_CHARS)
_CREDENTIAL = re.compile(r'[Bb][Ee][Aa][Rr][Ee][Rr] ([!-~]{1,%d})'
                         % MAX_CREDENTIAL_BYTES)
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_SAFE_FINISH = (None, 'stop')

# Safe, detail-free errors.  None of them echo request input, credentials or a
# provider exception.
CREDENTIAL_CODE = 'device_ai_credential_invalid'
CREDENTIAL_MESSAGE = '需要有效的模型密钥才能继续翻译。'
MEDIA_CODE = 'device_ai_media_type'
MEDIA_MESSAGE = '请使用 JSON 提交翻译请求。'
BODY_CODE = 'device_ai_body_too_large'
BODY_MESSAGE = '翻译请求超过大小限制。'
VALIDATION_CODE = 'validation_error'
VALIDATION_MESSAGE = '请检查翻译请求的内容和长度。'
PENDING_CODE = 'device_ai_request_pending'
PENDING_MESSAGE = '这个翻译请求仍在处理中，请稍后查看。'
CONFLICT_CODE = 'device_ai_request_conflict'
CONFLICT_MESSAGE = '这个请求编号已用于另一段选区，请使用新的请求编号。'
BUSY_CODE = 'device_ai_busy'
BUSY_MESSAGE = '翻译服务当前忙碌，请稍后重试。'
OUTPUT_CODE = 'device_ai_output_invalid'
OUTPUT_MESSAGE = '模型没有返回可用的译文，请重新翻译。'
PROVIDER_CODE = 'device_ai_provider_failed'
PROVIDER_MESSAGE = '模型服务暂时无法完成翻译，请稍后重试。'
FAILED_CODE = 'device_ai_failed'
FAILED_MESSAGE = '翻译未完成，请稍后重试。'
METHOD_CODE = 'method_not_allowed'
METHOD_MESSAGE = '请使用 POST 提交翻译请求。'
CONNECTION_METHOD_MESSAGE = '请使用 GET 获取连接状态。'
SOURCE_CODE = 'device_model_source_invalid'
SOURCE_MESSAGE = '模型来源请求头无效。'
SHARED_UNAVAILABLE_CODE = 'device_shared_model_unavailable'
SHARED_UNAVAILABLE_MESSAGE = '平台连接暂不可用，请使用自己的 Key。'
SHARED_CHANGED_CODE = 'device_shared_model_changed'
SHARED_CHANGED_MESSAGE = '平台模型已变更，请刷新连接后重试。'


class DeviceSelectionTranslationRequest(BaseModel):
    """Frozen request shape: selected text, target language, model, consent.

    Document/source/page/rectangle/credential/URL fields are deliberately absent
    and therefore rejected as unknown fields.
    """

    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    text: StrictStr
    target_language: Literal['zh', 'en']
    model: StrictStr
    confirmed: StrictBool

    @field_validator('text')
    @classmethod
    def selected_text(cls, value):
        if not value.strip():
            raise ValueError('text must not be blank')
        if len(value) > MAX_TEXT_CHARS:
            raise ValueError('text is longer than the selected-text limit')
        if '\x00' in value:
            raise ValueError('text must not contain NUL')
        try:
            value.encode('utf-8')
        except UnicodeEncodeError:
            raise ValueError('text must be valid UTF-8') from None
        return value

    @field_validator('model')
    @classmethod
    def model_name(cls, value):
        if not _MODEL.fullmatch(value):
            raise ValueError('model must be a bounded ASCII identifier')
        return value

    @field_validator('confirmed')
    @classmethod
    def confirmed_fee(cls, value):
        if value is not True:
            raise ValueError('the provider charge must be explicitly confirmed')
        return value


class DeviceModelConnection(ModelConnection):
    """One-shot transport with an immutable in-memory configuration.

    The fixed endpoint policy and the per-call credential are held in memory
    only.  ``config`` never reads the owner/guest configuration file, and no
    successful or failed call writes anything to disk.
    """

    def __init__(self, api_key, model, opener=None):
        self._config = MappingProxyType({
            'base_url': PROVIDER_BASE_URL, 'model': model, 'api_key': api_key})
        # No configuration path exists for this connection on purpose.
        self.path = None
        self.inherited = None
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.connection_state = 'unverified'
        self.lock = threading.Lock()

    def config(self):
        return dict(self._config), 'memory'

    def save(self, payload):
        # There is deliberately no durable device-model configuration.
        raise WorkspaceError(
            'device_ai_memory_only', '设备翻译密钥仅保存在当前页面内存中。', 409)

    @staticmethod
    def validate(config):
        ModelConnection.validate(config)
        if str(config.get('base_url', '')) != PROVIDER_BASE_URL:
            raise WorkspaceError(
                'device_ai_endpoint_not_allowed',
                '设备翻译仅支持 DeepSeek 官方模型地址。', 422)


def _default_transport(api_key, model):
    return DeviceModelConnection(api_key, model)


@dataclass
class _Receipt:
    identity: str
    status: str
    created_at: float
    response: dict | None = None
    error: tuple | None = None


def _failure(code, message, status):
    return WorkspaceError(code, message, status)


def _credential_digest(credential):
    return hashlib.sha256(credential.encode('ascii')).hexdigest()


def _text_digest(text):
    """Return the exact UTF-8 SHA256 of selected text."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def request_identity(payload):
    """Fingerprint exact text, target and model without keeping raw text."""
    material = json.dumps(
        [_text_digest(payload.text), payload.target_language, payload.model],
        ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode('ascii')
    return hashlib.sha256(material).hexdigest()


def translated_text(result):
    """Accept plain translated text only, bounded to 6000 characters."""

    def invalid():
        return _failure(OUTPUT_CODE, OUTPUT_MESSAGE, 502)

    if not isinstance(result, dict):
        raise invalid()
    if result.get('tool_calls') or result.get('finish_reason') not in _SAFE_FINISH:
        raise invalid()
    content = result.get('content')
    if not isinstance(content, str):
        raise invalid()
    text = _CONTROL.sub(
        '', content.replace('\r\n', '\n').replace('\r', '\n')).strip()
    if not text or len(text) > MAX_RESULT_CHARS:
        raise invalid()
    return text


class DeviceAiRelay:
    """Per-application admission control and bounded terminal receipts."""

    def __init__(self, clock=time.monotonic, transport_factory=None):
        self.clock = clock
        self.transport_factory = transport_factory or _default_transport
        self.lock = threading.Lock()
        self.active = 0
        self.active_by_credential = {}
        self.receipts = OrderedDict()

    # --------------------------------------------------------------- receipts
    @staticmethod
    def _terminal(receipt):
        return receipt.status != 'pending'

    def _terminal_count(self):
        return sum(1 for receipt in self.receipts.values()
                   if self._terminal(receipt))

    def _prune(self, now):
        """Expire old terminal receipts and keep at most MAX_RECEIPTS.

        Pending entries are never evicted and never counted against the
        terminal receipt bound; the active-call bound already caps them.
        """
        for key, receipt in list(self.receipts.items()):
            if self._terminal(receipt) and now - receipt.created_at > RECEIPT_TTL_SECONDS:
                del self.receipts[key]
        while self._terminal_count() > MAX_RECEIPTS:
            victim = next((key for key, receipt in self.receipts.items()
                           if self._terminal(receipt)), None)
            if victim is None:
                break
            del self.receipts[victim]

    def _release(self, digest):
        self.active = max(0, self.active - 1)
        remaining = self.active_by_credential.get(digest, 0) - 1
        if remaining > 0:
            self.active_by_credential[digest] = remaining
        else:
            self.active_by_credential.pop(digest, None)

    # ------------------------------------------------------------------ result
    def execute(self, credential, key, identity, run, failure=None):
        """Shared admission, receipt and release hook for device operations.

        ``key`` must be unique per operation domain as well as per credential
        and request id, so one operation can never return another operation's
        receipt.  ``identity`` fingerprints the exact confirmed input, and
        ``run`` performs exactly one provider attempt and returns a plain
        response dict.  ``failure`` is the detail-free fallback used when
        ``run`` raises an unexpected exception.
        """
        digest = _credential_digest(credential)
        now = self.clock()
        with self.lock:
            self._prune(now)
            receipt = self.receipts.get(key)
            if receipt is not None:
                if receipt.identity != identity:
                    raise _failure(CONFLICT_CODE, CONFLICT_MESSAGE, 409)
                if receipt.status == 'pending':
                    raise _failure(PENDING_CODE, PENDING_MESSAGE, 409)
                if receipt.status == 'completed':
                    return dict(receipt.response)
                code, message, status = receipt.error
                raise _failure(code, message, status)
            if (self.active >= MAX_ACTIVE_CALLS
                    or self.active_by_credential.get(digest, 0)
                    >= MAX_ACTIVE_PER_CREDENTIAL):
                raise _failure(BUSY_CODE, BUSY_MESSAGE, 503)
            self.active += 1
            self.active_by_credential[digest] = (
                self.active_by_credential.get(digest, 0) + 1)
            receipt = _Receipt(identity=identity, status='pending', created_at=now)
            self.receipts[key] = receipt
        try:
            response = run()
        except WorkspaceError as error:
            self._finish_failed(key, receipt, digest,
                                (error.code, error.message, error.status))
            raise
        except Exception:
            code, message, status = failure or (
                FAILED_CODE, FAILED_MESSAGE, 502)
            self._finish_failed(key, receipt, digest, (code, message, status))
            raise _failure(code, message, status) from None
        with self.lock:
            receipt.status = 'completed'
            receipt.response = response
            receipt.created_at = self.clock()
            self.receipts.move_to_end(key)
            self._release(digest)
            self._prune(receipt.created_at)
        return dict(response)

    # ------------------------------------------------------------ translation
    def translate(self, credential, payload):
        digest = _credential_digest(credential)
        request_id = str(payload.request_id)
        return self.execute(
            credential, (digest, request_id), request_identity(payload),
            lambda: self._translate_once(credential, payload, request_id))

    def _finish_failed(self, key, receipt, digest, error):
        with self.lock:
            receipt.status = 'failed'
            receipt.error = error
            receipt.created_at = self.clock()
            self.receipts.move_to_end(key)
            self._release(digest)
            self._prune(receipt.created_at)

    def _translate_once(self, credential, payload, request_id):
        messages = [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': json.dumps(
                {'text': payload.text,
                 'target_language': payload.target_language},
                ensure_ascii=False, allow_nan=False)},
        ]
        transport = self.transport_factory(credential, payload.model)
        try:
            # Exactly one transport call; tools=[] means no tool loop and no
            # retry.  Every provider failure becomes one neutral error.
            result = transport.complete_once(messages, [])
        except WorkspaceError:
            raise _failure(PROVIDER_CODE, PROVIDER_MESSAGE, 502) from None
        except Exception:
            raise _failure(PROVIDER_CODE, PROVIDER_MESSAGE, 502) from None
        text = translated_text(result)
        return {
            'request_id': request_id,
            'text_sha256': _text_digest(payload.text),
            'target_language': payload.target_language,
            'model': payload.model,
            'translated_text': text,
        }


# ----------------------------------------------------------------- HTTP layer
def _json(payload, status):
    return JSONResponse(payload, status_code=status, headers={
        'Cache-Control': 'no-store', 'Pragma': 'no-cache'})


def _error(code, message, status, headers=None):
    merged = {'Cache-Control': 'no-store', 'Pragma': 'no-cache'}
    if headers:
        merged.update(headers)
    return JSONResponse({'detail': {'code': code, 'message': message}},
                        status_code=status, headers=merged)


class DeviceAiBoundary:
    """Force no-store on every response for the device relay paths.

    The middleware only injects cache headers; loopback, origin, method and
    body limits stay with the existing ``LocalBoundary`` and route.
    """

    def __init__(self, app, paths=None):
        self.app = app
        self.paths = frozenset(paths or (DEVICE_AI_PATH,))

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('path') not in self.paths:
            return await self.app(scope, receive, send)

        async def wrapped_send(message):
            if message['type'] == 'http.response.start':
                headers = message.setdefault('headers', [])
                for name, value in ((b'cache-control', b'no-store'),
                                    (b'pragma', b'no-cache')):
                    headers[:] = [(key, item) for key, item in headers
                                  if key.lower() != name]
                    headers.append((name, value))
            await send(message)

        await self.app(scope, receive, wrapped_send)


def credential_from_scope(scope):
    """Return the sole, strictly formatted Bearer credential, or ``None``."""
    values = [value for key, value in scope.get('headers', ())
              if key.lower() == b'authorization']
    if len(values) != 1:
        return None
    try:
        decoded = values[0].decode('latin-1')
    except UnicodeDecodeError:  # pragma: no cover - latin-1 always decodes
        return None
    match = _CREDENTIAL.fullmatch(decoded)
    return match.group(1) if match is not None else None


def requested_model_source(scope):
    """Return ``None`` (legacy), ``'shared'``, ``'personal'`` or raise.

    A duplicate or unknown source header is rejected instead of being resolved
    to an ambiguous default.
    """
    values = [value for key, value in scope.get('headers', ())
              if key.lower() == SOURCE_HEADER]
    if not values:
        return None
    if len(values) != 1:
        raise _failure(SOURCE_CODE, SOURCE_MESSAGE, 422)
    try:
        decoded = values[0].decode('latin-1')
    except UnicodeDecodeError:  # pragma: no cover - latin-1 always decodes
        raise _failure(SOURCE_CODE, SOURCE_MESSAGE, 422) from None
    if decoded not in (SOURCE_SHARED, SOURCE_PERSONAL):
        raise _failure(SOURCE_CODE, SOURCE_MESSAGE, 422)
    return decoded


def _has_authorization(scope):
    return any(key.lower() == b'authorization'
               for key, _ in scope.get('headers', ()))


def resolve_device_access(scope, shared_model=None,
                          credential_message=CREDENTIAL_MESSAGE):
    """Resolve the credential a device request may use.

    Returns ``(credential, shared_config)``.  ``shared_config`` is the resolved
    operator configuration for a shared request and ``None`` otherwise; the
    caller compares the confirmed model against it before any provider call.
    Shared requests must not carry any Authorization header, and malformed or
    duplicate Authorization never silently becomes the site credential.
    """
    source = requested_model_source(scope)
    if source == SOURCE_SHARED:
        if _has_authorization(scope):
            raise _failure(SOURCE_CODE, SOURCE_MESSAGE, 422)
        config = shared_model.load() if shared_model is not None else None
        if config is None:
            raise _failure(SHARED_UNAVAILABLE_CODE, SHARED_UNAVAILABLE_MESSAGE,
                           503)
        return config['api_key'], config
    credential = credential_from_scope(scope)
    if credential is None:
        raise _failure(CREDENTIAL_CODE, credential_message, 401)
    return credential, None


def shared_model_mismatch(payload, shared_config):
    """True when an explicitly shared request names another model."""
    return shared_config is not None and payload.model != shared_config['model']


def json_media_type(request):
    raw = request.headers.get('content-type')
    if raw is None:
        return False
    return raw.split(';', 1)[0].strip().lower() == 'application/json'


async def _read_bounded_body(request, limit=MAX_BODY_BYTES):
    """Read the request body with a hard byte bound, ignoring a false length."""
    raw_length = request.headers.get('content-length')
    if raw_length is not None:
        length = raw_length.strip()
        if not length.isdecimal() or int(length) > limit:
            raise _failure(BODY_CODE, BODY_MESSAGE, 413)
    body = bytearray()
    async for chunk in request.stream():
        if not chunk:
            continue
        # Check the bound before extending so one oversized ASGI chunk cannot
        # force a second large body allocation.
        if len(body) + len(chunk) > limit:
            raise _failure(BODY_CODE, BODY_MESSAGE, 413)
        body.extend(chunk)
    return bytes(body)


def _endpoint(relay, shared_model=None):
    async def translate(request: Request):
        if not json_media_type(request):
            return _error(MEDIA_CODE, MEDIA_MESSAGE, 415)
        try:
            credential, shared_config = resolve_device_access(
                request.scope, shared_model)
        except WorkspaceError as error:
            return _error(error.code, error.message, error.status)
        try:
            body = await _read_bounded_body(request)
        except WorkspaceError as error:
            return _error(error.code, error.message, error.status)
        try:
            payload = DeviceSelectionTranslationRequest.model_validate_json(body)
        except ValidationError:
            return _error(VALIDATION_CODE, VALIDATION_MESSAGE, 422)
        if shared_model_mismatch(payload, shared_config):
            return _error(SHARED_CHANGED_CODE, SHARED_CHANGED_MESSAGE, 409)
        try:
            result = await run_in_threadpool(
                relay.translate, credential, payload)
        except WorkspaceError as error:
            return _error(error.code, error.message, error.status)
        return _json(result, 200)
    return translate


def _connection_endpoint(shared_model):
    async def connection():
        # Capability only: no configuration read beyond validity, no upstream
        # call, no credential and no response cache.
        return _json(shared_connection_status(shared_model), 200)
    return connection


def _method_not_allowed():
    return _error(METHOD_CODE, METHOD_MESSAGE, 405, {'Allow': 'POST'})


def _connection_method_not_allowed():
    return _error(METHOD_CODE, CONNECTION_METHOD_MESSAGE, 405,
                  {'Allow': 'GET'})



def install_device_ai_routes(app, relay=None, shared_model=None):
    """Install the shared device relay routes before the static mount.

    One relay instance serves both the selected-text translation endpoint and
    the explicit question endpoint, so their admission slots and terminal
    receipts are shared.  ``shared_model`` is the operator resolver used for the
    explicit shared source and the read-only connection status; ``None`` keeps
    the owner/local device path personal-only.
    """
    from .device_question import (
        DEVICE_QUESTION_PATH, install_device_question_route)

    relay = relay or DeviceAiRelay()
    app.state.device_ai = relay
    app.state.device_shared_model = shared_model
    app.add_middleware(
        DeviceAiBoundary,
        paths=(DEVICE_AI_PATH, DEVICE_QUESTION_PATH, DEVICE_CONNECTION_PATH))
    app.add_api_route(DEVICE_CONNECTION_PATH, _connection_endpoint(shared_model),
                      methods=['GET'], include_in_schema=False)
    app.add_api_route(
        DEVICE_CONNECTION_PATH, _connection_method_not_allowed,
        methods=['POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
        include_in_schema=False)
    app.add_api_route(DEVICE_AI_PATH, _endpoint(relay, shared_model),
                      methods=['POST'], include_in_schema=False)
    app.add_api_route(
        DEVICE_AI_PATH, _method_not_allowed,
        methods=['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
        include_in_schema=False)
    install_device_question_route(app, relay, shared_model=shared_model)
    return relay
