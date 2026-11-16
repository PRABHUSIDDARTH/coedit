"""Overlap guard tests, including planted duplicates."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import check_overlap as co  # noqa: E402
from schema import Example, read_jsonl, write_jsonl  # noqa: E402

HELD = read_jsonl(co.default_heldout())
SEED = read_jsonl(HERE / "data" / "seed.jsonl")


def by_id(i: str) -> Example:
    return next(e for e in HELD if e.id == i)


def as_train(held: Example, **changes) -> Example:
    d = copy.deepcopy(held.to_dict())
    d.update(id="train-planted-1", split="train", source="test-planted")
    for k, v in changes.items():
        d[k] = v
    return Example.from_dict(d)


def with_input(ex: Example, key: str, value: str) -> Example:
    d = copy.deepcopy(ex.to_dict())
    d["id"], d["split"], d["source"] = "train-planted-1", "train", "test-planted"
    d["input"][key] = value
    return Example.from_dict(d)


class OverlapTests(unittest.TestCase):
    def test_clean_seed_vs_heldout(self) -> None:
        self.assertEqual(co.find_overlaps(SEED, HELD), [])

    def test_exact_duplicate_is_caught(self) -> None:
        hits = co.find_overlaps([as_train(by_id("ho-summarize-01"))], HELD)
        self.assertTrue(any(h.kind == "exact" and h.heldout_id == "ho-summarize-01" for h in hits))

    def test_case_and_whitespace_variant_is_caught(self) -> None:
        src = by_id("ho-summarize-01")
        mangled = "  " + src.input["document"].upper().replace(" ", "   ") + "\n\n"
        hits = co.find_overlaps([with_input(src, "document", mangled)], HELD)
        self.assertTrue(any(h.kind == "normalized" for h in hits), hits)

    def test_near_duplicate_with_edited_words_is_caught(self) -> None:
        src = by_id("ho-summarize-02")
        doc = src.input["document"].replace("command palette", "quick launcher").replace("Windows 7", "Vista")
        hits = co.find_overlaps([with_input(src, "document", doc)], HELD)
        self.assertTrue(any(h.kind == "ngram" and h.score >= co.THRESHOLD for h in hits), hits)

    def test_heldout_embedded_in_longer_training_text_is_caught(self) -> None:
        src = by_id("ho-summarize-03")
        longer = "Unrelated opening sentence about gardens. " + src.input["document"] + " Unrelated closing."
        self.assertTrue(co.find_overlaps([with_input(src, "document", longer)], HELD))

    def test_heldout_reference_leaking_into_training_target_is_caught(self) -> None:
        src = by_id("ho-agents-md-01")
        d = copy.deepcopy(src.to_dict())
        d.update(id="train-planted-1", split="train", source="test-planted")
        d["input"] = {"brief": "A completely different brief about a cooking website in PHP 8."}
        hits = co.find_overlaps([Example.from_dict(d)], HELD)
        self.assertTrue(any(h.field.startswith("reference") for h in hits), hits)

    def test_unrelated_text_and_shared_rubric_are_not_flagged(self) -> None:
        src = by_id("ho-critique-01")  # shares its rubric with many tasks
        d = copy.deepcopy(src.to_dict())
        d.update(id="train-clean-1", split="train", source="test-clean", reference=None)
        d["input"]["document"] = "Quarterly shipping volume climbed because the new warehouse opened in Leeds."
        self.assertEqual(co.find_overlaps([Example.from_dict(d)], HELD), [])

    def test_threshold_is_a_real_boundary(self) -> None:
        src = by_id("ho-summarize-01")
        words = src.input["document"].split()
        keep = len(words) // 2  # keeps ~half the words, then pads with unrelated filler
        partial = " ".join(words[:keep]) + " " + " ".join(f"filler{i}" for i in range(40))
        t = with_input(src, "document", partial)
        flagged_low = co.find_overlaps([t], HELD, threshold=0.2)
        flagged_high = co.find_overlaps([t], HELD, threshold=0.95)
        self.assertTrue(flagged_low)
        self.assertEqual([h for h in flagged_high if h.kind == "ngram"], [])

    def test_heldout_split_record_in_training_data_is_flagged(self) -> None:
        self.assertTrue(co.find_overlaps([HELD[0]], HELD))

    def test_assert_no_overlap_raises_without_echoing_text(self) -> None:
        planted = as_train(by_id("ho-summarize-01"))
        with self.assertRaises(co.OverlapError) as cm:
            co.assert_no_overlap([planted], HELD)
        self.assertNotIn(planted.input["document"][:30], str(cm.exception))

    def test_cli_exit_codes(self) -> None:
        run = lambda *a: subprocess.run(  # noqa: E731
            [sys.executable, str(HERE / "check_overlap.py"), *a], capture_output=True, text=True
        )
        with tempfile.TemporaryDirectory() as d:
            clean, dirty = Path(d, "clean.jsonl"), Path(d, "dirty.jsonl")
            write_jsonl(clean, SEED)
            write_jsonl(dirty, [as_train(by_id("ho-rewrite-01"))])
            self.assertEqual(run("--train", str(clean)).returncode, 0)
            r = run("--train", str(dirty))
            self.assertEqual(r.returncode, 1)
            self.assertNotIn("legal", r.stdout)  # no example text in reports
            self.assertEqual(run("--train", str(Path(d, "missing.jsonl"))).returncode, 2)
            self.assertEqual(run("--train", str(co.default_heldout())).returncode, 2)


if __name__ == "__main__":
    unittest.main()
