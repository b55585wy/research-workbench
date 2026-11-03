"""Persist directed rectangle/arrow/textbox/line/ellipse/freehand geometry beside the
existing PDF note lifecycle.

The closed shape contract grows by distinct model classes per new kind instead of widening
the literals of the existing ones, so old stored field sets and serializations stay byte
identical.
"""
import html
import json
import math
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA = '''
CREATE TABLE IF NOT EXISTS note_shape_annotations (
 note_id TEXT PRIMARY KEY REFERENCES notes(id),
 original_json TEXT NOT NULL CHECK(json_valid(original_json) AND length(original_json)<=65536),
 current_json TEXT NOT NULL CHECK(json_valid(current_json) AND length(current_json)<=65536)
);
'''
COLORS = {'yellow': '#ffe069', 'green': '#91dab1', 'blue': '#91c8f6', 'pink': '#efa9cf'}
# Dark inks keep white-box text readable; these are the only accepted textbox colors.
TEXTBOX_COLORS = {'black': '#1f2937', 'blue': '#1d4ed8', 'green': '#166534', 'red': '#b91c1c'}
KIND_LABELS = {'rectangle': '矩形 / rectangle', 'arrow': '箭头 / arrow', 'textbox': '文本框 / textbox',
               'line': '直线 / line', 'ellipse': '圆形 / ellipse', 'ink': '手绘 / freehand'}
HALF_PIXEL = 0.0005
MAX_TEXTBOX_BODY = 2000
MAX_INK_POINTS = 512


def normalized_points(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError('Exactly two shape points are required')
    points = []
    for pair in value:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise ValueError('Each shape point needs two coordinates')
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in pair):
            raise ValueError('Finite numeric shape coordinates required')
        if any(not 0 <= v <= 1 for v in pair):
            raise ValueError('Shape coordinates must be normalized page fractions')
        points.append((float(pair[0]), float(pair[1])))
    return points


def normalized_ink_points(value):
    """Validate one freehand stroke path of 2..512 normalized points.

    Coordinate rules are the shared shape rules; bools and strings are rejected by the
    exact type check, and a stroke needs at least two distinct pairs (a closed stroke may
    repeat its first pair as its last one).
    """
    if not isinstance(value, (list, tuple)) or not 2 <= len(value) <= MAX_INK_POINTS:
        raise ValueError(f'A freehand stroke needs between 2 and {MAX_INK_POINTS} points')
    points = []
    for pair in value:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise ValueError('Each shape point needs two coordinates')
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in pair):
            raise ValueError('Finite numeric shape coordinates required')
        if any(not 0 <= v <= 1 for v in pair):
            raise ValueError('Shape coordinates must be normalized page fractions')
        points.append((float(pair[0]), float(pair[1])))
    if len({tuple(pair) for pair in points}) < 2:
        raise ValueError('A freehand stroke needs two different points')
    return points


def geometry_bounds(kind, points):
    if kind in ('rectangle', 'textbox', 'ellipse'):
        if points[0][0] == points[1][0] or points[0][1] == points[1][1]:
            if kind == 'rectangle':
                raise ValueError('A rectangle needs two different corners on both axes')
            if kind == 'textbox':
                raise ValueError('A text box needs two different corners on both axes')
            raise ValueError('An ellipse needs two different corners on both axes')
    elif kind in ('arrow', 'line'):
        if points[0] == points[1]:
            raise ValueError('Arrow endpoints must differ' if kind == 'arrow' else 'Line endpoints must differ')
    elif kind == 'ink':
        if len(points) < 2 or len({tuple(pair) for pair in points}) < 2:
            raise ValueError('A freehand stroke needs two different points')
    else:
        raise ValueError('Unknown shape kind')
    left, right = sorted((points[0][0], points[1][0]))
    top, bottom = sorted((points[0][1], points[1][1]))
    if kind == 'ink':
        # A freehand stroke is bounded by every saved point, never by its first and last.
        left, right = min(p[0] for p in points), max(p[0] for p in points)
        top, bottom = min(p[1] for p in points), max(p[1] for p in points)
    if kind in ('arrow', 'line', 'ink'):
        # A straight arrow/line and a flat stroke keep their direction; only a degenerate
        # axis is padded, and the stored path itself is never rewritten.
        if left == right:
            left, right = max(0.0, left - HALF_PIXEL), min(1.0, right + HALF_PIXEL)
        if top == bottom:
            top, bottom = max(0.0, top - HALF_PIXEL), min(1.0, bottom + HALF_PIXEL)
    return [left, top, right, bottom]


class ShapeStyle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['rectangle', 'arrow']
    color: Literal['yellow', 'green', 'blue', 'pink']
    line_width: int = Field(strict=True, ge=1, le=4)


class ShapeAnnotation(ShapeStyle):
    points: list[tuple[float, float]] = Field(min_length=2, max_length=2)

    @field_validator('points', mode='before')
    @classmethod
    def strict_points(cls, value):
        return normalized_points(value)

    @model_validator(mode='after')
    def consistent_geometry(self):
        geometry_bounds(self.kind, self.points)
        return self

    def bounds(self):
        return geometry_bounds(self.kind, list(self.points))


class ShapeRecord(ShapeAnnotation):
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


class TextboxStyle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['textbox']
    color: Literal['black', 'blue', 'green', 'red']
    font_size: int = Field(strict=True, ge=8, le=48)


class TextboxAnnotation(TextboxStyle):
    points: list[tuple[float, float]] = Field(min_length=2, max_length=2)

    @field_validator('points', mode='before')
    @classmethod
    def strict_points(cls, value):
        return normalized_points(value)

    @model_validator(mode='after')
    def consistent_geometry(self):
        geometry_bounds(self.kind, self.points)
        return self

    def bounds(self):
        return geometry_bounds(self.kind, list(self.points))


class TextboxRecord(TextboxAnnotation):
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


class DrawingStyle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['line', 'ellipse']
    color: Literal['yellow', 'green', 'blue', 'pink']
    line_width: int = Field(strict=True, ge=1, le=4)


class DrawingAnnotation(DrawingStyle):
    points: list[tuple[float, float]] = Field(min_length=2, max_length=2)

    @field_validator('points', mode='before')
    @classmethod
    def strict_points(cls, value):
        return normalized_points(value)

    @model_validator(mode='after')
    def consistent_geometry(self):
        geometry_bounds(self.kind, self.points)
        return self

    def bounds(self):
        return geometry_bounds(self.kind, list(self.points))


class DrawingRecord(DrawingAnnotation):
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


class InkStyle(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['ink']
    color: Literal['yellow', 'green', 'blue', 'pink']
    line_width: int = Field(strict=True, ge=1, le=4)


class InkAnnotation(InkStyle):
    points: list[tuple[float, float]] = Field(min_length=2, max_length=MAX_INK_POINTS)

    @field_validator('points', mode='before')
    @classmethod
    def strict_points(cls, value):
        return normalized_ink_points(value)

    @model_validator(mode='after')
    def consistent_geometry(self):
        geometry_bounds(self.kind, self.points)
        return self

    def bounds(self):
        return geometry_bounds(self.kind, list(self.points))


class InkRecord(InkAnnotation):
    source_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')


ShapeAnnotationInput = Annotated[Union[ShapeAnnotation, TextboxAnnotation, DrawingAnnotation, InkAnnotation],
                                 Field(discriminator='kind')]
# A note's immutable creation record and its current record are rebuilt with the class
# selected by the explicit stored kind, so a new kind can never fall back to an old shape.
RECORD_MODELS = {'rectangle': ShapeRecord, 'arrow': ShapeRecord, 'textbox': TextboxRecord,
                 'line': DrawingRecord, 'ellipse': DrawingRecord, 'ink': InkRecord}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def creation_json(payload, source_sha256):
    if payload.shape_annotation is None:
        return None
    return canonical({**payload.shape_annotation.model_dump(mode='json'), 'source_sha256': source_sha256})


def current_json(shape):
    return canonical(shape)


def record_model(kind):
    model = RECORD_MODELS.get(kind) if isinstance(kind, str) else None
    if model is None:
        raise ValueError('Invalid shape record')
    return model


def add_record(state, original_raw, current_raw):
    if original_raw is None and current_raw is None:
        return state
    from .models import WorkspaceError
    try:
        if original_raw is None or current_raw is None:
            raise ValueError('Incomplete shape record')
        original_value = json.loads(original_raw)
        current_value = json.loads(current_raw)
        if not isinstance(original_value, dict) or not isinstance(current_value, dict):
            raise ValueError('Invalid shape record')
        original_model = record_model(original_value.get('kind'))
        current_model = record_model(current_value.get('kind'))
        original = original_model.model_validate(original_value)
        current = current_model.model_validate(current_value)
        if state['page'] is None or state['rect'] is None:
            raise ValueError('Shape source missing')
        if any(abs(a - b) > 1e-6 for a, b in zip(original.bounds(), state['rect'])):
            raise ValueError('Shape bounds changed')
        if current.kind != original.kind or current.source_sha256 != original.source_sha256:
            raise ValueError('Shape identity changed')
        state['shape_annotation'] = current.model_dump(mode='json')
        state['rect'] = current.bounds()
    except (ValueError, TypeError):
        raise WorkspaceError('shape_annotation_changed', '形状批注来源记录不完整，请重新绘制后重试。', 409) from None
    return state


def export_summary(shape):
    kind = KIND_LABELS.get(shape['kind'], shape['kind'])
    points = shape['points']
    if shape['kind'] == 'arrow':
        geometry = f"({points[0][0]:.3f}, {points[0][1]:.3f}) → ({points[1][0]:.3f}, {points[1][1]:.3f})"
    elif shape['kind'] == 'line':
        geometry = f"({points[0][0]:.3f}, {points[0][1]:.3f}) — ({points[1][0]:.3f}, {points[1][1]:.3f})"
        return f"{kind} · {shape['color']} · {shape['line_width']} PDF units · {len(points)} points · {geometry}"
    elif shape['kind'] == 'ellipse':
        left, top, right, bottom = geometry_bounds('ellipse', points)
        geometry = f"[{left:.3f}, {top:.3f}, {right:.3f}, {bottom:.3f}]"
        return f"{kind} · {shape['color']} · {shape['line_width']} PDF units · {len(points)} points · {geometry}"
    elif shape['kind'] == 'ink':
        # Summaries stay bounded: one stroke, the point count and the bounds, never the path.
        left, top, right, bottom = geometry_bounds('ink', points)
        geometry = f"[{left:.3f}, {top:.3f}, {right:.3f}, {bottom:.3f}]"
        return (f"{kind} · {shape['color']} · {shape['line_width']} PDF units · 1 stroke · "
                f"{len(points)} points · {geometry}")
    elif shape['kind'] == 'textbox':
        left, top, right, bottom = geometry_bounds('textbox', points)
        geometry = f"[{left:.3f}, {top:.3f}, {right:.3f}, {bottom:.3f}]"
        return f"{kind} · {shape['color']} · {shape['font_size']} pt · {geometry}"
    else:
        left, top, right, bottom = geometry_bounds('rectangle', points)
        geometry = f"[{left:.3f}, {top:.3f}, {right:.3f}, {bottom:.3f}]"
    return f"{kind} · {shape['color']} · {shape['line_width']} PDF units · {geometry}"


def export_markup(note):
    shape = note.get('shape_annotation')
    if not shape:
        return ''
    summary = html.escape(export_summary(shape))
    label = {'textbox': '文本框 / Text box', 'line': '直线 / Line', 'ellipse': '圆形 / Ellipse',
             'ink': '手绘 / Freehand'}.get(shape['kind'], '形状标注 / Shape annotation')
    return f'<p class="shape-annotation">{label}: {summary}</p>'


def agent_record(shape):
    """Bounded assistant metadata for a saved shape.

    Old kinds pass through unchanged. A freehand stroke is a manual drawing whose full path
    would dominate the shared context budget, so the assistant receives one stroke, its
    point count and its bounds instead of every sampled point.
    """
    if not isinstance(shape, dict) or shape.get('kind') != 'ink':
        return shape
    points = shape.get('points') or []
    return {'kind': 'ink', 'color': shape.get('color'), 'line_width': shape.get('line_width'),
            'source_sha256': shape.get('source_sha256'), 'stroke_count': 1,
            'point_count': len(points), 'bounds': geometry_bounds('ink', points)}


