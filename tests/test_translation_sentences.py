"""Focused unit checks for deterministic sentence units.

These tests exercise the actual pinned pySBD 0.3.4 boundaries and the fallback
rules; no model, parser, store or HTTP call is involved.
"""
from types import SimpleNamespace

from research_workbench import translation_sentences as sentences
from research_workbench.translation_sentences import (
    MAX_SENTENCES_PER_BLOCK, MAX_SENTENCES_PER_CHUNK, MAX_SENTENCES_PER_PAGE,
    chunk_units, sentence_units, source_language, split_sentences,
)


def assert_contiguous(text, parts):
    assert parts
    assert all(isinstance(part, str) and part for part in parts)
    assert ''.join(parts) == text
    assert [unit['id'] for unit in sentence_units('p1-b0', text)] == [
        f'p1-b0-s{index}' for index in range(len(parts))]


def test_english_abbreviations_decimals_references_and_unicode_cover_exactly():
    text = ('Dr. Lee et al. measured 3.5 mL at e.g. 20 \u00b0C (Fig. 2). '
            'See refs. [1, 2]. \nThe next line stays. Emoji \U0001F600 ends.')
    parts = split_sentences(text)
    assert_contiguous(text, parts)
    assert len(parts) >= 3
    # No abbreviation, decimal or reference is treated as a sentence boundary.
    assert any('Dr. Lee et al.' in part for part in parts)
    assert any('3.5 mL' in part and 'Fig. 2' in part for part in parts)
    assert any('\n' in part for part in parts)
    assert any('\U0001F600' in part for part in parts)


def test_chinese_punctuation_and_mixed_source_cover_exactly():
    chinese = '\u65b9\u6cd5\u5982\u4e0b\u3002\u4f7f\u75283.5 mL\u7f13\u51b2\u6db2'
    chinese += '\uff08\u4f8b\u5982\u56fe2\uff09\u3002\u7ed3\u679c\u826f\u597d\uff01'
    mixed = 'Results were 3.5 mL. \u7ed3\u679c\u663e\u793a\u826f\u597d\u3002\u518d\u8bd5\u4e00\u6b21.'
    for text in (chinese, mixed):
        assert_contiguous(text, split_sentences(text))
    assert split_sentences(chinese) != [chinese]
    assert source_language(chinese) == 'zh'
    assert source_language('Results were 3.5 mL.') == 'en'


def test_leading_and_trailing_whitespace_is_retained_in_the_aligned_source():
    text = '  Leading space. Next line\ncontinues here. Emoji \U0001F600 done.  '
    parts = split_sentences(text)
    assert_contiguous(text, parts)
    assert parts[0].startswith('  Leading space.')
    assert parts[-1].endswith('  ')


def test_unverifiable_splitter_output_keeps_one_complete_unit(monkeypatch):
    text = 'One. Two. Three.'

    class Overlapping:
        def __init__(self, **options):
            pass

        def segment(self, value):
            return [SimpleNamespace(start=0, end=5), SimpleNamespace(start=3, end=8)]

    monkeypatch.setattr(sentences, 'Segmenter', Overlapping)
    assert split_sentences(text) == [text]
    assert sentence_units('p1-b0', text) == [{'id': 'p1-b0-s0', 'source_text': text}]

    class Raising:
        def __init__(self, **options):
            pass

        def segment(self, value):
            raise RuntimeError('synthetic splitter failure')

    monkeypatch.setattr(sentences, 'Segmenter', Raising)
    assert split_sentences(text) == [text]

    class OutOfRange:
        def __init__(self, **options):
            pass

        def segment(self, value):
            return [SimpleNamespace(start=0, end=len(value) + 1)]

    monkeypatch.setattr(sentences, 'Segmenter', OutOfRange)
    assert split_sentences(text) == [text]

    class Empty:
        def __init__(self, **options):
            pass

        def segment(self, value):
            return []

    monkeypatch.setattr(sentences, 'Segmenter', Empty)
    assert split_sentences(text) == [text]


def test_block_bound_is_128_and_chunks_hold_at_most_128_entries():
    at_limit = ' '.join(f'S{index}.' for index in range(MAX_SENTENCES_PER_BLOCK))
    over_limit = ' '.join(f'S{index}.' for index in range(MAX_SENTENCES_PER_BLOCK + 1))
    assert len(split_sentences(at_limit)) == MAX_SENTENCES_PER_BLOCK
    assert len(sentence_units('p1-b0', at_limit)) == MAX_SENTENCES_PER_BLOCK
    assert sentence_units('p1-b0', over_limit) is None
    assert (MAX_SENTENCES_PER_PAGE, MAX_SENTENCES_PER_CHUNK) == (1024, 128)

    entries = [(f'p1-b{index}-s0', 'Sentence.') for index in range(130)]
    chunks = list(chunk_units(entries, 2400, MAX_SENTENCES_PER_CHUNK))
    assert [len(chunk) for chunk in chunks] == [128, 2]
    assert [entry for chunk in chunks for entry in chunk] == entries


def test_chunking_also_respects_the_existing_character_bound():
    entries = [('p1-b0-s0', 'a' * 1400), ('p1-b0-s1', 'b' * 1400),
               ('p1-b0-s2', 'c')]
    chunks = list(chunk_units(entries, 2400))
    assert [[identifier for identifier, _ in chunk] for chunk in chunks] == [
        ['p1-b0-s0'], ['p1-b0-s1', 'p1-b0-s2']]
