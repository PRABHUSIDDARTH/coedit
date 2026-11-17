"""Programmatic error injection for suggest_edits gold labels. No model is used here.

Start from CLEAN text, corrupt a few spans, and record the exact inverse edits as the gold
`changes`. Because the corruption is ours, the gold edit is exact by construction. Kinds:

  typo       a dictionary word becomes a non-word (swap, drop, double or neighbouring-key letter)
  agreement  subject-verb agreement, only where the subject is unambiguous (see below)
  doubled    a word is written twice ("the the")
  tense      past-time sentence ("last year ...") gets a present or future form
  style      OPTIONAL: a concise phrase becomes a wordy one ("because" -> "due to the fact that")

Gold-label properties, enforced here and re-checked in build_data.py and the tests:
  - `original` occurs EXACTLY ONCE in the document (plain substring; scoring._find_span takes the
    first match), widened by neighbouring words when needed;
  - applying every gold change to the document reproduces the clean text exactly.
Standard library only.
"""

from __future__ import annotations

import itertools
import random
import re
from dataclasses import dataclass

ERROR_KINDS = ("typo", "agreement", "doubled", "tense")
MIN_GAP = 25  # characters between two injected spans, so their context windows stay apart

# --------------------------------------------------------------------------- data


@dataclass(frozen=True)
class Site:
    start: int  # span in the CLEAN text
    end: int
    corrupted: str  # what replaces clean[start:end] in the document
    kind: str
    reason: str
    optional: bool = False


@dataclass(frozen=True)
class EditBuild:
    document: str
    changes: list[dict[str, str]]
    optional: list[int]  # indices into `changes` that are optional (stylistic)
    kinds: list[str]


# --------------------------------------------------------------------------- helpers

_KEY_NEIGHBOURS = {
    "a": "sqw",
    "e": "wrd",
    "i": "uok",
    "o": "ipl",
    "u": "yij",
    "n": "bm",
    "r": "et",
    "t": "ry",
    "s": "ad",
    "l": "kp",
    "c": "xv",
    "d": "sf",
    "m": "nk",
    "p": "ol",
    "h": "gj",
}
_SKIP_DOUBLE = {
    "had", "that", "is", "was", "do", "very", "so", "no", "yes", "well", "far", "long",
    "many", "more", "bye", "go", "gone", "knock", "tut", "ha", "bad", "can", "will", "be",
}  # fmt: skip


def _typo_of(word: str, vocab: frozenset[str], rng: random.Random) -> str | None:
    for _ in range(8):
        i = rng.randint(1, len(word) - 3)
        op = rng.choice(("swap", "drop", "double", "key"))
        if op == "swap":
            t = word[:i] + word[i + 1] + word[i] + word[i + 2 :]
        elif op == "drop":
            t = word[:i] + word[i + 1 :]
        elif op == "double":
            t = word[: i + 1] + word[i] + word[i + 1 :]
        else:
            near = _KEY_NEIGHBOURS.get(word[i])
            if not near:
                continue
            t = word[:i] + rng.choice(near) + word[i + 1 :]
        if t != word and t not in vocab and len(t) >= 4:
            return t
    return None


def find_typos(clean: str, rng: random.Random, vocab: frozenset[str]) -> list[Site]:
    out = []
    for m in re.finditer(r"(?<![\w'-])[a-z]{5,12}(?![\w'-])", clean):
        w = m.group(0)
        if w not in vocab:
            continue
        t = _typo_of(w, vocab, rng)
        if t:
            out.append(Site(m.start(), m.end(), t, "typo", f"Misspelled word; should be '{w}'."))
    return out


def find_doubled(clean: str, rng: random.Random, vocab: frozenset[str]) -> list[Site]:
    out = []
    for m in re.finditer(r"(?<![\w'-])[A-Za-z]{2,12}(?![\w'-])", clean):
        w = m.group(0)
        sentence_start = not clean[: m.start()].strip() or clean[: m.start()].rstrip().endswith(
            (".", "!", "?")
        )
        if w.lower() in _SKIP_DOUBLE or (w[0].isupper() and not sentence_start):
            continue
        out.append(Site(m.start(), m.end(), f"{w} {w.lower()}", "doubled", "The word is repeated."))
    return out


_AGREE_PRON = [
    (re.compile(r"\b(?:They|We|they|we) (are|were|have|do)\b"), {"are": "is", "were": "was", "have": "has", "do": "does"}),
    (re.compile(r"\b(?:He|She|It|he|she|it) (is|has|does)\b"), {"is": "are", "has": "have", "does": "do"}),
    (re.compile(r"\bI (am)\b"), {"am": "is"}),
]  # fmt: skip
_PLURAL_DET = re.compile(
    r"\b(?i:these|those|several|both|many) (?:[a-z]+ )?([a-z]{3,}s) (are|were|have|do)\b"
)
_SINGULAR_DET = re.compile(r"\b(?i:this|each|every) (?:[a-z]+ )?([a-z]{3,}) (is|was|has|does)\b")
_NOT_SINGULAR_NOUN = {
    "data", "media", "people", "staff", "team", "group", "family", "committee", "council",
    "board", "class", "crowd", "audience", "other", "one", "number", "lot", "bit", "couple",
    "police", "criteria", "children", "men", "women", "series", "news", "species",
}  # fmt: skip
_TO_PLURAL = {"is": "are", "was": "were", "has": "have", "does": "do"}
_TO_SINGULAR = {"are": "is", "were": "was", "have": "has", "do": "does"}


def find_agreement(clean: str, rng: random.Random, vocab: frozenset[str]) -> list[Site]:
    """Only unambiguous subjects: pronouns (They/We/He/She/It/I) and noun phrases introduced by
    these/those/several/both/many (plural) or this/each/every (singular). Collective and
    irregular nouns are excluded; 'She were' is never produced because of the subjunctive."""
    out = []
    for pat, table in _AGREE_PRON:
        for m in pat.finditer(clean):
            verb = m.group(1)
            out.append(
                Site(
                    m.start(1), m.end(1), table[verb], "agreement", "Subject-verb agreement error."
                )
            )
    for m in _PLURAL_DET.finditer(clean):
        noun = m.group(1)
        if noun not in vocab or noun.endswith(("ss", "us", "is")) or noun in _NOT_SINGULAR_NOUN:
            continue
        out.append(
            Site(
                m.start(2),
                m.end(2),
                _TO_SINGULAR[m.group(2)],
                "agreement",
                "Subject-verb agreement error.",
            )
        )
    for m in _SINGULAR_DET.finditer(clean):
        noun = m.group(1)
        if noun not in vocab or noun.endswith("s") or noun in _NOT_SINGULAR_NOUN:
            continue
        out.append(
            Site(
                m.start(2),
                m.end(2),
                _TO_PLURAL[m.group(2)],
                "agreement",
                "Subject-verb agreement error.",
            )
        )
    return out


_ANCHOR = re.compile(
    r"\b(?:yesterday|last (?:week|weekend|month|year|summer|winter|spring|autumn|night)"
    r"|\d+ (?:days?|weeks?|months?|years?) ago|in (?:19\d\d|20(?:[01]\d|2[0-4])))\b",
    re.IGNORECASE,
)
_NOT_PAST_CONTEXT = re.compile(
    r"\b(?:will|would|going|plan|plans|planned|expect|expected|upcoming|next|currently|now|today"
    r"|is|are|am|be|being|can|may|might|must|should)\b",
    re.IGNORECASE,
)
_PAST_BASE = {
    "opened": "open", "started": "start", "began": "begin", "made": "make", "took": "take",
    "went": "go", "ran": "run", "built": "build", "grew": "grow", "held": "hold",
    "launched": "launch", "announced": "announce", "closed": "close", "joined": "join",
    "received": "receive", "collected": "collect", "visited": "visit", "moved": "move",
    "raised": "raise", "decided": "decide", "offered": "offer", "introduced": "introduce",
    "increased": "increase", "fell": "fall", "rose": "rise", "gave": "give", "brought": "bring",
}  # fmt: skip
_BLOCKED_BEFORE = {
    "had", "has", "have", "was", "were", "been", "be", "is", "are", "will", "would", "did", "do",
    "does", "to", "not", "could", "should", "can", "may", "might", "the", "a", "an", "this",
    "that", "these", "those", "its", "their", "his", "her", "our", "my", "your", "some",
}  # fmt: skip


def find_tense(clean: str, rng: random.Random, vocab: frozenset[str]) -> list[Site]:
    """Past-time sentences only (explicit anchor, no future/present markers). was/were become
    is/are; a plain past verb becomes 'will <base>', which is wrong for ANY subject, so no second
    (agreement) error is introduced."""
    out = []
    for sm in re.finditer(r"[^.!?]+[.!?]?", clean):
        sent = sm.group(0)
        if not _ANCHOR.search(sent) or _NOT_PAST_CONTEXT.search(sent):
            continue
        for wm in re.finditer(r"\b[a-z]+\b", sent):
            w = wm.group(0)
            prev = (
                sent[: wm.start()].split()[-1].lower().strip(",;:\"'")
                if sent[: wm.start()].split()
                else ""
            )
            if prev in _BLOCKED_BEFORE:
                continue
            if w in ("was", "were"):
                rep = "is" if w == "was" else "are"
            elif w in _PAST_BASE:
                rep = f"will {_PAST_BASE[w]}"
            else:
                continue
            a = sm.start() + wm.start()
            out.append(
                Site(a, a + len(w), rep, "tense", "Tense does not match the past time reference.")
            )
            break  # one site per sentence
    return out


_STYLE = (
    (re.compile(r"\bbecause\b(?! of)", re.IGNORECASE), "due to the fact that"),
    (re.compile(r"(?<=\bto )use\b(?! of)"), "utilize"),
    (re.compile(r"(?<=\bto )start\b"), "commence"),
    (re.compile(r"\bbefore\b(?= (?:the|a|an) )", re.IGNORECASE), "prior to"),
    (re.compile(r"\bafter\b(?= (?:the|a|an) )", re.IGNORECASE), "subsequent to"),
    (re.compile(r"\bnow\b(?! that)", re.IGNORECASE), "at this point in time"),
    (re.compile(r"\bmany\b(?= [a-z]+s\b)", re.IGNORECASE), "a large number of"),
    (re.compile(r"\bevery day\b", re.IGNORECASE), "on a daily basis"),
    (re.compile(r"\b(?:every|each) week\b", re.IGNORECASE), "on a weekly basis"),
    (re.compile(r"\b(?:every|each) month\b", re.IGNORECASE), "on a monthly basis"),
)  # fmt: skip


def find_style(clean: str, rng: random.Random, vocab: frozenset[str]) -> list[Site]:
    out = []
    for pat, wordy in _STYLE:
        for m in pat.finditer(clean):
            rep = wordy[0].upper() + wordy[1:] if m.group(0)[0].isupper() else wordy
            out.append(
                Site(
                    m.start(),
                    m.end(),
                    rep,
                    "style",
                    "Optional style edit: wordy phrase; shorter wording is clearer.",
                    True,
                )
            )
    return out


FINDERS = {
    "typo": find_typos,
    "agreement": find_agreement,
    "doubled": find_doubled,
    "tense": find_tense,
    "style": find_style,
}


# --------------------------------------------------------------------------- planning


def _far(a: Site, b: Site) -> bool:
    return a.end + MIN_GAP <= b.start or b.end + MIN_GAP <= a.start


def plan_sites(
    clean: str, kinds: list[str], rng: random.Random, vocab: frozenset[str]
) -> list[Site] | None:
    """Pick one site per requested kind (error kinds fall back to another error kind when the
    text has no site of that kind; `style` never falls back). None if a site cannot be found."""
    chosen: list[Site] = []
    for kind in kinds:
        order = [kind] if kind == "style" else [kind, *(k for k in ERROR_KINDS if k != kind)]
        for k in order:
            cands = [s for s in FINDERS[k](clean, rng, vocab) if all(_far(s, c) for c in chosen)]
            if cands:
                chosen.append(rng.choice(cands))
                break
        else:
            return None
    return sorted(chosen, key=lambda s: s.start)


# --------------------------------------------------------------------------- building


def apply_sites(clean: str, sites: list[Site]) -> tuple[str, list[tuple[int, int]]]:
    """Corrupted document and each site's span inside it. Sites must be sorted and disjoint."""
    out, pos, spans = [], 0, []
    for s in sites:
        if s.start < pos:
            raise ValueError("overlapping sites")
        out.append(clean[pos : s.start])
        spans.append((sum(map(len, out)), sum(map(len, out)) + len(s.corrupted)))
        out.append(s.corrupted)
        pos = s.end
    out.append(clean[pos:])
    return "".join(out), spans


def _grow_left(doc: str, pos: int, n: int) -> int | None:
    for _ in range(n):
        m = re.search(r"\S+\s*$", doc[:pos])
        if not m:
            return None
        pos = m.start()
    return pos


def _grow_right(doc: str, pos: int, n: int) -> int | None:
    for _ in range(n):
        m = re.match(r"\s*\S+", doc[pos:])
        if not m:
            return None
        pos += m.end()
    return pos


_WIDEN = ((0, 0), (0, 1), (1, 0), (1, 1), (1, 2), (2, 1), (2, 2), (3, 3))


def _sentence_no(clean: str, pos: int) -> int:
    return 1 + len(re.findall(r"[.!?][\"')]*\s+(?=[A-Z\"'])", clean[:pos]))


def build_edit(clean: str, sites: list[Site]) -> EditBuild | None:
    """Corrupt `clean` and derive the gold changes. None if any original cannot be made unique."""
    if any(s.corrupted == clean[s.start : s.end] for s in sites):
        return None
    doc, spans = apply_sites(clean, sites)
    ranges: list[tuple[int, int]] = []
    changes: list[dict[str, str]] = []
    for i, (s, (ds, de)) in enumerate(zip(sites, spans, strict=True)):
        others = [sp for j, sp in enumerate(spans) if j != i]
        found = None
        for left, right in _WIDEN:
            es = _grow_left(doc, ds, left)
            ee = _grow_right(doc, de, right)
            if es is None or ee is None:
                continue
            if any(es < b and a < ee for a, b in others):
                continue
            original = doc[es:ee]
            if doc.count(original) == 1 and doc.find(original) == es:
                replacement = clean[s.start - (ds - es) : s.end + (ee - de)]
                found = (es, ee, original, replacement)
                break
        if found is None:
            return None
        es, ee, original, replacement = found
        ranges.append((es, ee))
        changes.append(
            {
                "location": f"sentence {_sentence_no(clean, s.start)}",
                "original": original,
                "replacement": replacement,
                "reason": s.reason,
            }
        )
    if any(a[1] > b[0] for a, b in itertools.pairwise(ranges)):
        return None  # widened windows overlap
    return EditBuild(
        doc, changes, [i for i, s in enumerate(sites) if s.optional], [s.kind for s in sites]
    )
