"""Both directions: known-good variants must score >= 0.8, known-bad outputs <= 0.3.

Variants marked "status": "ambiguous" are cases where a human could go either way; they are listed
and reported but NOT asserted, and the checks are not loosened to make them pass.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from schema import TASKS, read_jsonl
from scoring import score_example

DATA = HERE / "data"
GOOD_MIN, BAD_MAX = 0.8, 0.3


def held() -> dict:
    p = DATA / "heldout.v1.jsonl"
    if not p.exists():
        p = DATA / "heldout.draft.jsonl"
    return {e.id: e for e in [*read_jsonl(p), *read_jsonl(DATA / "seed.jsonl")]}


def load(name: str) -> list[dict]:
    return [json.loads(x) for x in (DATA / name).read_text().splitlines() if x.strip()]


class BothDirectionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ex = held()
        cls.good = load("known_good_variants.jsonl")
        cls.bad = load("known_bad.jsonl")

    def test_good_variants_coverage(self) -> None:
        self.assertGreaterEqual(len({g["heldout_id"] for g in self.good}), 12)
        self.assertEqual({g["task"] for g in self.good}, set(TASKS))
        smoke = {g["heldout_id"] for g in self.good if "SMOKE RUN" in g["why"]}
        self.assertTrue({"ho-rewrite-05", "ho-summarize-05", "seed-architecture-md-01"} <= smoke)

    def test_good_variants_score_at_least_0_8(self) -> None:
        low = []
        for g in self.good:
            if g.get("status") == "ambiguous":
                continue
            s = score_example(self.ex[g["heldout_id"]], g["reply"])
            if s.total < GOOD_MIN:
                low.append(
                    (
                        g["id"],
                        round(s.total, 2),
                        {k: round(v, 2) for k, v in s.items.items() if v < 1},
                    )
                )
        self.assertEqual(low, [])

    def test_ambiguous_variants_are_explained_and_few(self) -> None:
        amb = [g for g in self.good if g.get("status") == "ambiguous"]
        self.assertTrue(all(g.get("ambiguity_note") for g in amb))
        self.assertLessEqual(len(amb), len(self.good) // 4)
        # after the final tweaks only the strict "a month vs 30 days" case stays ambiguous
        self.assertEqual([g["id"] for g in amb], ["good-ho-rewrite-01-blind2"])

    def test_known_bad_still_low(self) -> None:
        high = [
            (b["id"], round(score_example(self.ex[b["heldout_id"]], b["reply"]).total, 2))
            for b in self.bad
            if score_example(self.ex[b["heldout_id"]], b["reply"]).total > BAD_MAX
        ]
        self.assertEqual(high, [])

    def test_every_reference_still_scores_1(self) -> None:
        for ex in self.ex.values():
            ref = (
                json.dumps(ex.reference)
                if ex.task in ("critique", "suggest_edits")
                else ex.reference["text"]
            )
            self.assertEqual(score_example(ex, ref).total, 1.0, ex.id)


if __name__ == "__main__":
    unittest.main()
