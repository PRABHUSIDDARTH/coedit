"""suggest_edits: an empty or no-op answer scores 0 when the reference has a required edit."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from schema import read_jsonl
from scoring import score_example

HELD = {e.id: e for e in read_jsonl(HERE / "data" / "heldout.draft.jsonl")}


def noop(orig: str) -> str:
    c = {"location": "x", "original": orig, "replacement": orig, "reason": "none"}
    return json.dumps({"changes": [c]})


class NoRealChangeTests(unittest.TestCase):
    def test_empty_and_noop_score_zero_when_an_edit_is_required(self) -> None:
        for i, e in HELD.items():
            if e.task != "suggest_edits":
                continue
            opt = set(e.checks.get("optional_edits", []))
            ch = e.reference["changes"]
            if not [k for k in range(len(ch)) if k not in opt]:
                continue
            self.assertEqual(score_example(e, '{"changes": []}').total, 0.0, i)
            self.assertEqual(score_example(e, noop(ch[0]["original"])).total, 0.0, i)

    def test_noop_cannot_pass_through_an_alternative_already_in_the_text(self) -> None:
        # ho-suggest-edits-07 lists "after that", which also occurs in the original span
        e = HELD["ho-suggest-edits-07"]
        self.assertEqual(score_example(e, noop("after that period of time has elapsed")).total, 0.0)

    def test_a_real_fix_still_scores_one(self) -> None:
        for i, e in HELD.items():
            if e.task == "suggest_edits":
                self.assertAlmostEqual(score_example(e, json.dumps(e.reference)).total, 1.0, msg=i)

    def test_all_optional_reference_is_unchanged_by_this_rule(self) -> None:
        e = HELD["ho-suggest-edits-06"]  # only edit is optional: empty is still allowed
        self.assertEqual(score_example(e, '{"changes": []}').total, 1.0)

    def test_no_edit_task_unchanged(self) -> None:
        e = HELD["ho-suggest-edits-04"]
        self.assertEqual(score_example(e, '{"changes": []}').total, 1.0)


if __name__ == "__main__":
    unittest.main()
