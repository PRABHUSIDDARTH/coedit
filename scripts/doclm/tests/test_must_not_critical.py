"""checks.must_not_critical: a hard gate; any listed phrase (or alternative) in the reply gives 0."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from schema import Example, SchemaError
from scoring import score_example

INP = {"passage": "It takes ten minutes.", "rubric": [{"id": "a", "description": "plain"}]}
REF = {"text": "Setup is quick."}


def rewrite(checks: dict) -> Example:
    return Example.from_dict(
        {
            "id": "t-1",
            "task": "rewrite",
            "split": "seed",
            "source": "unit-test",
            "input": INP,
            "reference": REF,
            "checks": checks,
        }
    )


class MustNotCriticalTests(unittest.TestCase):
    def test_clean_reply_passes(self) -> None:
        ex = rewrite({"must_not_critical": ["utilize"]})
        self.assertEqual(score_example(ex, "Setup is quick.").total, 1.0)

    def test_hit_zeroes_the_example(self) -> None:
        ex = rewrite({"must_not_critical": ["utilize"]})
        s = score_example(ex, "You can utilize it fast.")
        self.assertEqual(s.items["must_not_critical"], 0.0)
        self.assertEqual(s.total, 0.0)

    def test_alternative_list_any_hit(self) -> None:
        ex = rewrite({"must_not_critical": [["utilize", "utilising"], "2026"]})
        self.assertEqual(score_example(ex, "Utilising it is quick.").total, 0.0)
        self.assertEqual(score_example(ex, "Ready by 2026.").total, 0.0)
        self.assertEqual(score_example(ex, "Setup is quick.").total, 1.0)

    def test_ungated_ignores_it(self) -> None:
        ex = rewrite({"must_not_critical": ["utilize"]})
        s = score_example(ex, "You can utilize it fast.")
        self.assertEqual(s.total, 0.0)
        self.assertGreater(s.ungated, 0.0)

    def test_not_in_form_mean_when_passing(self) -> None:
        a = score_example(rewrite({}), "Setup is quick.").total
        b = score_example(rewrite({"must_not_critical": ["zzz"]}), "Setup is quick.").total
        self.assertEqual(a, b)

    def test_schema_entries(self) -> None:
        rewrite({"must_not_critical": ["a", ["b", "c"]]})
        with self.assertRaises(SchemaError):
            rewrite({"must_not_critical": [[]]})
        with self.assertRaises(SchemaError):
            rewrite({"must_not_critical": [3]})
