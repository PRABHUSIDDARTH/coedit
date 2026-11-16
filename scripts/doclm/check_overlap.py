#!/usr/bin/env python3
"""Fail if any training example overlaps the held-out set. Run it in EVERY data-build step.

A training example is flagged when, for any held-out task, ANY of these hold:
  exact      its content text equals the held-out content text (raw)
  normalized equal after lower-casing, removing punctuation and collapsing whitespace
  ngram      >= THRESHOLD of the held-out text's word 5-grams also occur in the training text
Both the task INPUT content (document / passage / brief) and the REFERENCE output text are
compared, so a held-out answer leaking into a training target is caught too.
Rubrics are deliberately not compared: they are shared boilerplate across many tasks.

THRESHOLD = 0.40 (containment of held-out 5-grams in the training text). Why: unrelated texts of
this domain share ~0-10% of 5-grams; a copy with a few words edited shares 60-90%; 0.40 leaves
margin on both sides. It is a judgement, tested with planted duplicates in tests/test_overlap.py.
Texts under 5 words can only match exactly or after normalization.

Reports never print example text, only ids, kinds and scores.

  python3 scripts/doclm/check_overlap.py --train scripts/doclm/data/train.jsonl [more.jsonl ...]
  (--heldout defaults to data/heldout.v1.jsonl, else data/heldout.draft.jsonl)
Exit 0 = clean, 1 = overlap found, 2 = usage/data error.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema import Example, SchemaError, read_jsonl

DATA = Path(__file__).resolve().parent / "data"
NGRAM = 5
THRESHOLD = 0.40


class OverlapError(SchemaError):
    """Raised by assert_no_overlap; the message lists ids and scores only."""


def default_heldout() -> Path:
    for name in ("heldout.v1.jsonl", "heldout.draft.jsonl"):
        if (DATA / name).exists():
            return DATA / name
    raise SchemaError("no held-out file found (data/heldout.v1.jsonl or heldout.draft.jsonl)")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


def content_text(ex: Example) -> str:
    """The free text of the task input (rubrics excluded: shared boilerplate)."""
    i = ex.input
    return str(i.get("document") or i.get("passage") or i.get("brief") or "")


def reference_text(ex: Example) -> str:
    r = ex.reference or {}
    if "text" in r:
        return str(r["text"])
    if "rationale" in r:
        return str(r["rationale"])
    if "changes" in r:
        return " ".join(f"{c['original']} {c['replacement']} {c['reason']}" for c in r["changes"])
    return ""


def ngrams(text: str, n: int = NGRAM) -> set[tuple[str, ...]]:
    w = normalize(text).split()
    return {tuple(w[i : i + n]) for i in range(len(w) - n + 1)}


@dataclass(frozen=True)
class Hit:
    train_id: str
    heldout_id: str
    field: str  # "input" | "reference"
    kind: str  # exact | normalized | ngram
    score: float

    def __str__(self) -> str:
        return f"{self.train_id} ~ {self.heldout_id} [{self.field}] {self.kind} {self.score:.2f}"


def _compare(a: str, b: str, threshold: float, n: int) -> tuple[str, float] | None:
    """a = training text, b = held-out text."""
    if not a.strip() or not b.strip():
        return None
    if a == b:
        return "exact", 1.0
    if normalize(a) == normalize(b):
        return "normalized", 1.0
    gb = ngrams(b, n)
    if gb:
        cov = len(gb & ngrams(a, n)) / len(gb)
        if cov >= threshold:
            return "ngram", cov
    return None


def find_overlaps(
    train: list[Example], heldout: list[Example], *, threshold: float = THRESHOLD, n: int = NGRAM
) -> list[Hit]:
    hits: list[Hit] = []
    for t in train:
        if t.split == "heldout":
            hits.append(Hit(t.id, t.id, "split", "heldout-in-train", 1.0))
            continue
        pairs = [("input", content_text(t)), ("reference", reference_text(t))]
        for h in heldout:
            hid = h.id
            if t.id == hid:
                hits.append(Hit(t.id, hid, "id", "same-id", 1.0))
            held = {"input": content_text(h), "reference": reference_text(h)}
            for field_t, txt_t in pairs:  # compare every train field with every held-out field
                for field_h, txt_h in held.items():
                    r = _compare(txt_t, txt_h, threshold, n)
                    if r:
                        hits.append(Hit(t.id, hid, f"{field_t}->{field_h}", r[0], r[1]))
    return hits


def assert_no_overlap(
    train: list[Example], heldout: list[Example] | None = None, **kw: float
) -> None:
    """Import this in data-build scripts and call it BEFORE writing any training file."""
    held = heldout if heldout is not None else read_jsonl(default_heldout())
    hits = find_overlaps(train, held, **kw)  # type: ignore[arg-type]
    if hits:
        shown = "; ".join(str(h) for h in hits[:10])
        raise OverlapError(f"{len(hits)} overlap(s) with the held-out set: {shown}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--train", nargs="+", required=True, help="training JSONL file(s)")
    ap.add_argument("--heldout", help="default: heldout.v1.jsonl, else heldout.draft.jsonl")
    ap.add_argument("--threshold", type=float, default=THRESHOLD)
    args = ap.parse_args()
    try:
        held_path = Path(args.heldout) if args.heldout else default_heldout()
        held = read_jsonl(held_path)
        train: list[Example] = []
        for p in args.train:
            if Path(p).resolve() == held_path.resolve():
                raise SchemaError("--train must not include the held-out file itself")
            train += read_jsonl(p)
        hits = find_overlaps(train, held, threshold=args.threshold)
    except (SchemaError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if hits:
        print(f"OVERLAP: {len(hits)} hit(s) between {len(train)} training and {len(held)} held-out")
        for h in hits[:50]:
            print(" ", h)
        return 1
    print(
        f"OK: no overlap ({len(train)} training vs {len(held)} held-out, "
        f"{NGRAM}-gram threshold {args.threshold})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
