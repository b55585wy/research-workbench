"""Persist manual text-selection provenance alongside the existing note lifecycle."""
import html
import json
import math
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA = '''
CREATE TABLE IF NOT EXISTS note_text_annotations (
 note_id TEXT PRIMARY KEY REFERENCES notes(id),
 original_json TEXT NOT NULL CHECK(json_valid(original_json) AND length(original_json)<=262144),
 current_json TEXT NOT NULL CHECK(json_valid(current_json) AND length(current_json)<=262144)
);
'''
COLORS = {'yellow': '#ffe069', 'green': '#91dab1', 'blue': '#91c8f6', 'pink': '#efa9cf'}


class AnnotationStyle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['highlight', 'underline']
    color: Literal['yellow', 'green', 'blue', 'pink']


class AnnotationCreate(AnnotationStyle):
    quote: str = Field(min_length=1, max_length=10000)
    rects: list[tuple[float, float, float, float]] = Field(min_length=1, max_length=256)

    @field_validator('quote')
    @classmethod
    def meaningful_quote(cls, value):
        value = value.strip()
        if not value or '\x00' in value:
            raise ValueError('A selected quotation is required')
        return value

    @field_validator('rects', mode='before')
    @classmethod
    def strict_rects(cls, value):
        if not isinstance(value, list):
            raise ValueError('Line rectangles must be a list')
        for rect in value:
            if not isinstance(rect, (list, tuple)) or len(rect) != 4:
                raise ValueError('Four coordinates required')
            if any(type(v) not in (int, float) or not math.isfinite(v) for v in rect):
                raise ValueError('Finite numeric coordinates required')
            if not (0 <= rect[0] < rect[2] <= 1 and 0 <= rect[1] < rect[3] <= 1):
                raise ValueError('Positive normalized line rectangles required')
        return value

    def bounds(self):
        return (min(r[0] for r in self.rects), min(r[1] for r in self.rects),
                max(r[2] for r in self.rects), max(r[3] for r in self.rects))


class AnnotationRecord(AnnotationCreate):
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def creation_json(payload, source_sha256):
    if payload.annotation is None:
        return None
    return canonical({**payload.annotation.model_dump(mode='json'), 'source_sha256': source_sha256})


def add_record(state, raw):
    if raw is None:
        return
    from .models import WorkspaceError
    try:
        record = AnnotationRecord.model_validate_json(raw)
        if state['page'] is None or state['rect'] is None:
            raise ValueError('Annotation source missing')
        if any(abs(a-b) > 1e-6 for a, b in zip(record.bounds(), state['rect'])):
            raise ValueError('Annotation bounds changed')
        state['annotation'] = record.model_dump(mode='json')
    except (ValueError, TypeError):
        raise WorkspaceError('text_annotation_changed', '文字批注来源记录不完整，请检查后重试。', 409) from None


def export_markup(note):
    annotation = note.get('annotation')
    if not annotation:
        return ''
    color = COLORS[annotation['color']]
    style = f'background:{color}' if annotation['kind'] == 'highlight' else f'text-decoration:underline;text-decoration-color:{color}'
    quote = html.escape(annotation['quote']).replace('\n', '<br>')
    label = html.escape(annotation['kind'] + ' / ' + annotation['color'])
    return f'<p>文字批注 / Text annotation: {label}</p><blockquote><span style="{style}">{quote}</span></blockquote>'
