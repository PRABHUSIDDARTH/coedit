"""Scorer sanity: known-bad outputs must score low, references must score high.

The reference check alone only shows the scorer accepts good answers; this file shows it also
rejects bad ones (empty, truncated, off-topic, input copied back, plausible-but-wrong).
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
BAD_MAX = 0.3
KINDS = {"empty", "truncated", "off_topic", "input_copied", "plausible_wrong"}


def heldout_path() -> Path:
    """The draft until it is frozen, then heldout.v1.jsonl (freeze_heldout.py moves it)."""
    for name in ("heldout.v1.jsonl", "heldout.draft.jsonl"):
        if (DATA / name).exists():
            return DATA / name
    raise FileNotFoundError("no held-out file found")


class KnownBadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.held = {e.id: e for e in read_jsonl(heldout_path())}
        cls.bad = [json.loads(x) for x in (DATA / "known_bad.jsonl").read_text().splitlines() if x]

    def test_coverage(self) -> None:
        self.assertGreaterEqual(len({b["heldout_id"] for b in self.bad}), 10)
        self.assertEqual({b["task"] for b in self.bad}, set(TASKS))
        self.assertEqual({b["kind"] for b in self.bad}, KINDS)
        for hid in {b["heldout_id"] for b in self.bad}:  # every task has all five kinds
            self.assertEqual({b["kind"] for b in self.bad if b["heldout_id"] == hid}, KINDS, hid)

    def test_every_bad_output_scores_at_most_0_3(self) -> None:
        offenders = []
        for b in self.bad:
            s = score_example(self.held[b["heldout_id"]], b["reply"])
            if s.total > BAD_MAX:
                offenders.append((b["id"], round(s.total, 2)))
        self.assertEqual(offenders, [])

    def test_good_and_bad_are_separated(self) -> None:
        for hid in {b["heldout_id"] for b in self.bad}:
            ex = self.held[hid]
            ref = (
                json.dumps(ex.reference)
                if ex.task in ("critique", "suggest_edits")
                else ex.reference["text"]
            )
            self.assertEqual(score_example(ex, ref).total, 1.0, hid)

    def test_strict_json_tasks_report_invalid_json_for_non_json_bad_outputs(self) -> None:
        for b in self.bad:
            if b["task"] in ("critique", "suggest_edits") and b["kind"] in (
                "empty",
                "truncated",
                "off_topic",
                "input_copied",
            ):
                s = score_example(self.held[b["heldout_id"]], b["reply"])
                self.assertIs(s.json_valid, False, b["id"])

    def test_scorer_edge_rules(self) -> None:
        ex = self.held["ho-summarize-01"]
        self.assertEqual(
            score_example(
                ex,
                "Council voted 7-2 to extend the Harbor Road bike lane by 3 km, funded by a grant",
            ).total,
            0.0,
        )  # cut off
        ed = self.held["ho-suggest-edits-04"]  # document is fine: no changes is the right answer
        self.assertEqual(score_example(ed, '{"changes": []}').total, 1.0)


if __name__ == "__main__":
    unittest.main()
