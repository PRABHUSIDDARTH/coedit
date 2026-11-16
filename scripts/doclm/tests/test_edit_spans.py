"""suggest_edits: span-based recall and precision (offsets, not substrings)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import make_seed_data
from schema import EditsOutput, read_jsonl
from scoring import _apply, _find_span, score_example

HELD = {e.id: e for e in read_jsonl(HERE / "data" / "heldout.draft.jsonl")}
SEED = {e.id: e for e in make_seed_data.build()}


def chg(original: str, replacement: str, reason: str = "r") -> dict:
    return {"location": "x", "original": original, "replacement": replacement, "reason": reason}


def reply(*changes: dict) -> str:
    return json.dumps({"changes": list(changes)})


class EditSpanTests(unittest.TestCase):
    def test_every_reference_span_exists_in_its_document(self) -> None:
        for ex in [*HELD.values(), *SEED.values()]:
            if ex.task != "suggest_edits" or not ex.reference:
                continue
            for c in EditsOutput.from_dict(ex.reference).changes:
                self.assertIsNotNone(_find_span(ex.input["document"], c.original), ex.id)

    def test_smoke_run_failure_scores_low(self) -> None:
        """The 'the the' error was left unfixed and unrelated changes were suggested."""
        ex = SEED["seed-suggest-edits-01"]
        s = score_example(ex, reply(chg("the", "an"), chg("Friday", "by Friday")))
        self.assertLessEqual(s.total, 0.1)
        self.assertEqual(s.items["recall"], 0.0)
        self.assertEqual(s.items["precision"], 0.0)

    def test_short_substring_overlap_is_not_a_fix(self) -> None:
        ex = SEED[
            "seed-suggest-edits-01"
        ]  # old scorer: "the" is a substring of the error, recall 1.0
        self.assertEqual(score_example(ex, reply(chg("the", "a"))).items["recall"], 0.0)

    def test_minimal_and_whole_sentence_fixes_both_count(self) -> None:
        ex = HELD["ho-suggest-edits-01"]
        doc = ex.input["document"]
        self.assertEqual(score_example(ex, reply(chg("the the", "the"))).total, 1.0)
        self.assertEqual(
            score_example(
                ex,
                reply(
                    chg(
                        doc,
                        "The team has finished the migration and is now testing the new database.",
                    )
                ),
            ).total,
            1.0,
        )

    def test_spurious_change_lowers_score_but_not_recall(self) -> None:
        ex = HELD["ho-suggest-edits-08"]
        good = [
            chg("password click", "password, click"),
            chg("new password it must", "new password. It must"),
        ]
        self.assertEqual(score_example(ex, reply(*good)).total, 1.0)
        s = score_example(ex, reply(*good, chg("To reset", "In order to reset")))
        self.assertEqual(s.items["recall"], 1.0)
        self.assertAlmostEqual(s.items["precision"], 2 / 3)
        self.assertLess(s.total, 0.8)

    def test_punctuation_only_fix_needs_the_punctuation(self) -> None:
        ex = HELD["ho-suggest-edits-08"]
        noop = reply(chg("password click", "password click"))
        self.assertEqual(score_example(ex, noop).total, 0.0)
        half = score_example(ex, reply(chg("password click", "password, click")))
        self.assertAlmostEqual(half.items["recall"], 0.5)

    def test_meaning_altering_rewording_is_spurious_and_misses_the_fix(self) -> None:
        ex = HELD[
            "ho-suggest-edits-07"
        ]  # real fix: the wordy clause; model reworded two other clauses
        r = reply(
            chg("Data are collected every hour", "Data are collected at regular intervals"),
            chg("stored for thirty days", "stored for a period of thirty days"),
        )
        s = score_example(ex, r)
        self.assertEqual((s.items["recall"], s.items["precision"]), (0.0, 0.0))
        ok = score_example(ex, reply(chg("after that period of time has elapsed", "then")))
        self.assertEqual(ok.total, 1.0)

    def test_document_needing_no_change(self) -> None:
        ex = HELD["ho-suggest-edits-04"]
        self.assertEqual(score_example(ex, reply()).total, 1.0)
        self.assertEqual(
            score_example(ex, reply(chg("customers like it", "customers appreciate it"))).total, 0.0
        )

    def test_ungrounded_change_is_spurious(self) -> None:
        ex = HELD["ho-suggest-edits-01"]
        s = score_example(
            ex, reply(chg("the the", "the"), chg("text that is not in the document", "x"))
        )
        self.assertEqual(s.items["grounded"], 0.5)
        self.assertEqual(s.items["precision"], 0.5)

    def test_apply_is_offset_based_and_skips_overlaps(self) -> None:
        self.assertEqual(_apply("abcdef", [((0, 2), "X"), ((1, 3), "Y"), ((4, 6), "Z")]), "XcdZ")


if __name__ == "__main__":
    unittest.main()
