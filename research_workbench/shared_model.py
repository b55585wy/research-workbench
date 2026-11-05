"""Operator-owned shared model connection for opt-in guest spaces.

The shared configuration is a root-controlled file *outside* every guest space.
It is read on demand, never copied into a guest directory, never returned in an
HTTP response and never placed in a worker command line.  Only its model name is
exposed as a capability.  A guest's own ``.agent-model.json`` always has
priority; when that file exists but is invalid (or is a symlink) the guest fails
closed instead of silently spending the operator's credit.

The accepted file shape is the existing connection shape::

    {"base_url": "https://api.deepseek.com", "model": "...",
     "api_key": "...", "supports_images": false}

Only the fixed official DeepSeek HTTPS endpoint is accepted.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from .agent_provider import ModelConnection
from .models import WorkspaceError

SHARED_MODEL_HOST = 'api.deepseek.com'
SHARED_MODEL_PATHS = ('', '/v1')
MAX_SHARED_MODEL_BYTES = 8192
MAX_SHARED_MODEL_CHARS = 100
MAX_SHARED_KEY_CHARS = 512

# Visible ASCII only: no spaces, controls or non-ASCII characters.
_VISIBLE = re.compile(r'^[!-~]+$')

UNAVAILABLE_CODE = 'shared_model_unavailable'
UNAVAILABLE_MESSAGE = '平台连接暂不可用，请使用自己的 Key。'
ENDPOINT_CODE = 'agent_endpoint_not_allowed'
ENDPOINT_MESSAGE = '公共访客模式仅支持 DeepSeek 官方模型地址。'
RESET_CODE = 'shared_model_reset_failed'
RESET_MESSAGE = '暂时无法清除个人连接，请稍后重试。'


def _inside(child, parent):
    """Windows-safe absolute containment check; unknown shapes fail closed."""
    try:
        child_value = os.path.normcase(os.path.abspath(os.fspath(child)))
        parent_value = os.path.normcase(os.path.abspath(os.fspath(parent)))
    except (OSError, TypeError, ValueError):
        return True
    if child_value == parent_value:
        return True
    try:
        return os.path.commonpath([child_value, parent_value]) == parent_value
    except ValueError:
        return False


def _visible(value, limit):
    return (isinstance(value, str) and 0 < len(value) <= limit
            and _VISIBLE.fullmatch(value) is not None)


def official_endpoint(raw):
    """Return the normalized official base URL, or ``None``."""
    if not isinstance(raw, str):
        return None
    value = raw.strip().rstrip('/')
    try:
        url = urlsplit(value)
        valid = (
            url.scheme == 'https'
            and url.hostname == SHARED_MODEL_HOST
            and url.port is None
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and url.path in SHARED_MODEL_PATHS
            and value == f'https://{SHARED_MODEL_HOST}{url.path}')
    except ValueError:
        valid = False
    return value if valid else None


def validate_official(config):
    """Existing connection validation plus the fixed official endpoint rule."""
    ModelConnection.validate(config)
    if official_endpoint(config.get('base_url')) is None:
        raise WorkspaceError(ENDPOINT_CODE, ENDPOINT_MESSAGE, 422)


class SharedModel:
    """Read-only view of the operator file, tolerant of any bad state.

    Every problem (absent path, symlink, directory, oversized/unreadable file,
    malformed JSON, non-official endpoint, invalid fields, path inside a guest
    space) simply disables sharing.  No raw error, path or secret is surfaced.
    """

    def __init__(self, path=None, *, forbidden_root=None):
        self.path = Path(path) if path is not None else None
        self.forbidden_root = (Path(forbidden_root)
                               if forbidden_root is not None else None)

    def _readable(self):
        if self.path is None:
            return False
        try:
            if self.forbidden_root is not None and _inside(
                    self.path, self.forbidden_root):
                return False
            if self.path.is_symlink():
                return False
            if not self.path.is_file():
                return False
            size = self.path.stat().st_size
        except OSError:
            return False
        return 0 < size <= MAX_SHARED_MODEL_BYTES

    def load(self):
        if not self._readable():
            return None
        try:
            with self.path.open('rb') as stream:
                raw = stream.read(MAX_SHARED_MODEL_BYTES + 1)
        except OSError:
            return None
        if not raw or len(raw) > MAX_SHARED_MODEL_BYTES:
            return None
        try:
            value = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            return None
        if not isinstance(value, dict):
            return None
        model = value.get('model')
        api_key = value.get('api_key')
        if not _visible(model, MAX_SHARED_MODEL_CHARS):
            return None
        if not _visible(api_key, MAX_SHARED_KEY_CHARS):
            return None
        base_url = official_endpoint(value.get('base_url'))
        if base_url is None:
            return None
        supports_images = value.get('supports_images', False)
        if not isinstance(supports_images, bool):
            return None
        config = {'base_url': base_url, 'model': model,
                  'api_key': api_key, 'supports_images': supports_images}
        try:
            validate_official(config)
        except Exception:
            return None
        return config

    def status(self):
        """Capability only: exactly the two public fields, never the key."""
        config = self.load()
        return {
            'shared_available': config is not None,
            'shared_model': None if config is None else config['model'],
        }


def shared_connection_status(shared_model):
    """Public device connection capability for a ``SharedModel`` or ``None``."""
    if shared_model is None:
        return {'shared_available': False, 'shared_model': None}
    return shared_model.status()


class SharedFallbackModelConnection(ModelConnection):
    """Own-key-first connection with an explicit operator shared fallback.

    A personal file that exists but is unusable fails closed: the shared key is
    only used when there is no personal file at all, so a broken personal
    connection never silently bills the operator.  The fallback is not attempted
    after a personal provider failure either; it is a configuration resolution
    rule, not a retry.

    ``guest_policy`` applies the public-guest fixed official endpoint rule to a
    personal file too.  It is enabled for every guest connection (with or
    without a shared file) and disabled for the owner's unchanged behaviour.
    """

    def __init__(self, root, inherited=None, shared_model=None,
                 guest_policy=None):
        super().__init__(root, inherited)
        self.shared_model = shared_model
        # A shared file is only ever wired by the guest gateway.
        self.guest_policy = (shared_model is not None
                             if guest_policy is None else bool(guest_policy))

    @classmethod
    def from_paths(cls, root, agent_config=None, shared_model_config=None,
                   guest_policy=None, forbidden_root=None):
        shared = (SharedModel(
            shared_model_config,
            forbidden_root=(forbidden_root if forbidden_root is not None
                            else root))
            if shared_model_config is not None else None)
        return cls(root, agent_config, shared, guest_policy=guest_policy)

    def validate(self, config):
        if self.guest_policy:
            validate_official(config)
        else:
            ModelConnection.validate(config)

    def shared_status(self):
        if self.shared_model is None:
            return {'shared_available': False, 'shared_model': None}
        return self.shared_model.status()

    def config(self):
        if not self.guest_policy and self.shared_model is None:
            return ModelConnection.config(self)
        try:
            symlink = self.path.is_symlink()
            present = symlink or self.path.exists()
        except OSError:
            return {}, 'none'
        if symlink:
            # An invalid or redirected personal file fails closed.
            return {}, 'none'
        if present:
            if not self.path.is_file():
                return {}, 'none'
            try:
                config, _ = ModelConnection.config(self)
            except Exception:
                return {}, 'none'
            if not isinstance(config, dict) or not config:
                return {}, 'none'
            try:
                self.validate(config)
            except Exception:
                return {}, 'none'
            return config, 'local'
        if self.shared_model is not None:
            config = self.shared_model.load()
            if config is not None:
                return dict(config), 'shared'
        return {}, 'none'

    def status(self):
        status = ModelConnection.status(self)
        status.update(self.shared_status())
        return status

    def use_shared(self):
        """Explicitly drop this space's personal connection in favour of shared."""
        if self.shared_status()['shared_available'] is not True:
            raise WorkspaceError(UNAVAILABLE_CODE, UNAVAILABLE_MESSAGE, 409)
        try:
            if self.path.is_symlink() or self.path.is_file():
                self.path.unlink()
            elif self.path.exists():
                # Never remove a directory or another shape in the guest space.
                raise WorkspaceError(RESET_CODE, RESET_MESSAGE, 409)
        except WorkspaceError:
            raise
        except OSError:
            raise WorkspaceError(RESET_CODE, RESET_MESSAGE, 409) from None
        self.connection_state = 'unverified'
        return self.status()
