"""Prompts, reply parsing and offline scoring for docLM tasks. Standard library only.

HONEST SCOPE: these are structural and reference-based checks (valid JSON, required sections,
verbatim-grounded edits, length limits, required/forbidden phrases, score error against a human
reference). They do NOT measure writing quality. Spot-check 10 outputs by hand before believing
any table.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from schema import (
    INPUT_TYPES,
    OUTPUT_TYPES,
    STRICT_JSON_TASKS,
    Change,
    CritiqueOutput,
    EditsOutput,
    Example,
    SchemaError,
    TextOutput,
)

AGENTS_SECTIONS = ("stack", "commands", "conventions", "definition of done")
ARCH_SECTIONS = ("overview", "components", "data flow", "decisions", "risks")
PREAMBLE = re.compile(r"^\s*(sure|certainly|of course|here is|here's|okay|ok,)", re.IGNORECASE)

SYSTEM_PROMPTS = {
    "critique": (
        "TASK: critique\nScore the document against each rubric item. Reply with ONE JSON object "
        'and nothing else (no code fences): {"scores": {"<rubric id>": <integer 0..max>}, '
        '"rationale": "<at most 80 words>"}. Use every rubric id exactly once.'
    ),
    "rewrite": (
        "TASK: rewrite\nRewrite the passage so it satisfies the rubric. Keep the facts. "
        "Reply with the rewritten passage only, no preamble."
    ),
    "agents_md": (
        "TASK: agents_md\nTurn the brief into an AGENTS.md in Markdown with sections: "
        "Stack, Commands, Conventions, Definition of done. Use only facts in the brief; "
        "write 'unknown' instead of inventing. Reply with the file only."
    ),
    "architecture_md": (
        "TASK: architecture_md\nTurn the brief into an ARCHITECTURE.md in Markdown with sections: "
        "Overview, Components, Data flow, Decisions, Risks. Use only facts in the brief. "
        "Reply with the file only."
    ),
    "summarize": (
        "TASK: summarize\nSummarize the document in at most the given number of words. "
        "Reply with the summary only."
    ),
    "suggest_edits": (
        "TASK: suggest_edits\nSuggest edits as ONE JSON object and nothing else (no code fences): "
        '{"changes": [{"location": "...", "original": "<exact text copied from the document>", '
        '"replacement": "...", "reason": "..."}]}. An empty list is allowed. If the document has no errors, the correct answer is an empty list: {"changes": []}.'
    ),
}


def _wrap(tag_text: str) -> str:
    # Mirrors Coedit's convention: document text is data, wrapped and with the tag defused.
    safe = tag_text.replace("</untrusted_source>", "<\\/untrusted_source>")
    return f"<untrusted_source>\n{safe}\n</untrusted_source>"


def build_messages(ex: Example) -> list[dict[str, str]]:
    inp = INPUT_TYPES[ex.task].from_dict(ex.input)
    if ex.task == "critique":
        rub = "\n".join(f"- {r.id} (0..{r.max_score}): {r.description}" for r in inp.rubric)
        user = f"Rubric:\n{rub}\n\nDocument:\n{_wrap(inp.document)}"
    elif ex.task == "rewrite":
        rub = "\n".join(f"- {r.id}: {r.description}" for r in inp.rubric)
        user = f"Rubric:\n{rub}\n\nPassage:\n{_wrap(inp.passage)}"
    elif ex.task in ("agents_md", "architecture_md"):
        user = f"Brief:\n{_wrap(inp.brief)}"
    elif ex.task == "summarize":
        user = f"Max words: {inp.max_words}\n\nDocument:\n{_wrap(inp.document)}"
    else:
        user = f"Document:\n{_wrap(inp.document)}"
    return [
        {"role": "system", "content": SYSTEM_PROMPTS[ex.task]},
        {"role": "user", "content": user},
    ]


# ---------------------------------------------------------------- parsing


def strip_outer_fence(text: str) -> tuple[str, bool]:
    """If the reply is wrapped in ONE outer ``` fence (first line opens it, last line closes it),
    return (inner text, True). Inner code blocks are left alone. Otherwise (text, False)."""
    lines = text.strip().splitlines()
    if len(lines) >= 2 and lines[0].startswith("```") and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]), True
    return text, False


def parse_reply(task: str, text: str) -> Any:
    """Parse a raw model reply into the task's output type. Raises SchemaError.

    JSON tasks are STRICT: the whole reply must be one JSON object. Code fences or prose around
    it count as invalid, because Coedit's council parses replies without a repair step.
    """
    if task in STRICT_JSON_TASKS:
        try:
            data = json.loads(text.strip())
        except json.JSONDecodeError:
            raise SchemaError("reply is not a single valid JSON object") from None
        return OUTPUT_TYPES[task].from_dict(data, "reply")
    return TextOutput.from_dict({"text": text.strip()}, "reply")


# ---------------------------------------------------------------- scoring


# Item classes. `total` = form_mean x product(content) x forbidden-phrase factor, so structure
# alone earns nothing: a reply with the right shape but no right content scores near 0.
# HARD items are explicit constraints; failing any of them zeroes the example.
HARD = frozenset(
    {
        "parse",
        "complete",
        "changed",
        "shorter_than_source",
        "ids_exact",
        "in_range",
        "critical",
        "no_real_change",
    }
)
CONTENT = frozenset(
    {
        "must_include",
        "sections",
        "score_closeness",
        "recall",
        "precision",
        "no_false_positive",
    }
)
PENALTIES = (
    "must_not_include",
    "within_limit",
    "unknown_fields",
)  # multiply the total; passing earns nothing on its own
UNKNOWN_PENALTY = (
    0.5  # total x 0.5 when a declared section invents content (x 1 - 0.5*share if several)
)
LIMIT_GRACE = 0.25  # summaries may exceed max_words by up to 25%, with a linear penalty


@dataclass
class Score:
    id: str
    task: str
    items: dict[str, float] = field(default_factory=dict)  # each in 0..1
    json_valid: bool | None = None  # only for strict-JSON tasks (strict: a fence makes it invalid)
    json_valid_lenient: bool | None = None  # same, but after removing one outer fence (not scored)
    fenced: bool = False  # reply wrapped in one outer ``` fence; recorded, never changes the score
    note: str = ""

    def _total(self, gates: frozenset[str]) -> float:
        if not self.items or any(self.items.get(k, 1.0) == 0.0 for k in gates):
            return 0.0
        form = [
            v
            for k, v in self.items.items()
            if k not in CONTENT and k not in PENALTIES and k not in ("critical", "no_real_change")
        ]
        total = sum(form) / len(form) if form else 1.0
        for k in CONTENT:
            if k in self.items:
                total *= self.items[k]
        for k in PENALTIES:
            total *= self.items.get(k, 1.0)
        return total

    @property
    def total(self) -> float:
        """The gated score: any hard item at 0 (including critical, no_real_change) gives 0."""
        return self._total(HARD)

    @property
    def ungated(self) -> float:
        """Same score, but ignoring the `critical` and `no_real_change` gates (every other hard
        item still zeroes it). Diagnostic only: ungated - total > 0 means a gate fired, so a
        false zero can be told apart from a genuinely wrong answer. Never used for gating."""
        return self._total(HARD - {"critical", "no_real_change"})


def _complete(text: str) -> float:
    """Prose replies must end like a finished sentence; a cut-off reply (token limit) fails."""
    return float(text.rstrip().endswith((".", "!", "?", '"', "'", ")", "`")))


def limit_factor(words: int, limit: int) -> float:
    """1.0 within the limit; falls linearly to 0.0 at limit * (1 + LIMIT_GRACE); 0.0 beyond.
    factor = 1 - (words/limit - 1) / LIMIT_GRACE, clamped to [0, 1]."""
    return max(0.0, min(1.0, 1.0 - (words / limit - 1.0) / LIMIT_GRACE))


def _find_span(doc: str, original: str) -> tuple[int, int] | None:
    """Character offsets (start, end) of the change's `original` in the document (first match)."""
    i = doc.find(original) if original else -1
    return None if i < 0 else (i, i + len(original))


def _apply(doc: str, items: list[tuple[tuple[int, int], str]]) -> str:
    """Apply replacements by offset, left to right, skipping any that overlap an earlier one."""
    out, pos = [], 0
    for (a, b), rep in sorted(items, key=lambda t: t[0]):
        if a < pos:
            continue
        out += [doc[pos:a], rep]
        pos = b
    return "".join(out) + doc[pos:]


def _edge_words(doc: str, span: tuple[int, int]) -> tuple[str, str]:
    left = doc[: span[0]].split()
    right = doc[span[1] :].split()
    return (left[-1] if left else ""), (right[0] if right else "")


def _collapse(t: str) -> str:
    return re.sub(r"\s+", " ", t).strip().lower()


def _span_fixed(
    doc: str, span: tuple[int, int], original: str, accepted: list[str], fixed_doc: str
) -> bool:
    """Is the expected span fixed in `fixed_doc`? An accepted replacement, with one word of the
    original context on each side, must appear in the edited document. Matching is normalised
    (case, punctuation, dates, plurals) except for punctuation-only fixes, where punctuation
    is the whole point and the comparison is raw (case-folded, whitespace-collapsed)."""
    left, right = _edge_words(doc, span)
    tokens, raw = norm_tokens(fixed_doc), _collapse(fixed_doc)
    for alt in accepted:
        if norm_tokens(alt) == norm_tokens(original):  # punctuation-only fix
            if _collapse(f"{left} {alt} {right}") in raw:
                return True
            continue
        want = norm_tokens(f"{left} {alt} {right}")
        if any(tokens[i : i + len(want)] == want for i in range(len(tokens) - len(want) + 1)):
            return True
    return False


# a change this much longer than the error it fixes is a rewrite, not a targeted edit
_TARGET_SLACK = 60


def _score_edit_spans(
    ex: Example,
    doc: str,
    changes: tuple[Change, ...],
    spans: list[tuple[int, int] | None],
    expected: tuple[Change, ...],
) -> dict[str, float]:
    """Span-based scoring. recall: share of expected errors actually FIXED once the model's
    changes are applied. precision: share of the model's changes that fix an expected error on
    their own; everything else (wrong span, ungrounded, meaning-altering rewording, a change to
    a document that needs none) is spurious. A document that needs no change: any change fails.
    `checks.optional_edits` lists reference-change indices that are optional (stylistic): skipping
    one is not penalised, and a targeted change on its span is never spurious."""
    if not expected:
        return {"no_false_positive": float(not changes)}
    inc = ex.checks.get("must_include", [])
    optional = set(ex.checks.get("optional_edits", []))  # reference changes that may be skipped
    exp_spans: list[tuple[tuple[int, int], str, list[str], bool]] = []
    for i, r in enumerate(expected):
        sp = _find_span(doc, r.original)
        if sp is None:
            continue  # reference does not match the document: caught by a test, never scored
        alts = [r.replacement] + (_alts(inc[i]) if i < len(inc) else [])
        exp_spans.append((sp, r.original, alts, i in optional))
    grounded = [(sp, c.replacement) for sp, c in zip(spans, changes, strict=True) if sp is not None]
    fixed_all = _apply(doc, grounded)
    touched = [sp for sp in spans if sp is not None]  # a change must actually touch the span

    def overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
        return a[0] < b[1] and b[0] < a[1]

    required = [e for e in exp_spans if not e[3]]  # optional edits never count against recall
    fixed = sum(
        any(overlap(sp, t) for t in touched) and _span_fixed(doc, sp, orig, alts, fixed_all)
        for sp, orig, alts, _opt in required
    )
    useful = 0
    for sp, c in zip(spans, changes, strict=True):
        if sp is None:
            continue
        alone = _apply(doc, [(sp, c.replacement)])
        for esp, orig, alts, opt in exp_spans:
            targeted = (sp[1] - sp[0]) <= 3 * (esp[1] - esp[0]) + _TARGET_SLACK
            # an optional edit is not spurious in any wording: it only has to touch that span
            if overlap(sp, esp) and targeted and (opt or _span_fixed(doc, esp, orig, alts, alone)):
                useful += 1
                break
    return {
        "recall": fixed / len(required) if required else 1.0,
        "precision": useful / len(changes) if changes else 1.0,
    }


def _words(s: str) -> int:
    return len(s.split())


def _headings(md: str) -> list[str]:
    return [
        m.group(1).strip().lower() for m in re.finditer(r"^#{1,6}\s+(.+?)\s*$", md, re.MULTILINE)
    ]


def _section_cov(md: str, required: tuple[str, ...]) -> float:
    heads = _headings(md)
    return sum(any(req in h for h in heads) for req in required) / len(required)


_MONTHS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]
_MONTH_RE = "|".join(_MONTHS)
_NUMWORDS = {
    w: str(i)
    for i, w in enumerate(
        [
            "zero",
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "ten",
            "eleven",
            "twelve",
            "thirteen",
            "fourteen",
            "fifteen",
            "sixteen",
            "seventeen",
            "eighteen",
            "nineteen",
            "twenty",
        ]
    )
}
_NUMWORDS.update({"thirty": "30", "forty": "40", "fifty": "50", "sixty": "60", "hundred": "100"})


def _stem(w: str) -> str:
    """Tiny deterministic stemmer: plural/-ies variants only (retries -> retry, days -> day)."""
    if w.isdigit() or len(w) <= 3:
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("sses"):
        return w[:-2]
    if w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def norm_tokens(text: str) -> list[str]:
    """Normalise for phrase matching: case, punctuation, hyphens, apostrophes, ordinals,
    "3 January" == "January 3rd" == "the 3rd of January", number words (thirty == 30),
    "%" == percent, and plural stems. Deterministic; no model involved."""
    t = text.lower().replace("%", " percent ").replace("\u2019", "'")
    t = t.replace("'", "")
    t = re.sub(r"[^\w\s]", " ", t.replace("_", " "))
    t = re.sub(r"\b(\d+)(?:st|nd|rd|th)\b", r"\1", t)
    t = re.sub(rf"\b(\d{{1,2}}) of ({_MONTH_RE})\b", r"\1 \2", t)
    t = re.sub(rf"\b(\d{{1,2}}) ({_MONTH_RE})\b", r"\2 \1", t)  # canonical: month day
    return [_stem(_NUMWORDS.get(w, w)) for w in t.split()]


def contains_phrase(text: str, phrase: str) -> bool:
    a, b = norm_tokens(text), norm_tokens(phrase)
    return bool(b) and any(a[i : i + len(b)] == b for i in range(len(a) - len(b) + 1))


def _alts(entry: str | list[str]) -> list[str]:
    return [entry] if isinstance(entry, str) else list(entry)


UNKNOWN_MARKERS = (
    "unknown",
    "not specified",
    "not provided",
    "not stated",
    "n/a",
    "tbd",
    "not defined",
    "not mentioned",
    "unspecified",
    "to be determined",
    "not given",
)


def _section_body(md: str, field: str) -> str | None:
    """Text under the first heading that contains `field`, up to the next heading."""
    lines = md.splitlines()
    want = norm_tokens(field)
    for i, line in enumerate(lines):
        m = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
        if m and contains_phrase(m.group(1), field) and want:
            body = []
            for nxt in lines[i + 1 :]:
                if re.match(r"^#{1,6}\s", nxt):
                    break
                body.append(nxt)
            return "\n".join(body)
    return None


def _unknown_fields(md: str, ex: Example) -> dict[str, float]:
    """Only for tasks that declare `checks.must_say_unknown`: each named section must say it is
    unknown instead of inventing content. No generic penalty for tasks that do not declare it.
    The item is a multiplier: 1.0 if every declared section says unknown, else
    1 - UNKNOWN_PENALTY * (share of declared sections that invented content)."""
    fields = ex.checks.get("must_say_unknown", [])
    if not fields:
        return {}
    ok = 0
    for f in fields:
        body = _section_body(md, f)
        ok += body is not None and any(contains_phrase(body, m) for m in UNKNOWN_MARKERS)
    return {"unknown_fields": 1.0 - UNKNOWN_PENALTY * (1.0 - ok / len(fields))}


def _phrases(text: str, ex: Example) -> dict[str, float]:
    """must_include entries are a phrase OR a list of acceptable alternatives (any one counts)."""
    out: dict[str, float] = {}
    inc = ex.checks.get("must_include", [])
    exc = ex.checks.get("must_not_include", [])
    if inc:
        out["must_include"] = sum(
            any(contains_phrase(text, a) for a in _alts(e)) for e in inc
        ) / len(inc)
    crit = ex.checks.get("critical", [])  # facts that must all be present, else the example is 0
    raw = ex.checks.get("must_include_raw", [])  # command strings: raw, case-folded substring
    if crit or raw:
        flat = _collapse(text)
        ok_c = all(any(contains_phrase(text, a) for a in _alts(e)) for e in crit)
        ok_r = all(_collapse(r) in flat for r in raw)
        out["critical"] = float(ok_c and ok_r)
    if exc:
        out["must_not_include"] = 1.0 - sum(contains_phrase(text, p) for p in exc) / len(exc)
    return out


def score_example(ex: Example, reply: str) -> Score:
    s = Score(id=ex.id, task=ex.task)
    strict = ex.task in STRICT_JSON_TASKS
    unfenced, s.fenced = strip_outer_fence(reply)
    if strict:  # JSON tasks stay strict; also record validity after unfencing
        try:
            parse_reply(ex.task, unfenced)
            s.json_valid_lenient = True
        except SchemaError:
            s.json_valid_lenient = False
    else:
        reply = unfenced  # prose tasks: a single outer fence does not change the score
    try:
        out = parse_reply(ex.task, reply)
    except SchemaError as e:
        if strict:
            s.json_valid = False
        s.note = str(e)
        s.items["parse"] = 0.0
        return s
    if strict:
        s.json_valid = True
    s.items["parse"] = 1.0
    inp = INPUT_TYPES[ex.task].from_dict(ex.input)

    if ex.task == "critique":
        ids = {r.id: r.max_score for r in inp.rubric}
        s.items["ids_exact"] = float(set(out.scores) == set(ids))
        in_range = [0 <= v <= ids[k] for k, v in out.scores.items() if k in ids]
        s.items["in_range"] = float(bool(in_range) and all(in_range) and len(in_range) == len(ids))
        s.items["rationale_len"] = float(_words(out.rationale) <= 80)
        if ex.reference:  # closeness to the human scores, normalised by each item's range
            ref = CritiqueOutput.from_dict(ex.reference).scores
            errs = [
                abs(out.scores[k] - ref[k]) / ids[k] for k in ids if k in out.scores and k in ref
            ]
            if errs:
                s.items["score_closeness"] = max(0.0, 1.0 - sum(errs) / len(errs))
    elif ex.task == "rewrite":
        orig = inp.passage
        s.items["complete"] = _complete(out.text)
        s.items["changed"] = float(out.text.strip() != orig.strip())
        ratio = _words(out.text) / max(1, _words(orig))
        s.items["length_sane"] = float(0.3 <= ratio <= 2.0)
        s.items["no_preamble"] = float(not PREAMBLE.match(out.text))
        s.items.update(_phrases(out.text, ex))
    elif ex.task == "agents_md":
        s.items["sections"] = _section_cov(out.text, AGENTS_SECTIONS)
        s.items["no_preamble"] = float(not PREAMBLE.match(out.text))
        s.items.update(_phrases(out.text, ex))
        s.items.update(_unknown_fields(out.text, ex))
    elif ex.task == "architecture_md":
        s.items["sections"] = _section_cov(out.text, ARCH_SECTIONS)
        s.items["no_preamble"] = float(not PREAMBLE.match(out.text))
        s.items.update(_phrases(out.text, ex))
        s.items.update(_unknown_fields(out.text, ex))
    elif ex.task == "summarize":
        s.items["complete"] = _complete(out.text)
        s.items["within_limit"] = limit_factor(_words(out.text), inp.max_words)
        s.items["shorter_than_source"] = float(_words(out.text) < _words(inp.document))
        s.items.update(_phrases(out.text, ex))
    elif ex.task == "suggest_edits":
        doc = inp.document
        spans = [_find_span(doc, c.original) for c in out.changes]
        if out.changes:  # `original` must be copied verbatim from the document
            s.items["grounded"] = sum(sp is not None for sp in spans) / len(out.changes)
            s.items["has_reason"] = float(all(c.reason.strip() for c in out.changes))
        else:
            s.items["grounded"] = 1.0
        s.items["non_noop"] = float(
            all(c.original != c.replacement for c in out.changes)
        )  # no-op = noise
        expected = EditsOutput.from_dict(ex.reference).changes if ex.reference is not None else None
        if expected is not None:
            s.items.update(_score_edit_spans(ex, doc, out.changes, spans, expected))
            # An empty or no-op answer (every change has original == replacement) cannot earn credit
            # for a task whose reference has at least one REQUIRED edit. Emitted only on failure, so
            # it never dilutes the form mean.
            optional = set(ex.checks.get("optional_edits", []))
            required = [i for i in range(len(expected)) if i not in optional]
            if required and not any(c.original != c.replacement for c in out.changes):
                s.items["no_real_change"] = 0.0
    return s


def summarize_scores(scores: list[Score]) -> dict[str, dict[str, Any]]:
    """Per-task aggregate: n, mean total (0..1), json_valid_rate for strict-JSON tasks."""
    by: dict[str, list[Score]] = {}
    for s in scores:
        by.setdefault(s.task, []).append(s)
    out: dict[str, dict[str, Any]] = {}
    for task, ss in by.items():
        row: dict[str, Any] = {
            "n": len(ss),
            "mean": sum(x.total for x in ss) / len(ss),
            "mean_ungated": sum(x.ungated for x in ss) / len(ss),
            "gated_zero": sum(x.total == 0.0 < x.ungated for x in ss),
            "fenced_rate": sum(x.fenced for x in ss) / len(ss),
        }
        if task in STRICT_JSON_TASKS:
            row["json_valid_rate"] = sum(bool(x.json_valid) for x in ss) / len(ss)
            row["json_valid_lenient_rate"] = sum(bool(x.json_valid_lenient) for x in ss) / len(ss)
        out[task] = row
    return out
