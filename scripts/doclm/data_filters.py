"""Programmatic filters for docLM data build, phase 1. No model is used anywhere in this file.

- vocabulary: the system word list (/usr/share/dict/words); it only catches SPELLING.
- clean_text_problems: is a model-written passage clean enough to be gold text?
- extract_facts: dates, numbers and names pulled out of a passage with regexes.
- candidate_problems: why a candidate summary is rejected (reasons in a fixed order).

Counting and matching reuse scoring.py (`_words`, `_complete`, `PREAMBLE`, `contains_phrase`), so a
kept example is judged by the same functions the evaluation uses. Standard library only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from scoring import PREAMBLE, _complete, _words, contains_phrase

DICT_PATH = Path("/usr/share/dict/words")
DICT_EXTRA = (Path("/usr/share/dict/british-english"),)  # system lists; British spellings occur
MAX_FACTS = 8  # a passage with more key facts than this cannot be summarized within the limits

_MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
_WEEKDAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
_MONTH_SET = {m.lower() for m in _MONTHS.split("|")}
DATE_RE = re.compile(
    rf"\b(?:(?:{_MONTHS}) \d{{1,2}}(?:st|nd|rd|th)?(?:, \d{{4}})?"
    rf"|\d{{1,2}} (?:{_MONTHS}),? \d{{4}}|(?:{_MONTHS}),? \d{{4}})\b"
)
NUM_RE = re.compile(r"(?<![\w.])\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|percent|per cent))?")
CAP_SEQ_RE = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b")
CAP_WORD_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")
TOKEN_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")


@lru_cache(maxsize=1)
def load_vocab(path: str = str(DICT_PATH)) -> frozenset[str]:
    """Lower-case word set from the system dictionary (spelling check only)."""
    words = Path(path).read_text(encoding="utf-8", errors="ignore").split()
    for extra in DICT_EXTRA:
        if extra.exists():
            words += extra.read_text(encoding="utf-8", errors="ignore").split()
    return frozenset(w.lower() for w in words)


@lru_cache(maxsize=1)
def common_words(path: str = str(DICT_PATH)) -> frozenset[str]:
    """Words listed in LOWER case in the dictionary: ordinary words, not proper nouns."""
    words = Path(path).read_text(encoding="utf-8", errors="ignore").split()
    return frozenset(w for w in words if w == w.lower())


def normalize_quotes(text: str) -> str:
    return text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').strip()


def _known(word: str, vocab: frozenset[str], names: frozenset[str] = frozenset()) -> bool:
    w = word.lower()
    if "'" in w:
        base, _, suffix = w.partition("'")
        ok = suffix in {"s", "t", "re", "ve", "ll", "d", "m"}
        return w in vocab or (ok and (base in vocab or base in names))
    return w in vocab or w in names or (w.endswith("s") and w[:-1] in vocab)


def clean_text_problems(
    text: str, vocab: frozenset[str], names: frozenset[str] = frozenset()
) -> list[str]:
    """Reasons `text` is not safe to use as gold-clean text. Empty list = clean as far as code can
    tell. This catches spelling and formatting only: grammar is NOT verified."""
    out: list[str] = []
    if not text.strip():
        return ["empty"]
    if any(ord(c) > 126 for c in text):
        out.append("non_ascii")
    if PREAMBLE.match(text):
        out.append("preamble")
    if re.search(r"[#*`_|<>\[\]]|^\s*(?:[-+]|\d+[.)])\s", text, re.MULTILINE):
        out.append("markdown_or_list")
    if "\n" in text.strip():
        out.append("multi_paragraph")
    if "  " in text or re.search(r"\s[,.;:!?]|[,;:]{2,}|\.\.(?!\.)", text):
        out.append("spacing_or_punctuation")
    if re.search(r"\b(\w+)\s+\1\b", text, re.IGNORECASE):
        out.append("doubled_word")
    if text.count('"') % 2:
        out.append("unbalanced_quotes")
    if not _complete(text):
        out.append("incomplete")
    if not text[:1].isupper():
        out.append("no_capital_start")
    # spelling: lower-case words (and sentence-initial words) must be in the dictionary
    for m in TOKEN_RE.finditer(text):
        w = m.group(0)
        start_of_sentence = m.start() == 0 or text[: m.start()].rstrip().endswith((".", "!", "?"))
        if (w[0].islower() or start_of_sentence) and not _known(w, vocab, names):
            out.append("unknown_word")
            break
    return out


@dataclass(frozen=True)
class Facts:
    dates: tuple[str, ...]
    numbers: tuple[str, ...]
    names: tuple[str, ...]

    def all(self) -> list[str]:
        return [*self.dates, *self.numbers, *self.names]


def _sentence_initial(text: str, pos: int) -> bool:
    before = text[:pos].rstrip().rstrip("\"'")
    return not before or before.endswith((".", "!", "?"))


def extract_facts(text: str, common: frozenset[str]) -> Facts:
    """Key dates, numbers and names, by regex. Rules (documented in DATA_BUILD.md):
    dates: "March 14, 2022", "14 March 2022", "March 2022". numbers: digit strings outside dates,
    with an attached % or "percent". names: runs of 2+ capitalised words (a sentence-initial
    ordinary word is dropped from the run) and single capitalised words that are not
    sentence-initial, not months/weekdays and not ordinary dictionary words."""
    dates = [m.group(0) for m in DATE_RE.finditer(text)]
    rest = DATE_RE.sub(" ", text)
    numbers = [m.group(0).strip().rstrip(",") for m in NUM_RE.finditer(rest)]
    names: list[str] = []
    used: list[tuple[int, int]] = []
    for m in CAP_SEQ_RE.finditer(text):
        words = m.group(0).split()
        if _sentence_initial(text, m.start()):
            while words and words[0].lower() in common:
                words.pop(0)
        words = [w for w in words if w.lower() not in _MONTH_SET | _WEEKDAYS]
        if len(words) >= 2:
            names.append(" ".join(words))
        elif len(words) == 1 and words[0].lower() not in common:
            names.append(words[0])
        used.append((m.start(), m.end()))
    for m in CAP_WORD_RE.finditer(text):
        if any(a <= m.start() < b for a, b in used) or _sentence_initial(text, m.start()):
            continue
        w = m.group(0)
        if w.lower() in common or w.lower() in _MONTH_SET | _WEEKDAYS:
            continue
        names.append(w)

    def uniq(xs: list[str]) -> tuple[str, ...]:
        return tuple(dict.fromkeys(xs))

    return Facts(uniq(dates), uniq(numbers), uniq(names))


def passage_problems(
    passage: str,
    phrases: list[str],
    vocab: frozenset[str],
    common: frozenset[str],
    names: frozenset[str] = frozenset(),
) -> list[str]:
    """Passage-level filters: clean text, requested facts present, not too many key facts."""
    out = clean_text_problems(passage, vocab, names)
    if not 70 <= _words(passage) <= 230:
        out.append("length_out_of_range")
    if any(p not in passage for p in phrases):
        out.append("requested_fact_missing")
    if len(extract_facts(passage, common).all()) > MAX_FACTS:
        out.append("too_many_facts")
    return out


@dataclass
class CandidateVerdict:
    problems: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def candidate_problems(
    text: str,
    source: str,
    max_words: int,
    facts: Facts,
    *,
    completion_tokens: int | None = None,
    max_tokens: int | None = None,
) -> CandidateVerdict:
    """Why a candidate summary is rejected. Reasons are reported in this fixed order; the FIRST
    one is the primary reason in the reject table. Strict limit: no 25% grace for gold data."""
    v = CandidateVerdict()
    t = text.strip()
    if not t:
        v.problems.append("empty")
        return v
    if completion_tokens is not None and max_tokens is not None and completion_tokens >= max_tokens:
        v.problems.append("truncated")
    if PREAMBLE.match(t):
        v.problems.append("preamble")
    if "\n" in t or re.search(r"^\s*(?:[-*#>]|\d+[.)])\s|```", t):
        v.problems.append("markdown_or_multiline")
    if not _complete(t):
        v.problems.append("incomplete")
    if _words(t) > max_words:
        v.problems.append("over_word_limit")
    if _words(t) >= _words(source):
        v.problems.append("not_shorter_than_source")
    v.missing = [f for f in facts.all() if not contains_phrase(t, f)]
    if v.missing:
        v.problems.append("missing_key_facts")
    return v
