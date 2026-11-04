"""Immutable per-page sources for one selected quotation/note."""
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator
from .text_annotations import AnnotationCreate, canonical

SCHEMA = '''
CREATE TABLE IF NOT EXISTS note_source_segments (
 note_id TEXT PRIMARY KEY REFERENCES notes(id),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 segments_json TEXT NOT NULL CHECK(json_valid(segments_json) AND length(segments_json)<=262144)
);
'''


class SourceSegment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    page: int = Field(strict=True, ge=1, le=200)
    quote: str = Field(min_length=1, max_length=10000)
    rects: list[tuple[float, float, float, float]] = Field(min_length=1, max_length=256)

    @field_validator('quote')
    @classmethod
    def meaningful_quote(cls, value):
        return AnnotationCreate.meaningful_quote(value)

    @field_validator('rects', mode='before')
    @classmethod
    def valid_rects(cls, value):
        return AnnotationCreate.strict_rects(value)

    def bounds(self):
        return (min(r[0] for r in self.rects), min(r[1] for r in self.rects),
                max(r[2] for r in self.rects), max(r[3] for r in self.rects))


def validate_order(segments):
    pages = [s.page for s in segments]
    if not 1 <= len(pages) <= 20 or pages != sorted(set(pages)):
        raise ValueError('Sources must have unique ascending pages (up to 20)')
    if sum(len(s.quote) for s in segments) > 10000:
        raise ValueError('Selected quotation exceeds 10000 characters')
    return segments


def validate_anchor(segments, page, rect, annotation=None):
    first = validate_order(segments)[0]
    if page != first.page or rect is None or any(abs(a-b) > 1e-6 for a, b in zip(first.bounds(), rect)):
        raise ValueError('Primary anchor must match the first page source')
    if annotation and (annotation.quote != first.quote or annotation.rects != first.rects):
        raise ValueError('Text annotation must match the first page source')


def creation_json(payload):
    if payload.source_segments is None:
        return None
    value = canonical([s.model_dump(mode='json') for s in payload.source_segments])
    if len(value) > 262144:
        from .models import WorkspaceError
        raise WorkspaceError('selection_too_large', '选区位置记录过大，请分段保存。', 413)
    return value


def add_record(state, raw, source_sha256):
    if raw is None:
        return
    from .models import WorkspaceError
    try:
        segments = TypeAdapter(list[SourceSegment]).validate_json(raw)
        annotation = state.get('annotation')
        parsed = AnnotationCreate.model_validate({k: v for k, v in annotation.items()
            if k != 'source_sha256'}) if annotation else None
        validate_anchor(segments, state['page'], state['rect'], parsed)
        if annotation and annotation['source_sha256'] != source_sha256:
            raise ValueError('Source hash mismatch')
        state['source_segments'] = [s.model_dump(mode='json') for s in segments]
    except (ValueError, TypeError, KeyError):
        raise WorkspaceError('selection_source_changed', '选区来源记录不完整，请保留笔记后重试。', 409) from None


def pdf_notes(notes):
    """Expand only the export snapshot; saved identities and records stay intact."""
    from uuid import UUID, uuid5
    for note in notes:
        segments = note.get('source_segments')
        if not segments:
            yield note
            continue
        parsed = TypeAdapter(list[SourceSegment]).validate_python(segments)
        annotation = note.get('annotation')
        primary = AnnotationCreate.model_validate({k: v for k, v in annotation.items()
            if k != 'source_sha256'}) if annotation else None
        validate_anchor(parsed, note['page'], note['rect'], primary)
        if note.get('shape_annotation'):
            raise ValueError('Shape cannot carry text sources')
        for index, segment in enumerate(parsed):
            projected = {k: v for k, v in note.items() if k != 'source_segments'}
            projected.update(page=segment.page, rect=segment.bounds())
            if index:
                projected['id'] = str(uuid5(UUID(note['id']), f'source-page:{segment.page}'))
            if note.get('annotation'):
                projected['annotation'] = {**note['annotation'], 'quote': segment.quote,
                                           'rects': segment.model_dump(mode='json')['rects']}
            yield projected
