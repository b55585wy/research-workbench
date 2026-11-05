"""Deterministic sentence units for aligned paragraph translation.

The frozen v2 plan asks the model for one target per sentence id, so a saved
result can prove which source sentence each target belongs to.  pySBD is used
only to choose candidate boundaries; the source strings that leave this module
are always slices of the original paragraph that concatenate back to it exactly.
A splitter result that cannot be proven contiguous becomes one complete unit,
never a silently shortened paragraph.
"""
from __future__ import annotations

import re

from pysbd import Segmenter

PROMPT_VERSION = 'translate-sentences-v2'
LEGACY_PROMPT_VERSION = 'translate-blocks-v1'
PROMPT_VERSIONS = (LEGACY_PROMPT_VERSION, PROMPT_VERSION)

MAX_SENTENCES_PER_BLOCK = 128
MAX_SENTENCES_PER_PAGE = 1024
MAX_SENTENCES_PER_CHUNK = 128

# Deterministic source-language choice: text containing any CJK or fullwidth
# character is segmented with the Chinese boundary rules, everything else with
# the English rules.  Every split is still verified to cover the paragraph
# exactly and falls back to one complete unit only when the splitter output
# cannot be proven contiguous, so mixed text (including English abbreviations
# and decimals alongside CJK) is segmented, never silently collapsed.  The
# target language never decides the source language.
_CJK = re.compile(
    r'[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff01-\uff60'
    r'\U00020000-\U0002fa1f]')


def source_language(text):
    return 'zh' if _CJK.search(text) else 'en'


def split_sentences(text):
    """Return contiguous source slices that concatenate exactly to ``text``."""
    if not isinstance(text, str) or not text:
        return []
    try:
        segments = Segmenter(language=source_language(text), clean=False,
                             char_span=True).segment(text)
    except Exception:
        return [text]
    spans = []
    for segment in segments:
        start, end = getattr(segment, 'start', None), getattr(segment, 'end', None)
        if type(start) is not int or type(end) is not int:
            return [text]
        if start < 0 or end <= start or end > len(text):
            return [text]
        spans.append((start, end))
    if not spans:
        return [text]
    spans.sort(key=lambda span: span[0])
    units, cursor = [], 0
    for start, end in spans:
        if start < cursor:
            return [text]
        units.append(text[cursor:end])
        cursor = end
    if cursor < len(text):
        # Trailing whitespace belongs to the last sentence so no character of
        # the paragraph is dropped from the aligned source.
        units[-1] += text[cursor:]
    if not units or any(not unit for unit in units) or ''.join(units) != text:
        return [text]
    return units


def sentence_units(identifier, text):
    """Deterministic ``<block>-s<index>`` units, or None over the block bound."""
    parts = split_sentences(text)
    if not parts or len(parts) > MAX_SENTENCES_PER_BLOCK:
        return None
    return [{'id': f'{identifier}-s{index}', 'source_text': part}
            for index, part in enumerate(parts)]


def chunk_units(entries, size, max_entries=MAX_SENTENCES_PER_CHUNK):
    """Pack sentence units into bounded model requests, preserving order."""
    chunk, total = [], 0
    for identifier, text in entries:
        if chunk and (total + len(text) > size or len(chunk) >= max_entries):
            yield chunk
            chunk, total = [], 0
        chunk.append((identifier, text))
        total += len(text)
    if chunk:
        yield chunk
