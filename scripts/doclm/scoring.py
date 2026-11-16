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
    CritiqueInput,
    CritiqueOutput,
    EditsInput,
    EditsOutput,
    Example,
    SchemaError,
    SummarizeInput,
    TextOutput,
)

AGENTS_SECTIONS = ("stack", "commands", "conventions", "definition of done")
ARCH_SECTIONS = ("overview", "components", "data flow", "decisions", "risks")
PREAMBLE = re.compile(r"^\s*(sure|certainly|of course|here is|here's|okay|ok,)", re.I)

SYSTEM_PROMPTS = {
    "critique": (
        'TASK: critique\nScore the document against each rubric item. Reply with ONE JSON object '
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
        'TASK: suggest_edits\nSuggest edits as ONE JSON object and nothing else (no code fences): '
        '{"changes": [{"location": "...", "original": "<exact text copied from the document>", '
        '"replacement": "...", "reason": "..."}]}. An empty list is allowed.'
    ),
}


def _wrap(tag_text: str) -> str:
    # Mirrors Coedit's convention: document text is data, wrapped and with the tag defused.
    safe = tag_text.replace("</untrusted_source>", "<\\/untrusted_source>")
    return f"<untrusted_source>\n{safe}\n</untrusted_source>"


def build_messages(ex: Example) -> list[dict[str, str]]:
    inp = INPUT_TYPES[ex.task].from_dict(ex.input)
    if ex.task == "critique":
        assert isinstance(inp, CritiqueInput)
        rub = "\n".join(f"- {r.id} (0..{r.max_score}): {r.description}" for r in inp.rubric)
        user = f"Rubric:\n{rub}\n\nDocument:\n{_wrap(inp.document)}"
    elif ex.task == "rewrite":
        rub = "\n".join(f"- {r.id}: {r.description}" for r in inp.rubric)
        user = f"Rubric:\n{rub}\n\nPassage:\n{_wrap(inp.passage)}"
    elif ex.task in ("agents_md", "architecture_md"):
        user = f"Brief:\n{_wrap(inp.brief)}"
    elif ex.task == "summarize":
        assert isinstance(inp, SummarizeInput)
        user = f"Max words: {inp.max_words}\n\nDocument:\n{_wrap(inp.document)}"
    else:
        user = f"Document:\n{_wrap(inp.document)}"
    return [
        {"role": "system", "content": SYSTEM_PROMPTS[ex.task]},
        {"role": "user", "content": user},
    ]


# ---------------------------------------------------------------- parsing


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


@dataclass
class Score:
    id: str
    task: str
    items: dict[str, float] = field(default_factory=dict)  # each in 0..1
    json_valid: bool | None = None  # only for strict-JSON tasks
    note: str = ""

    @property
    def total(self) -> float:
        return sum(self.items.values()) / len(self.items) if self.items else 0.0


def _words(s: str) -> int:
    return len(s.split())


def _headings(md: str) -> list[str]:
    return [m.group(1).strip().lower() for m in re.finditer(r"^#{1,6}\s+(.+?)\s*$", md, re.M)]


def _section_cov(md: str, required: tuple[str, ...]) -> float:
    heads = _headings(md)
    return sum(any(req in h for h in heads) for req in required) / len(required)


def _phrases(text: str, ex: Example) -> dict[str, float]:
    out: dict[str, float] = {}
    inc = ex.checks.get("must_include", [])
    exc = ex.checks.get("must_not_include", [])
    low = text.lower()
    if inc:
        out["must_include"] = sum(p.lower() in low for p in inc) / len(inc)
    if exc:
        out["must_not_include"] = 1.0 - sum(p.lower() in low for p in exc) / len(exc)
    return out


def score_example(ex: Example, reply: str) -> Score:
    s = Score(id=ex.id, task=ex.task)
    strict = ex.task in STRICT_JSON_TASKS
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
        assert isinstance(out, CritiqueOutput) and isinstance(inp, CritiqueInput)
        ids = {r.id: r.max_score for r in inp.rubric}
        s.items["ids_exact"] = float(set(out.scores) == set(ids))
        in_range = [0 <= v <= ids[k] for k, v in out.scores.items() if k in ids]
        s.items["in_range"] = float(bool(in_range) and all(in_range) and len(in_range) == len(ids))
        s.items["rationale_len"] = float(_words(out.rationale) <= 80)
        if ex.reference:  # closeness to the human scores, normalised by each item's range
            ref = CritiqueOutput.from_dict(ex.reference).scores
            errs = [abs(out.scores[k] - ref[k]) / ids[k] for k in ids if k in out.scores and k in ref]
            if errs:
                s.items["score_closeness"] = max(0.0, 1.0 - sum(errs) / len(errs))
    elif ex.task == "rewrite":
        assert isinstance(out, TextOutput)
        orig = getattr(inp, "passage")
        s.items["changed"] = float(out.text.strip() != orig.strip())
        ratio = _words(out.text) / max(1, _words(orig))
        s.items["length_sane"] = float(0.3 <= ratio <= 2.0)
        s.items["no_preamble"] = float(not PREAMBLE.match(out.text))
        s.items.update(_phrases(out.text, ex))
    elif ex.task == "agents_md":
        assert isinstance(out, TextOutput)
        s.items["sections"] = _section_cov(out.text, AGENTS_SECTIONS)
        s.items["no_preamble"] = float(not PREAMBLE.match(out.text))
        s.items.update(_phrases(out.text, ex))
    elif ex.task == "architecture_md":
        assert isinstance(out, TextOutput)
        s.items["sections"] = _section_cov(out.text, ARCH_SECTIONS)
        s.items["no_preamble"] = float(not PREAMBLE.match(out.text))
        s.items.update(_phrases(out.text, ex))
    elif ex.task == "summarize":
        assert isinstance(out, TextOutput) and isinstance(inp, SummarizeInput)
        s.items["within_limit"] = float(_words(out.text) <= inp.max_words)
        s.items["shorter_than_source"] = float(_words(out.text) < _words(inp.document))
        s.items.update(_phrases(out.text, ex))
    elif ex.task == "suggest_edits":
        assert isinstance(out, EditsOutput) and isinstance(inp, EditsInput)
        if out.changes:
            ok = [c.original in inp.document for c in out.changes]
            s.items["grounded"] = sum(ok) / len(ok)  # `original` must be copied verbatim
            s.items["has_reason"] = float(all(c.reason.strip() for c in out.changes))
        else:
            s.items["grounded"] = 0.0 if ex.checks.get("must_include") else 1.0
        # a "change" that changes nothing is noise
        s.items["non_noop"] = float(all(c.original != c.replacement for c in out.changes))
        s.items.update(_phrases(" ".join(c.replacement for c in out.changes), ex))
    return s


def summarize_scores(scores: list[Score]) -> dict[str, dict[str, Any]]:
    """Per-task aggregate: n, mean total (0..1), json_valid_rate for strict-JSON tasks."""
    by: dict[str, list[Score]] = {}
    for s in scores:
        by.setdefault(s.task, []).append(s)
    out: dict[str, dict[str, Any]] = {}
    for task, ss in by.items():
        row: dict[str, Any] = {"n": len(ss), "mean": sum(x.total for x in ss) / len(ss)}
        if task in STRICT_JSON_TASKS:
            row["json_valid_rate"] = sum(bool(x.json_valid) for x in ss) / len(ss)
        out[task] = row
    return out
