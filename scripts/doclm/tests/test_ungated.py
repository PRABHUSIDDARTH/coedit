"""`Score.ungated` ignores the critical / no_real_change gates; `total` is unchanged."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from eval_runner import render_table
from schema import Example
from scoring import score_example, summarize_scores

DOC = {"document": "alpha beta gamma delta epsilon zeta eta theta.", "max_words": 10}


def ex(checks: dict) -> Example:
    return Example.from_dict(
        {
            "id": "t-1",
            "task": "summarize",
            "split": "seed",
            "source": "unit-test",
            "input": DOC,
            "reference": {"text": "alpha beta."},
            "checks": checks,
        }
    )


class UngatedTests(unittest.TestCase):
    def test_critical_miss_zeroes_total_but_not_ungated(self) -> None:
        s = score_example(ex({"critical": ["beta"]}), "Alpha gamma.")
        self.assertEqual(s.total, 0.0)
        self.assertEqual(s.ungated, 1.0)

    def test_equal_when_no_gate_fires(self) -> None:
        s = score_example(ex({"critical": ["alpha"], "must_include": ["alpha", "beta"]}), "Alpha.")
        self.assertEqual(s.ungated, s.total)
        self.assertEqual(s.total, 0.5)

    def test_other_hard_items_still_zero_ungated(self) -> None:
        # a reply that is cut off mid-sentence fails `complete` (hard): ungated must stay 0
        s = score_example(ex({"critical": ["beta"]}), "Alpha gamma")
        self.assertEqual(s.total, 0.0)
        self.assertEqual(s.ungated, 0.0)

    def test_ungated_never_below_total(self) -> None:
        for reply in ("Alpha beta.", "Alpha.", "Zeta.", ""):
            s = score_example(ex({"critical": ["beta"], "must_include": ["alpha"]}), reply)
            self.assertGreaterEqual(s.ungated, s.total)

    def test_summary_and_table_report_both_numbers(self) -> None:
        scores = [
            score_example(ex({"critical": ["beta"]}), "Alpha gamma."),
            score_example(ex({"critical": ["beta"]}), "Alpha beta."),
        ]
        row = summarize_scores(scores)["summarize"]
        self.assertEqual((row["mean"], row["mean_ungated"], row["gated_zero"]), (0.5, 1.0, 1))
        table = render_table("x", summarize_scores(scores))
        self.assertIn("ungated mean", table)
        self.assertIn("| summarize | 2 | 0.500 | 1.000 | 1 |", table)

    def test_gated_zero_ids_lists_only_gate_zeros(self) -> None:
        gated = score_example(ex({"critical": ["beta"]}), "Alpha gamma.")
        plain = score_example(ex({"critical": ["beta"]}), "Alpha gamma")  # cut off: genuine zero
        self.assertTrue(gated.total == 0.0 < gated.ungated)
        self.assertFalse(plain.total == 0.0 < plain.ungated)


if __name__ == "__main__":
    unittest.main()
