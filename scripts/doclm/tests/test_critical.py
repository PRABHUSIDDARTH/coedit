"""checks.critical (hard gate), checks.must_include_raw (raw substring) and the extra unknown markers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from schema import Example, SchemaError, read_jsonl
from scoring import UNKNOWN_MARKERS, score_example

HELD = {e.id: e for e in read_jsonl(HERE / "data" / "heldout.draft.jsonl")}
NEW_MARKERS = ("not defined", "not mentioned", "unspecified", "to be determined", "not given")


def make(task: str, inp: dict, checks: dict, ref: dict) -> Example:
    return Example.from_dict(
        {
            "id": "t-1",
            "task": task,
            "split": "seed",
            "source": "unit-test",
            "input": inp,
            "reference": ref,
            "checks": checks,
        }
    )


RW_IN = {"passage": "It takes ten minutes.", "rubric": [{"id": "a", "description": "plain"}]}
RW_REF = {"text": "Setup is quick."}
AG_REF = {"text": "x"}


def rewrite(checks: dict) -> Example:
    return make("rewrite", RW_IN, checks, RW_REF)


def agents(checks: dict) -> Example:
    return make("agents_md", {"brief": "Go app."}, checks, AG_REF)


class CriticalTests(unittest.TestCase):
    def test_critical_miss_scores_zero_even_when_everything_else_passes(self) -> None:
        ex = rewrite({"critical": ["alpha", "beta"], "must_include": ["gamma"]})
        s = score_example(ex, "Alpha and gamma are here.")
        self.assertEqual(s.items["critical"], 0.0)
        self.assertEqual(s.total, 0.0)

    def test_critical_all_present_scores_one(self) -> None:
        ex = rewrite({"critical": ["alpha", "beta"]})
        self.assertEqual(score_example(ex, "Alpha, then beta.").total, 1.0)

    def test_critical_accepts_alternatives(self) -> None:
        ex = rewrite({"critical": [["business days", "working days"]]})
        self.assertEqual(score_example(ex, "Within seven working days.").total, 1.0)
        self.assertEqual(score_example(ex, "Within seven calendar days.").total, 0.0)

    def test_critical_uses_the_normaliser(self) -> None:
        ex = rewrite({"critical": ["10 minutes"]})
        self.assertEqual(score_example(ex, "Done in ten-minute setup.").total, 1.0)

    def test_critical_does_not_dilute_the_form_mean(self) -> None:
        plain = rewrite({"must_include": ["alpha"]})
        gated = rewrite({"critical": ["alpha"]})
        reply = "Sure, alpha."  # preamble: no_preamble fails
        self.assertEqual(score_example(plain, reply).total, score_example(gated, reply).total)

    def test_critical_is_a_hard_item(self) -> None:
        ex = agents({"critical": ["alpha"]})
        s = score_example(ex, "# Stack\nnone\n")
        self.assertEqual(s.items["critical"], 0.0)
        self.assertEqual(s.total, 0.0)

    def test_schema_accepts_new_keys_and_rejects_bad_entries(self) -> None:
        rewrite({"critical": [["a", "b"], "c"], "must_include_raw": ["x"]})
        with self.assertRaises(SchemaError):
            rewrite({"critical": [""]})
        with self.assertRaises(SchemaError):
            rewrite({"must_include_raw": [["a"]]})  # raw entries are plain strings
        with self.assertRaises(SchemaError):
            rewrite({"nonsense": ["a"]})


class RawTests(unittest.TestCase):
    # rewrite task: no section requirement, so only the raw check decides the score
    def test_raw_distinguishes_a_narrower_command(self) -> None:
        ex = rewrite({"must_include_raw": ["go build ./..."]})
        self.assertEqual(score_example(ex, "Build with `go build ./...`.").total, 1.0)
        for bad in ("`go build ./cmd/...`", "`go build`", "`go build -o x ./cmd/w`"):
            self.assertEqual(score_example(ex, f"Build with {bad}.").total, 0.0, bad)

    def test_raw_is_case_folded_and_whitespace_collapsed(self) -> None:
        ex = rewrite({"must_include_raw": ["go build ./..."]})
        self.assertEqual(score_example(ex, "Run GO   BUILD\n./... now.").total, 1.0)

    def test_raw_does_not_normalise_numbers_or_plurals(self) -> None:
        ex = rewrite({"must_include_raw": ["retries 3"]})
        self.assertEqual(score_example(ex, "Use retries 3.").total, 1.0)
        self.assertEqual(score_example(ex, "Use retries three.").total, 0.0)

    def test_all_raw_entries_are_required(self) -> None:
        ex = rewrite({"must_include_raw": ["go build ./...", "go test ./..."]})
        self.assertEqual(score_example(ex, "Only go build ./... here.").total, 0.0)
        self.assertEqual(score_example(ex, "go build ./... and go test ./... both.").total, 1.0)


class MarkerTests(unittest.TestCase):
    def test_each_new_marker_is_registered(self) -> None:
        for m in NEW_MARKERS:
            self.assertIn(m, UNKNOWN_MARKERS)

    def test_each_new_marker_passes_must_say_unknown(self) -> None:
        ex = HELD["ho-agents-md-02"]
        base = ex.reference["text"].split("## Definition of done")[0]
        for m in NEW_MARKERS:
            reply = base + f"## Definition of done\n{m.capitalize()} in the brief.\n"
            self.assertEqual(score_example(ex, reply).items["unknown_fields"], 1.0, m)

    def test_invented_done_is_still_penalised(self) -> None:
        ex = HELD["ho-agents-md-02"]
        base = ex.reference["text"].split("## Definition of done")[0]
        s = score_example(ex, base + "## Definition of done\nAll tests pass.\n")
        self.assertEqual(s.items["unknown_fields"], 0.5)


class HeldoutGoldTests(unittest.TestCase):
    def test_batch4_tasks_declare_gates_and_gold_scores_one(self) -> None:
        for i in (
            "ho-rewrite-07",
            "ho-rewrite-08",
            "ho-rewrite-09",
            "ho-agents-md-01",
            "ho-agents-md-02",
        ):
            ex = HELD[i]
            self.assertIn("critical", ex.checks, i)
            self.assertAlmostEqual(score_example(ex, ex.reference["text"]).total, 1.0, msg=i)

    def test_cmd_variant_fails_agents_md_01(self) -> None:
        ex = HELD["ho-agents-md-01"]
        bad = ex.reference["text"].replace("go build ./...", "go build ./cmd/...")
        self.assertEqual(score_example(ex, bad).total, 0.0)


if __name__ == "__main__":
    unittest.main()
