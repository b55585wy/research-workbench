"""Bounded saved-state input shared by the exporter and its fixed worker."""
import json
import math
import re
from uuid import UUID
from .text_annotations import COLORS as NOTE_COLORS

MAX_NOTES = 1000
MAX_RECTS = 16384
MAX_PAYLOAD_BYTES = 8 * 1024 * 1024
MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024 * 1024
COLORS = {name: value.lstrip('#') for name, value in NOTE_COLORS.items()}
FORMAT = 'research-annotated-pdf/v1'


class InvalidSnapshot(ValueError):
    pass


class SnapshotTooLarge(ValueError):
    pass


def identifier(value):
    try:
        valid = isinstance(value, str) and str(UUID(value)) == value
    except ValueError:
        valid = False
    if not valid:
        raise InvalidSnapshot('Invalid identity')
    return value


def text(value):
    if not isinstance(value, str) or not value.strip() or '\x00' in value or len(value) > 10000:
        raise InvalidSnapshot('Invalid text')
    return value


def rectangle(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise InvalidSnapshot('Invalid rectangle')
    if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in value):
        raise InvalidSnapshot('Invalid rectangle')
    if value[0] >= value[2] or value[1] >= value[3]:
        raise InvalidSnapshot('Empty rectangle')
    return list(value)


def annotation(value, bounds, source_sha256):
    if not isinstance(value, dict) or not isinstance(value.get('color'), str):
        raise InvalidSnapshot('Invalid markup')
    if value.get('kind') not in ('highlight', 'underline') or value['color'] not in COLORS:
        raise InvalidSnapshot('Invalid markup')
    if value.get('source_sha256') != source_sha256:
        raise InvalidSnapshot('Wrong markup source')
    rects = value.get('rects')
    if not isinstance(rects, list) or not 1 <= len(rects) <= 256:
        raise InvalidSnapshot('Invalid markup rectangles')
    rects = [rectangle(r) for r in rects]
    union = [min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects)]
    if bounds is None or any(abs(a-b) > 1e-6 for a, b in zip(union, bounds)):
        raise InvalidSnapshot('Markup source mismatch')
    return {'kind': value['kind'], 'color': value['color'], 'quote': text(value.get('quote')),
            'rects': rects, 'source_sha256': source_sha256}


def saved_note(value, document):
    if not isinstance(value, dict) or value.get('document_id') != document['id']:
        raise InvalidSnapshot('Wrong note owner')
    page = value.get('page')
    revision = value.get('revision')
    if type(page) is not int or not 1 <= page <= document['page_count'] or type(revision) is not int or revision < 1:
        raise InvalidSnapshot('Invalid note version or page')
    rect = None if value.get('rect') is None else rectangle(value['rect'])
    markup = None if value.get('annotation') is None else annotation(value['annotation'], rect, document['sha256'])
    return {'id': identifier(value.get('id')), 'document_id': document['id'], 'page': page,
            'revision': revision, 'text': text(value.get('text')), 'rect': rect, 'annotation': markup}


def snapshot(document, notes):
    if not isinstance(document, dict) or not isinstance(notes, list):
        raise InvalidSnapshot('Invalid snapshot')
    if type(document.get('page_count')) is not int or not 1 <= document['page_count'] <= 200:
        raise InvalidSnapshot('Invalid page count')
    if type(document.get('byte_size')) is not int or not 1 <= document['byte_size'] <= MAX_INPUT_BYTES:
        raise SnapshotTooLarge('Source size exceeded')
    if not isinstance(document.get('sha256'), str) or re.fullmatch('[0-9a-f]{64}', document['sha256']) is None:
        raise InvalidSnapshot('Invalid source hash')
    if len(notes) > MAX_NOTES:
        raise SnapshotTooLarge('Note count exceeded')
    source = {'id': identifier(document.get('id')), 'sha256': document['sha256'],
              'byte_size': document['byte_size'], 'page_count': document['page_count']}
    values = [saved_note(note, source) for note in notes]
    if len({note['id'] for note in values}) != len(values):
        raise InvalidSnapshot('Duplicate note identity')
    if sum(len(n['annotation']['rects']) if n['annotation'] else int(n['rect'] is not None) for n in values) > MAX_RECTS:
        raise SnapshotTooLarge('Rectangle count exceeded')
    value = {'format': FORMAT, 'document': source, 'notes': values}
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (ValueError, UnicodeError) as error:
        raise InvalidSnapshot('Invalid encoding') from error
    if len(encoded) > MAX_PAYLOAD_BYTES:
        raise SnapshotTooLarge('Snapshot size exceeded')
    return value, encoded
