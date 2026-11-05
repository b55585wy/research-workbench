"""Focused boundary check for the persisted translation payload bound.

Only deterministic planning data is used: no store, parser or model call.  The
plan mixes translated prose blocks with untranslated non-prose blocks, exactly
like a real parser page, so the legacy reduced preview is smaller than the block
list that would actually be stored.
"""
import pytest

from research_workbench.agent_store import canonical
from research_workbench.models import WorkspaceError
from research_workbench.translation import (
    MAX_RESULT_BYTES, MAX_TRANSLATION_CHARS, Translations,
)

PROSE_BLOCKS = 120
UNTRANSLATED_BLOCKS = 100
# The pinned parser truncates every unit to 2401 characters.
UNTRANSLATED_MAX_CHARS = 2401
HEADROOM = UNTRANSLATED_BLOCKS * UNTRANSLATED_MAX_CHARS


def block(identifier, order, kind, source):
    return {'id': identifier, 'kind': kind, 'order': order,
            'rect': {'x': 0.1, 'y': 0.1, 'width': 0.8, 'height': 0.05},
            'source_text': source, 'translated_text': None}


def build(target_chars, padding=()):
    """A complete page plan plus the sentence targets that answer it."""
    blocks, sentences, targets = [], {}, {}
    for index in range(PROSE_BLOCKS):
        identifier = f'p1-b{index}'
        source = f'Section {index}. '
        blocks.append(block(identifier, index, 'text', source))
        unit = f'{identifier}-s0'
        sentences[identifier] = [{'id': unit, 'source_text': source}]
        targets[unit] = '\u8bd1' * target_chars
    for offset, length in enumerate(padding):
        index = PROSE_BLOCKS + offset
        blocks.append(block(f'p1-b{index}', index, 'other', 'H' * length))
    plan = {'page': 1, 'blocks': blocks, 'status': 'completed', 'warning': None,
            'sentences': sentences, 'chunks': [], 'chars': 0}
    return plan, targets


def aligned_results(plan, targets):
    """The aggregate and sentence targets ``aligned`` returns for the plan."""
    aggregates, sentences = {}, {}
    for identifier, units in plan['sentences'].items():
        aggregates[identifier] = ' '.join(targets[unit['id']] for unit in units)
        sentences[identifier] = [
            {'id': unit['id'], 'source_text': unit['source_text'],
             'translated_text': targets[unit['id']]} for unit in units]
    return aggregates, sentences


def stored_blocks(plan, targets):
    """Mirror the persisted field set of ``publish`` as an independent oracle."""
    aggregates, sentences = aligned_results(plan, targets)
    result = []
    for original in plan['blocks']:
        item = dict(original)
        item['translated_text'] = aggregates.get(item['id'])
        units = sentences.get(item['id'])
        if units:
            item['sentences'] = units
        result.append(item)
    return result


def stored_size(plan, targets):
    return len(canonical(stored_blocks(plan, targets)).encode())


def reduced_preview_size(plan, targets):
    """The size proxy used before the fix; it must stay below the real payload."""
    blocks = {item['id']: item for item in plan['blocks']}
    aggregates, sentences = aligned_results(plan, targets)
    preview = [{'source_text': blocks[identifier]['source_text'],
                'translated_text': aggregates[identifier],
                'sentences': sentences[identifier]} for identifier in sentences]
    return len(canonical(preview).encode())


def boundary_plan():
    """Targets keep the real payload just under the bound, leaving exact headroom."""
    low, high = 1000, MAX_TRANSLATION_CHARS
    while low <= high:
        mid = (low + high) // 2
        plan, targets = build(mid, [0] * UNTRANSLATED_BLOCKS)
        gap = MAX_RESULT_BYTES - stored_size(plan, targets)
        if gap < 0:
            high = mid - 1
        elif gap >= HEADROOM:
            low = mid + 1
        else:
            return plan, targets, gap
    raise AssertionError('no target size produced a reachable boundary plan')


def pad(length):
    """Spread exactly ``length`` ASCII characters over the untranslated blocks."""
    assert 0 <= length <= HEADROOM
    lengths, remaining = [], length
    for _ in range(UNTRANSLATED_BLOCKS):
        value = min(UNTRANSLATED_MAX_CHARS, remaining)
        lengths.append(value)
        remaining -= value
    assert remaining == 0
    return lengths


def test_exact_stored_payload_is_bounded_not_the_reduced_preview():
    plan, targets, gap = boundary_plan()
    # Real payload sits within one padding block-range of the bound, so the
    # untranslated blocks alone decide whether the page fits.
    assert 0 <= gap < HEADROOM
    assert reduced_preview_size(plan, targets) < MAX_RESULT_BYTES
    assert stored_size(plan, targets) < MAX_RESULT_BYTES

    fitting, fitting_targets = build(len(targets['p1-b0-s0']), pad(gap))
    assert stored_size(fitting, fitting_targets) == MAX_RESULT_BYTES
    assert reduced_preview_size(fitting, fitting_targets) < MAX_RESULT_BYTES
    aggregates, sentences = Translations.aligned(fitting, fitting_targets)
    assert aggregates['p1-b0'] == '\u8bd1' * len(fitting_targets['p1-b0-s0'])
    assert [unit['translated_text'] for unit in sentences['p1-b0']] == [
        fitting_targets['p1-b0-s0']]

    over, over_targets = build(len(targets['p1-b0-s0']), pad(gap + 1))
    assert stored_size(over, over_targets) == MAX_RESULT_BYTES + 1
    assert reduced_preview_size(over, over_targets) < MAX_RESULT_BYTES
    with pytest.raises(WorkspaceError) as failure:
        Translations.aligned(over, over_targets)
    # The existing invalid-output path turns this into a failed page.
    assert failure.value.code == 'translation_output_invalid'
    assert failure.value.status == 502
