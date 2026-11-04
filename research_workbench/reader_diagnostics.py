"""Small, source-scoped PDF failure reports for the private service journal."""
from collections import deque
import json
import logging
import re
from threading import Lock
import time
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from . import __version__
from .models import WorkspaceError


class ReaderFeatures(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    with_resolvers: bool
    promise_try: bool
    structured_clone: bool
    worker: bool
    offscreen_canvas: bool
    image_decoder: bool
    dom_matrix: bool
    readable_stream: bool
    array_buffer_transfer: bool


class ReaderFailure(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    stage: Literal['document', 'render']
    error_name: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    message: Annotated[str, StringConstraints(max_length=300)]
    user_agent: Annotated[str, StringConstraints(max_length=300)]
    app_version: Annotated[str, StringConstraints(max_length=24)]
    pdfjs_version: Annotated[str, StringConstraints(max_length=24)]
    elapsed_ms: Annotated[int, Field(ge=0, le=3_600_000)]
    loaded_bytes: Annotated[int, Field(ge=0, le=2_147_483_647)]
    total_bytes: Annotated[int, Field(ge=0, le=2_147_483_647)] | None
    features: ReaderFeatures


def clean_technical_text(value):
    value = re.sub(r'(?:https?|file|blob|data):\S+', '[resource]', value,
                   flags=re.IGNORECASE)
    value = re.sub(r'\b[A-Za-z]:[\\/]\S+', '[path]', value)
    value = re.sub(r'\bBearer\s+\S+', '[credential]', value, flags=re.IGNORECASE)
    value = re.sub(r'\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}', '[credential]', value)
    return ' '.join(value.split())[:300]


class ReaderErrorReporter:
    def __init__(self, store, *, clock=time.monotonic):
        self.store = store
        self.clock = clock
        self.recent = deque()
        self.lock = Lock()
        self.logger = logging.getLogger('research_workbench.reader')

    def record(self, document_id, payload):
        source = self.store.get_document(document_id)
        if source.get('kind') == 'study':
            raise WorkspaceError('source_has_no_pdf', '此研究没有原始 PDF。', 409)
        moment = self.clock()
        with self.lock:
            while self.recent and moment - self.recent[0] >= 60:
                self.recent.popleft()
            if len(self.recent) >= 10:
                raise WorkspaceError('reader_error_rate_limited',
                                     '错误记录过于频繁，请稍后重试。', 429)
            self.recent.append(moment)
        identifier = str(uuid4())
        details = payload.model_dump()
        for field in ('error_name', 'message', 'user_agent', 'app_version', 'pdfjs_version'):
            details[field] = clean_technical_text(details[field])
        event = {'report_id': identifier, 'document_id': document_id,
                 'server_version': __version__, **details}
        # Fixed JSON fields; never include request headers, file data or a stack.
        self.logger.warning('reader_open_failure %s', json.dumps(event, ensure_ascii=True))
        return {'report_id': identifier}


router = APIRouter(prefix='/api/v1')


@router.post('/documents/{document_id}/reader-errors')
def report_reader_failure(document_id: UUID, payload: ReaderFailure, request: Request):
    return request.app.state.reader_errors.record(str(document_id), payload)
