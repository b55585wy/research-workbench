"""Independent HTTPS model transport, adapted from tFUS Provider.complete.

No tFUS imports, credential writes, redirects or model-selected endpoints.
"""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .models import WorkspaceError


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


class ModelConnection:
    def __init__(self,root,inherited=None,opener=None):
        self.path=Path(root)/'.agent-model.json'
        self.inherited=Path(inherited) if inherited else None
        self.opener=opener or urllib.request.build_opener(NoRedirect())
        self.connection_state='unverified'
        self.lock=threading.Lock()

    def config(self):
        path=self.path if self.path.is_file() else self.inherited
        if path is None or not path.is_file():
            return {},'none'
        try:
            value=json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value,dict):raise ValueError()
            return value,'local' if path==self.path else 'inherited'
        except (OSError,ValueError):
            return {},'none'

    def status(self):
        config,source=self.config()
        configured=bool(config.get('api_key') and config.get('model') and config.get('base_url'))
        return {'configured':configured,'model':config.get('model') if configured else None,
                'image_input':configured and config.get('supports_images') is True,
                'connection_source':source,'connection_state':self.connection_state if configured else 'not_configured',
                'scope':'local_research','multi_user_auth':False}

    def save(self,payload):
        data=payload.model_dump()
        data.update(base_url=data['base_url'].strip().rstrip('/'),model=data['model'].strip(),api_key=data['api_key'].strip())
        self.validate(data)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        temporary=None
        try:
            with tempfile.NamedTemporaryFile(dir=self.path.parent,suffix='.private',delete=False) as stream:
                temporary=Path(stream.name)
                os.chmod(temporary,0o600)
                stream.write(json.dumps(data,ensure_ascii=True).encode())
                stream.flush();os.fsync(stream.fileno())
            with self.lock:temporary.replace(self.path)
            self.connection_state='unverified'
            return self.status()
        finally:
            if temporary is not None:temporary.unlink(missing_ok=True)

    @staticmethod
    def validate(config):
        try:
            url=urlsplit(config.get('base_url',''))
            valid=url.scheme=='https' and bool(url.hostname) and not any((url.username,url.password,url.query,url.fragment))
        except ValueError:
            valid=False
        if not valid or not str(config.get('model','')).strip() or not str(config.get('api_key','')).strip():
            raise WorkspaceError('agent_invalid_provider','请填写有效的 HTTPS 模型地址、模型名称和密钥。',422)

    def complete(self,messages,tools):
        config,_=self.config()
        if not config.get('api_key'):
            raise WorkspaceError('agent_not_configured','尚未连接模型，请先配置研究助手连接。',409)
        self.validate(config)
        value={'model':config['model'],'messages':messages,'stream':False,'max_tokens':2400,'temperature':0.2}
        if tools:value['tools']=tools
        if urlsplit(config['base_url']).hostname=='api.deepseek.com':
            value['thinking']={'type':'disabled'}
        request=urllib.request.Request(config['base_url'].rstrip('/')+'/chat/completions',
            data=json.dumps(value,ensure_ascii=True,allow_nan=False).encode(),
            headers={'Authorization':'Bearer '+config['api_key'],'Content-Type':'application/json'},method='POST')
        try:
            self.connection_state='connecting'
            raw=self.request(request)
            if len(raw)>256*1024:raise ValueError()
            choice=json.loads(raw)['choices'][0]
            message=choice['message']
            if not isinstance(message,dict) or message.get('role') not in ('assistant',None):raise ValueError()
            result={key:message[key] for key in ('role','content','tool_calls') if key in message}
            result['finish_reason']=choice.get('finish_reason')
            self.connection_state='connected'
            return result
        except urllib.error.HTTPError as error:
            self.connection_state='unavailable'
            raise WorkspaceError('agent_provider_error',f'模型服务请求失败（HTTP {error.code}），请检查连接。',502) from None
        except (urllib.error.URLError,TimeoutError,OSError):
            self.connection_state='unavailable'
            raise WorkspaceError('agent_provider_unavailable','暂时无法连接模型服务，请稍后重试。',502) from None
        except (KeyError,IndexError,ValueError,TypeError):
            self.connection_state='unavailable'
            raise WorkspaceError('agent_provider_response','模型返回格式不符合工具调用协议。',502) from None

    def request(self,request):
        for attempt in range(2):
            try:
                with self.opener.open(request,timeout=35) as response:
                    return response.read(256*1024+1)
            except urllib.error.HTTPError:
                raise
            except (urllib.error.URLError,TimeoutError,OSError):
                if attempt:raise
                time.sleep(.2)
