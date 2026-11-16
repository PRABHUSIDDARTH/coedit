"""must_say_unknown: applies only to tasks that declare it."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from schema import Example, read_jsonl
from scoring import score_example

HELD = {e.id: e for e in read_jsonl(HERE / "data" / "heldout.draft.jsonl")}

INVENTED = """# AGENTS.md

## Stack
- Django 5
- PostgreSQL 16

## Commands
- `python manage.py runserver`
- `pytest`

## Conventions
- Commit migrations.
- Do not put secrets in settings.py; use environment variables instead.

## Definition of Done
- Code is written and follows the project's coding standards.
- All tests pass with `pytest`.
"""
HONEST = (
    INVENTED.split("## Definition of Done")[0]
    + "## Definition of Done\nNot specified in the brief.\n"
)


class UnknownFieldTests(unittest.TestCase):
    def test_invented_section_fails_only_where_declared(self) -> None:
        ex = HELD["ho-agents-md-02"]
        self.assertEqual(ex.checks["must_say_unknown"], ["Definition of done"])
        s = score_example(ex, INVENTED)
        self.assertEqual(s.items["unknown_fields"], 0.0)
        self.assertEqual(s.total, 0.0)
        self.assertEqual(score_example(ex, HONEST).total, 1.0)
        # a task that does NOT declare the field gets no such penalty
        d = ex.to_dict()
        d["checks"].pop("must_say_unknown")
        undeclared = Example.from_dict(d)
        self.assertNotIn("unknown_fields", score_example(undeclared, INVENTED).items)
        self.assertEqual(score_example(undeclared, INVENTED).total, 1.0)

    def test_missing_section_counts_as_not_saying_unknown(self) -> None:
        ex = HELD["ho-agents-md-02"]
        s = score_example(ex, INVENTED.split("## Definition of Done")[0])
        self.assertEqual(s.items["unknown_fields"], 0.0)

    def test_declared_tasks_references_pass(self) -> None:
        for i in ("ho-agents-md-02", "ho-agents-md-03", "ho-agents-md-06", "ho-agents-md-07"):
            self.assertEqual(score_example(HELD[i], HELD[i].reference["text"]).total, 1.0, i)
        self.assertTrue(json.dumps(HELD["ho-agents-md-01"].checks).count("must_say_unknown") == 0)


if __name__ == "__main__":
    unittest.main()
