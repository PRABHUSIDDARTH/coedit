"""A single outer code fence is recorded as a metric and never changes a prose score."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import make_seed_data  # noqa: E402
from scoring import score_example, strip_outer_fence, summarize_scores  # noqa: E402

SEED = {e.id: e for e in make_seed_data.build()}


class FenceTests(unittest.TestCase):
    def test_strip_outer_fence(self) -> None:
        self.assertEqual(strip_outer_fence("```markdown\n# A\n```"), ("# A", True))
        self.assertEqual(strip_outer_fence("  ```\nx\n```  \n"), ("x", True))
        inner = "```markdown\n# A\n```bash\nls\n```\n```"
        self.assertEqual(strip_outer_fence(inner), ("# A\n```bash\nls\n```", True))
        for plain in ("# A\n```bash\nls\n```", "no fence", "```", "```\nunclosed"):
            self.assertFalse(strip_outer_fence(plain)[1], plain)

    def test_prose_score_is_identical_with_and_without_fence(self) -> None:
        for i in ("seed-agents-md-01", "seed-architecture-md-01", "seed-rewrite-01", "seed-summarize-01"):
            ex = SEED[i]
            text = ex.reference["text"]
            plain, fenced = score_example(ex, text), score_example(ex, f"```markdown\n{text}\n```")
            self.assertEqual((plain.total, plain.items), (fenced.total, fenced.items), i)
            self.assertEqual((plain.fenced, fenced.fenced), (False, True))

    def test_json_stays_strict_but_lenient_metric_is_recorded(self) -> None:
        ex = SEED["seed-critique-01"]
        ref = json.dumps(ex.reference)
        s = score_example(ex, f"```json\n{ref}\n```")
        self.assertTrue(s.fenced)
        self.assertIs(s.json_valid, False)  # strict, as before
        self.assertIs(s.json_valid_lenient, True)
        self.assertEqual(s.total, 0.0)
        plain = score_example(ex, ref)
        self.assertEqual((plain.fenced, plain.json_valid, plain.json_valid_lenient), (False, True, True))

    def test_summary_reports_fenced_rate(self) -> None:
        ex = SEED["seed-agents-md-01"]
        t = ex.reference["text"]
        row = summarize_scores([score_example(ex, t), score_example(ex, f"```\n{t}\n```")])["agents_md"]
        self.assertEqual(row["fenced_rate"], 0.5)


if __name__ == "__main__":
    unittest.main()
