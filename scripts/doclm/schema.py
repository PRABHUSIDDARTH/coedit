"""docLM data schema: task inputs/outputs, JSONL reader/writer, validation.

Standard library only (no new dependencies). Every `from_dict` raises SchemaError with a
short message that never echoes the offending value (inputs may be private documents).
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

TASKS = (
    "critique",
    "rewrite",
    "agents_md",
    "architecture_md",
    "summarize",
    "suggest_edits",
)
SPLITS = ("seed", "train", "heldout")


class SchemaError(ValueError):
    """Raised for any invalid record. The message names the field, never its value."""


# ---------------------------------------------------------------- helpers


def _obj(d: Any, where: str) -> dict[str, Any]:
    if not isinstance(d, dict):
        raise SchemaError(f"{where}: expected an object")
    return d


def _str(d: dict[str, Any], key: str, where: str, *, allow_empty: bool = False) -> str:
    v = d.get(key)
    if not isinstance(v, str) or (not allow_empty and not v.strip()):
        raise SchemaError(f"{where}.{key}: expected a non-empty string")
    return v


def _only(d: dict[str, Any], keys: set[str], where: str) -> None:
    extra = set(d) - keys
    if extra:
        raise SchemaError(f"{where}: unexpected field(s) {sorted(extra)}")


# ---------------------------------------------------------------- rubric


@dataclass(frozen=True)
class RubricItem:
    id: str
    description: str
    max_score: int = 5

    @classmethod
    def from_dict(cls, d: Any, where: str = "rubric[]") -> RubricItem:
        d = _obj(d, where)
        _only(d, {"id", "description", "max_score"}, where)
        ms = d.get("max_score", 5)
        if isinstance(ms, bool) or not isinstance(ms, int) or not 1 <= ms <= 10:
            raise SchemaError(f"{where}.max_score: expected an int in 1..10")
        return cls(_str(d, "id", where), _str(d, "description", where), ms)


def _rubric(d: dict[str, Any], where: str) -> tuple[RubricItem, ...]:
    raw = d.get("rubric")
    if not isinstance(raw, list) or not raw:
        raise SchemaError(f"{where}.rubric: expected a non-empty list")
    items = tuple(RubricItem.from_dict(x, f"{where}.rubric[{i}]") for i, x in enumerate(raw))
    if len({r.id for r in items}) != len(items):
        raise SchemaError(f"{where}.rubric: duplicate rubric ids")
    return items


# ---------------------------------------------------------------- inputs


@dataclass(frozen=True)
class CritiqueInput:
    document: str
    rubric: tuple[RubricItem, ...]

    @classmethod
    def from_dict(cls, d: Any, where: str = "input") -> CritiqueInput:
        d = _obj(d, where)
        _only(d, {"document", "rubric"}, where)
        return cls(_str(d, "document", where), _rubric(d, where))


@dataclass(frozen=True)
class RewriteInput:
    passage: str
    rubric: tuple[RubricItem, ...]

    @classmethod
    def from_dict(cls, d: Any, where: str = "input") -> RewriteInput:
        d = _obj(d, where)
        _only(d, {"passage", "rubric"}, where)
        return cls(_str(d, "passage", where), _rubric(d, where))


@dataclass(frozen=True)
class BriefInput:
    """Used by both agents_md and architecture_md."""

    brief: str

    @classmethod
    def from_dict(cls, d: Any, where: str = "input") -> BriefInput:
        d = _obj(d, where)
        _only(d, {"brief"}, where)
        return cls(_str(d, "brief", where))


@dataclass(frozen=True)
class SummarizeInput:
    document: str
    max_words: int

    @classmethod
    def from_dict(cls, d: Any, where: str = "input") -> SummarizeInput:
        d = _obj(d, where)
        _only(d, {"document", "max_words"}, where)
        mw = d.get("max_words")
        if isinstance(mw, bool) or not isinstance(mw, int) or not 5 <= mw <= 1000:
            raise SchemaError(f"{where}.max_words: expected an int in 5..1000")
        return cls(_str(d, "document", where), mw)


@dataclass(frozen=True)
class EditsInput:
    document: str

    @classmethod
    def from_dict(cls, d: Any, where: str = "input") -> EditsInput:
        d = _obj(d, where)
        _only(d, {"document"}, where)
        return cls(_str(d, "document", where))


INPUT_TYPES: dict[str, Any] = {
    "critique": CritiqueInput,
    "rewrite": RewriteInput,
    "agents_md": BriefInput,
    "architecture_md": BriefInput,
    "summarize": SummarizeInput,
    "suggest_edits": EditsInput,
}


# ---------------------------------------------------------------- outputs


@dataclass(frozen=True)
class CritiqueOutput:
    """Strict JSON: {"scores": {"<rubric id>": int, ...}, "rationale": "<= 80 words"}."""

    scores: dict[str, int]
    rationale: str

    @classmethod
    def from_dict(cls, d: Any, where: str = "output") -> CritiqueOutput:
        d = _obj(d, where)
        _only(d, {"scores", "rationale"}, where)
        sc = _obj(d.get("scores"), f"{where}.scores")
        for k, v in sc.items():
            if isinstance(v, bool) or not isinstance(v, int):
                raise SchemaError(f"{where}.scores[{k!r}]: expected an int")
        return cls(dict(sc), _str(d, "rationale", where))


@dataclass(frozen=True)
class TextOutput:
    """rewrite -> `text`; agents_md/architecture_md -> markdown; summarize -> summary."""

    text: str

    @classmethod
    def from_dict(cls, d: Any, where: str = "output") -> TextOutput:
        d = _obj(d, where)
        _only(d, {"text"}, where)
        return cls(_str(d, "text", where))


@dataclass(frozen=True)
class Change:
    location: str  # human-readable, e.g. "paragraph 2"
    original: str  # must appear verbatim in the document (checked by the scorer)
    replacement: str
    reason: str

    @classmethod
    def from_dict(cls, d: Any, where: str = "changes[]") -> Change:
        d = _obj(d, where)
        _only(d, {"location", "original", "replacement", "reason"}, where)
        return cls(
            _str(d, "location", where),
            _str(d, "original", where),
            _str(d, "replacement", where, allow_empty=True),  # empty = delete
            _str(d, "reason", where),
        )


@dataclass(frozen=True)
class EditsOutput:
    """Strict JSON: {"changes": [{"location","original","replacement","reason"}, ...]}."""

    changes: tuple[Change, ...]

    @classmethod
    def from_dict(cls, d: Any, where: str = "output") -> EditsOutput:
        d = _obj(d, where)
        _only(d, {"changes"}, where)
        raw = d.get("changes")
        if not isinstance(raw, list):
            raise SchemaError(f"{where}.changes: expected a list")
        return cls(tuple(Change.from_dict(x, f"{where}.changes[{i}]") for i, x in enumerate(raw)))


OUTPUT_TYPES: dict[str, Any] = {
    "critique": CritiqueOutput,
    "rewrite": TextOutput,
    "agents_md": TextOutput,
    "architecture_md": TextOutput,
    "summarize": TextOutput,
    "suggest_edits": EditsOutput,
}

STRICT_JSON_TASKS = frozenset({"critique", "suggest_edits"})


# ---------------------------------------------------------------- example record


@dataclass
class Example:
    """One JSONL line. `reference` is the gold output (same shape as the task's output type).

    `checks` holds optional scorer hints written by the example's author:
    {"must_include": [...], "must_not_include": [...]}.
    """

    id: str
    task: str
    split: str  # seed | train | heldout
    source: str  # provenance, e.g. "seed-handwritten"; required so data lineage is auditable
    input: dict[str, Any]
    reference: dict[str, Any] | None = None
    checks: dict[str, list[Any]] = field(default_factory=dict)

    def validate(self) -> None:
        w = f"example {self.id!r}"
        if not isinstance(self.id, str) or not self.id.strip():
            raise SchemaError("example.id: expected a non-empty string")
        if self.task not in TASKS:
            raise SchemaError(f"{w}.task: must be one of {TASKS}")
        if self.split not in SPLITS:
            raise SchemaError(f"{w}.split: must be one of {SPLITS}")
        if not isinstance(self.source, str) or not self.source.strip():
            raise SchemaError(f"{w}.source: provenance is required")
        INPUT_TYPES[self.task].from_dict(self.input, f"{w}.input")
        if self.reference is not None:
            OUTPUT_TYPES[self.task].from_dict(self.reference, f"{w}.reference")
        if self.split == "heldout" and self.reference is None:
            raise SchemaError(f"{w}.reference: held-out examples need a reference")
        for key, vals in self.checks.items():
            if key not in {"must_include", "must_not_include", "must_say_unknown"}:
                raise SchemaError(f"{w}.checks: unknown key {key!r}")
            if not isinstance(vals, list):
                raise SchemaError(f"{w}.checks.{key}: expected a list")
            for v in vals:  # must_include entries may be a list of acceptable alternatives
                ok = isinstance(v, str) and v
                if key == "must_include" and isinstance(v, list):
                    ok = bool(v) and all(isinstance(a, str) and a for a in v)
                if not ok:
                    raise SchemaError(f"{w}.checks.{key}: entries must be non-empty strings")

    @classmethod
    def from_dict(cls, d: Any) -> Example:
        d = _obj(d, "example")
        _only(d, {"id", "task", "split", "source", "input", "reference", "checks"}, "example")
        ex = cls(
            id=d.get("id"),  # type: ignore[arg-type]
            task=d.get("task"),  # type: ignore[arg-type]
            split=d.get("split"),  # type: ignore[arg-type]
            source=d.get("source"),  # type: ignore[arg-type]
            input=d.get("input"),  # type: ignore[arg-type]
            reference=d.get("reference"),
            checks=d.get("checks") or {},
        )
        ex.validate()
        return ex

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        if not out["checks"]:
            del out["checks"]
        return out


# ---------------------------------------------------------------- JSONL


def read_jsonl(path: str | Path) -> list[Example]:
    """Read and validate. Errors carry the line number only, never the line's content."""
    out: list[Example] = []
    seen: set[str] = set()
    with Path(path).open(encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                ex = Example.from_dict(json.loads(line))
            except json.JSONDecodeError:
                raise SchemaError(f"{path}:{n}: invalid JSON") from None
            except SchemaError as e:
                raise SchemaError(f"{path}:{n}: {e}") from None
            if ex.id in seen:
                raise SchemaError(f"{path}:{n}: duplicate id")
            seen.add(ex.id)
            out.append(ex)
    return out


def write_jsonl(path: str | Path, examples: Iterable[Example]) -> int:
    n = 0
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        for ex in examples:
            ex.validate()
            f.write(json.dumps(ex.to_dict(), ensure_ascii=False, sort_keys=True) + "\n")
            n += 1
    return n


def iter_inputs(examples: Iterable[Example]) -> Iterator[tuple[Example, Any]]:
    for ex in examples:
        yield ex, INPUT_TYPES[ex.task].from_dict(ex.input)


def check_no_overlap(train: Iterable[Example], heldout: Iterable[Example]) -> None:
    """Fail if any held-out id or exact input text also appears in the training data."""
    held = list(heldout)
    held_ids = {e.id for e in held}
    held_inputs = {json.dumps(e.input, sort_keys=True) for e in held}
    for e in train:
        if e.split == "heldout":
            raise SchemaError("training data contains a heldout-split record")
        if e.id in held_ids:
            raise SchemaError("id overlap between training and held-out data")
        if json.dumps(e.input, sort_keys=True) in held_inputs:
            raise SchemaError("input overlap between training and held-out data")
