"""docLM data build, phase 1: filters, error injector, training format, sampling opt-in.

Model-free: fixed strings only, no server, no network. The held-out file is never read here.
"""

from __future__ import annotations

import json
import random
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import build_data as B
import data_filters as F
import data_topics as T
import error_injector as E
import serve_hf
from schema import Example, SchemaError
from scoring import SYSTEM_PROMPTS, parse_reply, score_example

HAVE_DICT = F.DICT_PATH.exists()
CLEAN = (
    "Last year the library opened a second reading room. It is quiet and bright, and many "
    "families visit on weekends. Volunteers collected 240 books because the shelves were nearly "
    "empty. These books are now free for anyone to borrow. Each shelf has a label, and they are "
    "sorted by topic."
)
PASSAGE = (
    "On March 14, 2022, Maya Ortiz opened the Maple Street Library after repairs. About 240 "
    "people came, and 35 percent of them borrowed a book. Staff said the new hours start in "
    "April."
)
TINY_WORDS = (
    "the library opened a second reading room it is quiet and bright many families visit on "
    "weekends volunteers collected books because shelves were nearly empty these are now free "
    "for anyone to borrow each shelf has label they sorted by topic last year"
)
TINY_VOCAB = frozenset(TINY_WORDS.split())


def rng(seed: int) -> random.Random:
    return random.Random(seed)  # noqa: S311 (seeded test data, not security)


def example_from(build: E.EditBuild) -> Example:
    return Example(
        id="t",
        task="suggest_edits",
        split="train",
        source="programmatic",
        input={"document": build.document},
        reference={"changes": build.changes},
        checks={"optional_edits": build.optional} if build.optional else {},
    )


class ServeSamplingTests(unittest.TestCase):
    def test_default_is_greedy_exactly_as_before(self) -> None:
        for req in ({}, {"temperature": 0}, {"temperature": None}, {"temperature": -1}):
            self.assertEqual(serve_hf.generation_kwargs(req), {"do_sample": False})
        self.assertEqual(serve_hf.generation_kwargs({"temperature": "junk"}), {"do_sample": False})

    def test_sampling_is_opt_in(self) -> None:
        kw = serve_hf.generation_kwargs({"temperature": 0.8, "top_p": 0.95, "seed": 3})
        self.assertEqual(kw, {"do_sample": True, "temperature": 0.8, "top_p": 0.95})
        self.assertEqual(serve_hf.generation_kwargs({"temperature": 0.5})["top_p"], 1.0)


class FactTests(unittest.TestCase):
    def test_extract_dates_numbers_names(self) -> None:
        f = F.extract_facts(PASSAGE, frozenset({"on", "about", "staff", "people", "after"}))
        self.assertEqual(f.dates, ("March 14, 2022",))
        self.assertEqual(f.numbers, ("240", "35 percent"))
        self.assertIn("Maya Ortiz", f.names)
        self.assertIn("Maple Street Library", f.names)
        self.assertNotIn("April", " ".join(f.names))  # months are dates, not names

    def test_candidate_filters(self) -> None:
        facts = F.extract_facts(PASSAGE, frozenset({"on", "about", "staff", "people", "after"}))
        good = (
            "Maya Ortiz opened the Maple Street Library on March 14, 2022; 240 people came and "
            "35 percent borrowed a book."
        )
        self.assertTrue(F.candidate_problems(good, PASSAGE, 40, facts).ok)
        cases = {
            "over_word_limit": (good, 10),
            "preamble": ("Here is a summary. " + good, 40),
            "incomplete": (good.rstrip("."), 40),
            "markdown_or_multiline": ("- " + good, 40),
            "missing_key_facts": ("The library reopened and people came.", 40),
            "not_shorter_than_source": (PASSAGE + " More words follow here.", 200),
            "empty": ("   ", 40),
        }
        for reason, (text, limit) in cases.items():
            self.assertIn(
                reason, F.candidate_problems(text, PASSAGE, limit, facts).problems, reason
            )

    def test_truncation_and_strict_limit(self) -> None:
        facts = F.extract_facts("Plain words only here.", frozenset())
        text = "word " * 12 + "end."
        self.assertIn(
            "truncated",
            F.candidate_problems(
                text, "x " * 60, 40, facts, completion_tokens=200, max_tokens=200
            ).problems,
        )
        # 13 words vs limit 12: the scorer would allow 25% grace; gold data must not
        self.assertIn("over_word_limit", F.candidate_problems(text, "x " * 60, 12, facts).problems)

    def test_missing_facts_reported(self) -> None:
        facts = F.extract_facts(PASSAGE, frozenset({"on", "about", "staff", "people", "after"}))
        v = F.candidate_problems("The library reopened on March 14, 2022.", PASSAGE, 40, facts)
        self.assertIn("240", v.missing)
        self.assertNotIn("March 14, 2022", v.missing)

    def test_date_format_variants_match_like_the_scorer(self) -> None:
        facts = F.extract_facts("It opened on March 14, 2022 for everyone.", frozenset({"it"}))
        v = F.candidate_problems("It opened 14 March 2022.", "x " * 40, 40, facts)
        self.assertEqual(v.missing, [])

    def test_reject_table_counts(self) -> None:
        logs = [
            {
                "candidates": [
                    {"problems": ["over_word_limit", "missing_key_facts"]},
                    {"problems": []},
                ]
            },
            {"candidates": [{"problems": ["missing_key_facts"]}, {"problems": ["empty"]}]},
        ]
        t = B.reject_table(logs)
        self.assertEqual((t["candidates"], t["rejected"]), (4, 3))
        self.assertEqual(
            t["primary_reason"], {"over_word_limit": 1, "missing_key_facts": 1, "empty": 1}
        )
        self.assertEqual(t["any_reason_(non-exclusive)"]["missing_key_facts"], 2)
        self.assertEqual(t["passages_with_no_passing_candidate"], 1)


class CleanTextTests(unittest.TestCase):
    def test_flags(self) -> None:
        v = TINY_VOCAB
        self.assertEqual(F.clean_text_problems("The library is quiet.", v), [])
        self.assertIn("doubled_word", F.clean_text_problems("The the library is quiet.", v))
        self.assertIn("unknown_word", F.clean_text_problems("The libary is quiet.", v))
        self.assertIn("markdown_or_list", F.clean_text_problems("The **library** is quiet.", v))
        self.assertIn("incomplete", F.clean_text_problems("The library is quiet", v))
        self.assertIn("preamble", F.clean_text_problems("Sure, the library is quiet.", v))
        self.assertIn("multi_paragraph", F.clean_text_problems("The library.\n\nIs quiet.", v))
        self.assertIn("non_ascii", F.clean_text_problems("The library is quiet — and free.", v))


class InjectorTests(unittest.TestCase):
    def build(self, kinds: list[str], seed: int = 0) -> E.EditBuild:
        for s in range(seed, seed + 40):
            sites = E.plan_sites(CLEAN, kinds, rng(s), TINY_VOCAB)
            b = E.build_edit(CLEAN, sites) if sites else None
            if b:
                return b
        self.fail(f"no build for {kinds}")

    def test_each_kind_round_trips_and_self_scores(self) -> None:
        for kind in ("typo", "agreement", "doubled", "tense", "style"):
            for seed in range(5):
                b = self.build([kind], seed)
                ex = example_from(b)
                v = B.verify_edit(ex, CLEAN)
                self.assertTrue(v["ok"], (kind, seed, v, b.changes))

    def test_typo_is_never_a_dictionary_word(self) -> None:
        for seed in range(20):
            for s in E.find_typos(CLEAN, rng(seed), TINY_VOCAB):
                self.assertNotIn(s.corrupted, TINY_VOCAB)

    def test_original_is_unique_even_for_a_repeated_word(self) -> None:
        clean = "The cat saw the dog. The cat ran home and the dog stayed. The cat slept."
        words = "the cat saw dog ran home and stayed slept"
        vocab = frozenset(words.split())
        for seed in range(10):
            sites = E.plan_sites(clean, ["doubled"], rng(seed), vocab)
            b = E.build_edit(clean, sites)
            self.assertIsNotNone(b)
            c = b.changes[0]
            self.assertEqual(b.document.count(c["original"]), 1)
            self.assertEqual(b.document.find(c["original"]), b.document.find(c["original"]))

    def test_agreement_and_tense_rules(self) -> None:
        sites = E.find_agreement(
            "They are late. It is early. Each shelf has a label.", rng(0), TINY_VOCAB
        )
        pairs = {(s.corrupted) for s in sites}
        self.assertEqual(pairs, {"is", "are", "have"})
        # no site for 'She was' (subjunctive risk) and none in a sentence without a past anchor
        self.assertEqual(E.find_agreement("She was late.", rng(0), TINY_VOCAB), [])
        self.assertEqual(E.find_tense("The shop opened a branch.", rng(0), TINY_VOCAB), [])
        self.assertEqual(E.find_tense("Last year the shop will open.", rng(0), TINY_VOCAB), [])
        t = E.find_tense("Last year the shop opened a branch.", rng(0), TINY_VOCAB)
        self.assertEqual([s.corrupted for s in t], ["will open"])

    def test_style_edit_is_optional_and_marked(self) -> None:
        b = self.build(["typo", "style"])
        self.assertEqual(b.optional, [b.kinds.index("style")])
        ex = example_from(b)
        ex.validate()  # checks.optional_edits indices are valid for the schema
        self.assertEqual(ex.checks["optional_edits"], b.optional)

    def test_skipping_the_optional_edit_is_not_penalised(self) -> None:
        b = self.build(["typo", "style"])
        ex = example_from(b)
        required_only = {"changes": [c for i, c in enumerate(b.changes) if i not in b.optional]}
        self.assertEqual(score_example(ex, json.dumps(required_only)).total, 1.0)

    def test_empty_answer_fails_when_an_edit_is_required(self) -> None:
        ex = example_from(self.build(["typo"]))
        self.assertEqual(score_example(ex, '{"changes": []}').total, 0.0)

    def test_no_edit_example_gold_is_empty_and_scores_one(self) -> None:
        ex = example_from(E.EditBuild(CLEAN, [], [], []))
        ex.validate()
        self.assertEqual(ex.reference, {"changes": []})
        self.assertEqual(score_example(ex, json.dumps(ex.reference)).total, 1.0)
        self.assertEqual(
            score_example(
                ex,
                json.dumps(
                    {
                        "changes": [
                            {
                                "location": "s1",
                                "original": "Last year",
                                "replacement": "Last month",
                                "reason": "r",
                            }
                        ]
                    }
                ),
            ).total,
            0.0,
        )

    def test_overlapping_or_unchanged_sites_are_refused(self) -> None:
        s = E.Site(0, 4, "Last", "typo", "r")  # corrupted equals the clean text
        self.assertIsNone(E.build_edit(CLEAN, [s]))


@unittest.skipUnless(HAVE_DICT, "system word list not present")
class BuildExampleTests(unittest.TestCase):
    def test_every_category_builds_with_the_real_dictionary(self) -> None:
        vocab = F.load_vocab()
        passage = {
            "passage_id": "p0",
            "topic": "t",
            "generation": {},
            "text": CLEAN,
        }
        for cat in ("none", "errors", "optional"):
            built = None
            for seed in range(30):
                built = B.build_edit_example(passage, cat, 1, rng(seed), vocab, "run-x")
                if built:
                    break
            self.assertIsNotNone(built, cat)
            ex, meta = built
            self.assertEqual(ex.source, "programmatic")
            self.assertTrue(meta["filters"]["ok"])
            if cat == "none":
                self.assertEqual(ex.reference, {"changes": []})
            if cat == "optional":
                self.assertEqual(len(ex.checks["optional_edits"]), 1)

    def test_categories_follow_the_30_percent_rule(self) -> None:
        cats = B.edit_categories(30, rng(0))
        self.assertEqual(
            (cats.count("none"), cats.count("optional"), cats.count("errors")), (9, 7, 14)
        )


class TrainingFormatTests(unittest.TestCase):
    def examples(self) -> list[Example]:
        sm = Example(
            id="s",
            task="summarize",
            split="train",
            source="rejection-sampled from Phi-4-mini-instruct, run r",
            input={"document": PASSAGE, "max_words": 40},
            reference={"text": "Maya Ortiz reopened the library on March 14, 2022."},
        )
        return [sm, example_from(E.EditBuild(CLEAN, [], [], []))]

    def test_training_prompt_is_the_evaluation_prompt(self) -> None:
        from scoring import build_messages

        for ex in self.examples():
            msgs = B.training_messages(ex)
            self.assertEqual(msgs[:-1], build_messages(ex))
            self.assertEqual([m["role"] for m in msgs], ["system", "user", "assistant"])

    def test_assistant_turn_parses_like_a_model_reply(self) -> None:
        for ex in self.examples():
            reply = B.training_messages(ex)[-1]["content"]
            parse_reply(ex.task, reply)  # strict JSON for suggest_edits, no code fence
            self.assertFalse(reply.startswith("```"))

    def test_build_scripts_do_not_copy_prompt_text(self) -> None:
        src = "".join(
            (HERE / n).read_text(encoding="utf-8")
            for n in ("build_data.py", "data_filters.py", "data_topics.py", "error_injector.py")
        )
        for task in ("summarize", "suggest_edits"):
            self.assertNotIn(SYSTEM_PROMPTS[task][:40], src)

    def test_schema_rejects_extra_fields_so_metadata_lives_in_a_sidecar(self) -> None:
        d = self.examples()[0].to_dict()
        d["generator"] = {"seed": 1}
        with self.assertRaises(SchemaError):
            Example.from_dict(d)


class TopicTests(unittest.TestCase):
    def test_plan_is_deterministic_and_facts_are_requested_verbatim(self) -> None:
        a, b = T.passage_plan(5, 7), T.passage_plan(5, 7)
        self.assertEqual(a, b)
        topic, genre, spec = a[0]
        prompt = T.passage_prompt(topic, genre, spec)[0]["content"]
        for phrase in spec.phrases():
            self.assertIn(phrase, prompt)
        self.assertNotEqual(T.passage_plan(5, 8), a)


if __name__ == "__main__":
    unittest.main()
