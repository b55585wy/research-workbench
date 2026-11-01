from copy import deepcopy
from uuid import uuid4

import pytest

import research_workbench.pdf_annotation_contract as contract
from research_workbench.text_annotations import COLORS


@pytest.fixture
def source():
    return dict(id=str(uuid4()), sha256='a'*64, byte_size=100, page_count=200)


def note(source, **changes):
    value = dict(id=str(uuid4()), document_id=source['id'], page=1, revision=1, text='A saved note', rect=None)
    value.update(changes)
    return value


def marked(source, **changes):
    value = dict(kind='highlight', color='yellow', quote='Original quote', rects=[[0, 0, 1, 1]], source_sha256=source['sha256'])
    value.update(changes)
    return note(source, rect=[0, 0, 1, 1], annotation=value)


@pytest.mark.parametrize('page', [1, 200])
@pytest.mark.parametrize('rect', [None, [0, 0, 1, 1], [.1, .2, .3, .4]])
def test_first_last_full_page_and_plain_note_boundaries(source, page, rect):
    data, encoded = contract.snapshot(source, [note(source, page=page, rect=rect)])
    assert data['notes'][0]['page'] == page and data['notes'][0]['rect'] == rect
    assert data['format'] == contract.FORMAT and b'credentials' not in encoded


@pytest.mark.parametrize('changes', [{'page': 0}, {'page': 201}, {'page': 1.5}, {'page': True}, {'revision': 0},
    {'revision': True}, {'text': ''}, {'text': '  '}, {'text': 'x\x00y'}, {'text': 'x'*10001},
    {'document_id': str(uuid4())}, {'id': '../path'}, {'id': None}])
def test_invalid_note_never_becomes_a_partial_snapshot(source, changes):
    with pytest.raises(contract.InvalidSnapshot):
        contract.snapshot(source, [note(source, **changes)])


@pytest.mark.parametrize('rect', [[], [0, 0, 1], [0, 0, 0, 1], [.5, 0, .4, 1], [-.01, 0, 1, 1],
    [0, 0, 1.01, 1], [False, 0, 1, 1], [0, 0, float('nan'), 1], [0, 0, float('inf'), 1], ['0', 0, 1, 1]])
def test_nonfinite_reversed_empty_or_wrong_type_geometry_is_rejected(source, rect):
    with pytest.raises(contract.InvalidSnapshot):
        contract.snapshot(source, [note(source, rect=rect)])


@pytest.mark.parametrize('changes', [{'kind': 'ink'}, {'color': 'red'}, {'color': []}, {'quote': ''},
    {'source_sha256': 'b'*64}, {'rects': []}, {'rects': [[.1, .1, .9, .9]]}, {'rects': [[0, 0, 1, 1]]*257}])
def test_markup_kind_palette_quote_source_union_and_line_count_are_validated(source, changes):
    with pytest.raises(contract.InvalidSnapshot):
        contract.snapshot(source, [marked(source, **changes)])


def test_palette_is_the_existing_saved_annotation_palette(source):
    assert contract.COLORS == {k: v[1:] for k, v in COLORS.items()}
    for color in COLORS:
        data, _ = contract.snapshot(source, [marked(source, color=color)])
        assert data['notes'][0]['annotation']['color'] == color


def test_max_notes_and_rectangles_are_explicit(source):
    notes = [note(source) for _ in range(1000)]
    assert len(contract.snapshot(source, notes)[0]['notes']) == 1000
    with pytest.raises(contract.SnapshotTooLarge):
        contract.snapshot(source, notes + [note(source)])
    rects = [[0, 0, 1, 1]]*256
    notes = [marked(source, rects=rects) for _ in range(64)]
    assert len(contract.snapshot(source, notes)[0]['notes']) == 64
    with pytest.raises(contract.SnapshotTooLarge):
        contract.snapshot(source, notes + [marked(source, rects=rects)])


def test_payload_exact_limit_and_over_limit(source, monkeypatch):
    values = [note(source)]
    _, encoded = contract.snapshot(source, values)
    monkeypatch.setattr(contract, 'MAX_PAYLOAD_BYTES', len(encoded))
    assert contract.snapshot(source, values)[1] == encoded
    monkeypatch.setattr(contract, 'MAX_PAYLOAD_BYTES', len(encoded)-1)
    with pytest.raises(contract.SnapshotTooLarge):
        contract.snapshot(source, values)


def test_snapshot_freezes_saved_fields_and_does_not_copy_attachments_or_secrets(source):
    value = marked(source)
    value.update(attachments=[{'secret': 'not a PDF note'}], rich_content={'ops': []}, credential='never copy')
    data, encoded = contract.snapshot(source, [value])
    value['text'] = 'Later edit'
    value['annotation']['quote'] = 'Later mutation'
    assert data['notes'][0]['text'] == 'A saved note'
    assert data['notes'][0]['annotation']['quote'] == 'Original quote'
    assert b'attachments' not in encoded and b'credential' not in encoded and b'rich_content' not in encoded


@pytest.mark.parametrize('changes', [{'id': 'bad'}, {'sha256': 'bad'}, {'page_count': 0}, {'page_count': 201}, {'page_count': True}])
def test_corrupt_source_identity_is_rejected(source, changes):
    with pytest.raises(contract.InvalidSnapshot):
        contract.snapshot({**source, **changes}, [])


def test_source_size_and_duplicate_note_ids_fail(source):
    value = note(source)
    with pytest.raises(contract.InvalidSnapshot):
        contract.snapshot(source, [value, deepcopy(value)])
    assert contract.snapshot({**source, 'byte_size': contract.MAX_INPUT_BYTES}, [value])[0]
    with pytest.raises(contract.SnapshotTooLarge):
        contract.snapshot({**source, 'byte_size': contract.MAX_INPUT_BYTES+1}, [value])
