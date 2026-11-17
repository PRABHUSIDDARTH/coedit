#!/usr/bin/env python3
"""docLM data build, phase 1: summarize + suggest_edits. Design: docs/doclm/DATA_BUILD.md.

Generator: ONLY the local base model (Phi-4-mini-instruct) behind scripts/doclm/serve_hf.py, for
(a) source passages and (b) candidate summaries. suggest_edits labels are programmatic (no model).
No training happens here. Output goes OUTSIDE the repo (--out). Training prompts are never built
here: they come from scoring.build_messages, the same function the evaluation uses.

  python3 scripts/doclm/build_data.py --out ~/doclm-data-dryrun --run-id dryrun-20261117-s1 \
      --seed 1 --n-per-type 30 --base-url http://127.0.0.1:8008/v1 --model phi4-mini-base
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_overlap
import data_filters as F
import data_topics as T
import error_injector as E
from schema import STRICT_JSON_TASKS, Example, write_jsonl
from scoring import _apply, _find_span, build_messages, score_example

NAMES = frozenset(n.lower() for n in (*T.FIRST_NAMES, *T.LAST_NAMES))
GEN_NAME = "Phi-4-mini-instruct"
PASSAGE_MAX_TOKENS = 450
SUMMARY_MAX_TOKENS = 200
SUMMARY_TEMPERATURE = 0.8
SUMMARY_TOP_P = 0.95
SAMPLES_PER_PASSAGE = 4
MAX_WORDS_CHOICES = (50, 60, 70)

# --------------------------------------------------------------------------- model client


@dataclass
class Reply:
    text: str
    completion_tokens: int
    seconds: float


class Client:
    """Minimal OpenAI-compatible client for the local serve_hf.py server (loopback only)."""

    def __init__(self, base_url: str, model: str, timeout: float = 300.0) -> None:
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.timeout = timeout

    def chat(self, messages: list[dict[str, str]], max_tokens: int, **sampling: Any) -> Reply:
        body = json.dumps(
            {"model": self.model, "messages": messages, "max_tokens": max_tokens, **sampling}
        ).encode()
        req = urllib.request.Request(  # noqa: S310 (loopback http URL given on the command line)
            self.url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        t0 = time.perf_counter()
        with urllib.request.urlopen(req, timeout=self.timeout) as r:  # noqa: S310
            data = json.loads(r.read())
        dt = time.perf_counter() - t0
        return Reply(
            data["choices"][0]["message"]["content"], int(data["usage"]["completion_tokens"]), dt
        )


# --------------------------------------------------------------------------- training format


def target_text(ex: Example) -> str:
    """The assistant turn: strict JSON for JSON tasks (no fences), plain text otherwise."""
    if ex.task in STRICT_JSON_TASKS:
        return json.dumps(ex.reference, ensure_ascii=False)
    return str((ex.reference or {})["text"])


def training_messages(ex: Example) -> list[dict[str, str]]:
    """EXACTLY the evaluation prompt (scoring.build_messages) plus the gold reply."""
    return [*build_messages(ex), {"role": "assistant", "content": target_text(ex)}]


# --------------------------------------------------------------------------- passages


def generate_passages(
    client: Client,
    n: int,
    seed: int,
    run_id: str,
    vocab: frozenset[str],
    common: frozenset[str],
    names: frozenset[str],
) -> list[dict[str, Any]]:
    """Greedy generation (deterministic given the weights); every passage is logged with its
    filter verdict, kept or not."""
    rows = []
    for i, (topic, genre, spec) in enumerate(T.passage_plan(n, seed)):
        reply = client.chat(T.passage_prompt(topic, genre, spec), PASSAGE_MAX_TOKENS, temperature=0)
        text = F.normalize_quotes(reply.text)
        problems = F.passage_problems(text, spec.phrases(), vocab, common, names)
        if reply.completion_tokens >= PASSAGE_MAX_TOKENS:
            problems.append("truncated")
        rows.append(
            {
                "passage_id": f"{run_id}-p{i:03d}",
                "topic": topic,
                "genre": genre,
                "requested_facts": spec.phrases(),
                "text": text,
                "problems": problems,
                "generation": {
                    "model": GEN_NAME,
                    "decoding": "greedy",
                    "max_new_tokens": PASSAGE_MAX_TOKENS,
                    "seconds": round(reply.seconds, 2),
                    "completion_tokens": reply.completion_tokens,
                },
            }
        )
    return rows


# --------------------------------------------------------------------------- suggest_edits


def sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z\"'])", text.strip()) if s]


def pick_window(text: str, rng: random.Random) -> str | None:
    """3 to 6 consecutive sentences, 40 to 150 words: the 'document' for suggest_edits."""
    sents = sentences(text)
    options = [
        " ".join(sents[a:b])
        for a in range(len(sents))
        for b in range(a + 3, min(len(sents), a + 6) + 1)
        if 40 <= len(" ".join(sents[a:b]).split()) <= 150
    ]
    return rng.choice(options) if options else None


def edit_categories(n: int, rng: random.Random) -> list[str]:
    """~30% none (gold = empty), ~33% of the rest errors+one optional style edit, the rest errors."""
    n_none = round(0.3 * n)
    n_opt = round(0.33 * (n - n_none))
    cats = ["none"] * n_none + ["optional"] * n_opt + ["errors"] * (n - n_none - n_opt)
    rng.shuffle(cats)
    return cats


def build_edit_example(
    passage: dict[str, Any],
    category: str,
    index: int,
    rng: random.Random,
    vocab: frozenset[str],
    run_id: str,
) -> tuple[Example, dict[str, Any]] | None:
    for attempt in range(6):
        clean = pick_window(passage["text"], rng)
        if clean is None or F.clean_text_problems(clean, vocab, NAMES):
            continue
        if category == "none":
            build = E.EditBuild(clean, [], [], [])
        else:
            n_err = rng.choice((1, 2, 2, 3))
            first = rng.randrange(len(E.ERROR_KINDS))
            kinds = [E.ERROR_KINDS[(first + k) % len(E.ERROR_KINDS)] for k in range(n_err)]
            if category == "optional":
                kinds.append("style")
            sites = E.plan_sites(clean, kinds, rng, vocab)
            build = E.build_edit(clean, sites) if sites else None
            if build is None:
                continue
        ex = Example(
            id=f"docllm-train-edit-{index:04d}",
            task="suggest_edits",
            split="train",
            source="programmatic",
            input={"document": build.document},
            reference={"changes": build.changes},
            checks={"optional_edits": build.optional} if build.optional else {},
        )
        verdict = verify_edit(ex, clean)
        if not verdict["ok"]:
            continue
        meta = {
            "id": ex.id,
            "task": ex.task,
            "run_id": run_id,
            "labels": "programmatic (error injection; no model)",
            "category": category,
            "error_kinds": build.kinds,
            "attempts": attempt + 1,
            "input_text_origin": {
                "passage_id": passage["passage_id"],
                "topic": passage["topic"],
                "generator": GEN_NAME,
                "generation": passage["generation"],
            },
            "filters": verdict,
        }
        return ex, meta
    return None


def verify_edit(ex: Example, clean: str) -> dict[str, Any]:
    """Gold-label gates for suggest_edits. All must hold for the example to be kept."""
    doc = ex.input["document"]
    changes = ex.reference["changes"]
    spans = [_find_span(doc, c["original"]) for c in changes]
    grounded = all(sp is not None for sp in spans)
    unique = all(doc.count(c["original"]) == 1 for c in changes)
    round_trip = False
    if grounded:
        items = [(sp, c["replacement"]) for sp, c in zip(spans, changes, strict=True) if sp]
        round_trip = _apply(doc, items) == clean
    self_score = score_example(ex, json.dumps(ex.reference)).total
    required = [i for i in range(len(changes)) if i not in ex.checks.get("optional_edits", [])]
    empty_score = score_example(ex, '{"changes": []}').total
    # empty answer must fail when a required edit exists, and pass when none is needed
    empty_ok = (empty_score == 0.0) if required else (empty_score == 1.0)
    ok = grounded and unique and round_trip and self_score == 1.0 and empty_ok
    return {
        "grounded": grounded,
        "original_unique": unique,
        "round_trip_equals_clean": round_trip,
        "self_score": round(self_score, 4),
        "empty_answer_score": round(empty_score, 4),
        "ok": ok,
    }


# --------------------------------------------------------------------------- summarize


def summarize_example(
    client: Client,
    passage: dict[str, Any],
    index: int,
    seed_index: int,
    seed: int,
    run_id: str,
    rng: random.Random,
    common: frozenset[str],
) -> tuple[Example | None, dict[str, Any]]:
    text = passage["text"]
    facts = F.extract_facts(text, common)
    limits = [m for m in MAX_WORDS_CHOICES if m < 0.75 * len(text.split())]
    max_words = rng.choice(limits or [MAX_WORDS_CHOICES[0]])
    probe = Example(
        id=f"docllm-train-sum-{index:04d}",
        task="summarize",
        split="train",
        source=f"rejection-sampled from {GEN_NAME}, run {run_id}",
        input={"document": text, "max_words": max_words},
        reference=None,
        checks={"must_include": list(facts.all())},
    )
    messages = build_messages(probe)  # the evaluation prompt itself, used to sample candidates
    cands = []
    for k in range(SAMPLES_PER_PASSAGE):
        cseed = seed * 1_000_003 + seed_index * 16 + k
        reply = client.chat(
            messages,
            SUMMARY_MAX_TOKENS,
            temperature=SUMMARY_TEMPERATURE,
            top_p=SUMMARY_TOP_P,
            seed=cseed,
        )
        v = F.candidate_problems(
            reply.text,
            text,
            max_words,
            facts,
            completion_tokens=reply.completion_tokens,
            max_tokens=SUMMARY_MAX_TOKENS,
        )
        cands.append(
            {
                "k": k,
                "seed": cseed,
                "text": reply.text.strip(),
                "words": len(reply.text.split()),
                "completion_tokens": reply.completion_tokens,
                "seconds": round(reply.seconds, 2),
                "problems": v.problems,
                "missing_facts": v.missing,
            }
        )
    passing = [c for c in cands if not c["problems"]]
    log = {
        "passage_id": passage["passage_id"],
        "max_words": max_words,
        "key_facts": list(facts.all()),
        "candidates": cands,
    }
    if not passing:
        return None, log
    chosen = rng.choice(passing)  # deterministic given --seed; not "first" so k=0 is not favoured
    ex = Example(
        id=probe.id,
        task="summarize",
        split="train",
        source=probe.source,
        input=probe.input,
        reference={"text": chosen["text"]},
        checks=probe.checks,
    )
    score = score_example(ex, chosen["text"]).total
    log["chosen_k"] = chosen["k"]
    log["scorer_total"] = round(score, 4)
    if score != 1.0:  # the evaluation's own scorer must give the kept reference full marks
        log["dropped"] = "scorer_total_not_1"
        return None, log
    return ex, log


# --------------------------------------------------------------------------- reporting


def reject_table(logs: list[dict[str, Any]]) -> dict[str, Any]:
    first, anyfail, total = Counter(), Counter(), 0
    for log in logs:
        for c in log["candidates"]:
            total += 1
            for p in c["problems"]:
                anyfail[p] += 1
            if c["problems"]:
                first[c["problems"][0]] += 1
    rejected = sum(first.values())
    return {
        "candidates": total,
        "rejected": rejected,
        "reject_rate": round(rejected / total, 3) if total else None,
        "primary_reason": dict(first),
        "any_reason_(non-exclusive)": dict(anyfail),
        "passages_with_no_passing_candidate": sum(
            all(c["problems"] for c in log["candidates"]) for log in logs
        ),
        "passages": len(logs),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--out", required=True, help="output directory, OUTSIDE the repo")
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--n-per-type", type=int, default=30)
    ap.add_argument("--passages", type=int, default=140, help="passages to generate")
    ap.add_argument("--base-url", default="http://127.0.0.1:8008/v1")
    ap.add_argument("--model", default="phi4-mini-base")
    args = ap.parse_args()
    if args.n_per_type > 30 and "dryrun" in args.run_id:
        print("error: a dry run is capped at 30 examples per type", file=sys.stderr)
        return 2
    out = Path(args.out).expanduser()
    repo = Path(__file__).resolve().parents[2]
    if repo in out.resolve().parents or out.resolve() == repo:
        print("error: --out must be outside the repository", file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)
    vocab, common = F.load_vocab(), F.common_words()
    client = Client(args.base_url, args.model)
    t_start = time.perf_counter()

    passages = generate_passages(
        client, args.passages, args.seed, args.run_id, vocab, common, NAMES
    )
    with (out / "passages.jsonl").open("w", encoding="utf-8") as f:
        for p in passages:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    good = [p for p in passages if not p["problems"]]
    passage_rejects = Counter(r for p in passages for r in p["problems"])

    rng = random.Random(args.seed)  # noqa: S311 (seeded sampling of data, not security)
    n = args.n_per_type
    # one passage feeds one example; the good passages alternate between the two tasks
    sum_pool, edit_pool = good[1::2], good[0::2]  # alternate, so both tasks get a full pool

    # --- suggest_edits (programmatic; no model call)
    # A passage is tried for the next planned category first, then for any other category still
    # needed, so a passage that cannot host (say) an optional style edit is not thrown away.
    remaining = Counter(edit_categories(n, rng))
    plan = [c for c, k in remaining.items() for _ in range(k)]
    rng.shuffle(plan)
    edits: list[tuple[Example, dict[str, Any]]] = []
    for passage in edit_pool:
        if len(edits) >= n:
            break
        first = plan[len(edits)]
        for cat in [first, *(c for c in sorted(remaining) if c != first)]:
            if remaining[cat] <= 0:
                continue
            built = build_edit_example(passage, cat, len(edits) + 1, rng, vocab, args.run_id)
            if built:
                edits.append(built)
                remaining[cat] -= 1
                break

    # --- summarize (rejection sampling from the base model)
    sums: list[tuple[Example, dict[str, Any]]] = []
    sum_logs: list[dict[str, Any]] = []
    for passage in sum_pool:
        if len(sums) >= n:
            break
        facts = F.extract_facts(passage["text"], common)
        ex, log = summarize_example(
            client, passage, len(sums) + 1, len(sum_logs), args.seed, args.run_id, rng, common
        )
        log["topic"] = passage["topic"]
        sum_logs.append(log)
        if ex is not None:
            ex_meta = {
                "id": ex.id,
                "task": ex.task,
                "run_id": args.run_id,
                "labels": f"rejection-sampled from {GEN_NAME}",
                "generator": {
                    "model": GEN_NAME,
                    "decoding": "sampling",
                    "temperature": SUMMARY_TEMPERATURE,
                    "top_p": SUMMARY_TOP_P,
                    "max_new_tokens": SUMMARY_MAX_TOKENS,
                    "samples_per_passage": SAMPLES_PER_PASSAGE,
                    "seed": log["candidates"][log["chosen_k"]]["seed"],
                    "base_seed": args.seed,
                },
                "input_text_origin": {
                    "passage_id": passage["passage_id"],
                    "topic": passage["topic"],
                    "generator": GEN_NAME,
                    "generation": passage["generation"],
                },
                "key_facts": list(facts.all()),
                "filters": {
                    "chosen_k": log["chosen_k"],
                    "candidates": [
                        {k: c[k] for k in ("k", "seed", "words", "problems", "missing_facts")}
                        for c in log["candidates"]
                    ],
                    "scorer_total": log["scorer_total"],
                },
            }
            sums.append((ex, ex_meta))
    gen_seconds = time.perf_counter() - t_start

    examples = [e for e, _ in sums] + [e for e, _ in edits]
    metas = [m for _, m in sums] + [m for _, m in edits]
    check_overlap.assert_no_overlap(examples)  # raises before anything is written to train.*
    write_jsonl(out / "train.dryrun.jsonl", examples)
    with (out / "train.dryrun.meta.jsonl").open("w", encoding="utf-8") as f:
        for m in metas:
            f.write(json.dumps(m, ensure_ascii=False, sort_keys=True) + "\n")
    with (out / "train.dryrun.chat.jsonl").open("w", encoding="utf-8") as f:
        for e in examples:
            f.write(json.dumps({"id": e.id, "messages": training_messages(e)}, ensure_ascii=False))
            f.write("\n")
    with (out / "summarize.candidates.jsonl").open("w", encoding="utf-8") as f:
        for log in sum_logs:
            f.write(json.dumps(log, ensure_ascii=False) + "\n")
    calls = [p["generation"]["seconds"] for p in passages] + [
        c["seconds"] for log in sum_logs for c in log["candidates"]
    ]
    report = {
        "run_id": args.run_id,
        "seed": args.seed,
        "kept": {"summarize": len(sums), "suggest_edits": len(edits)},
        "passages": {
            "generated": len(passages),
            "kept": len(good),
            "reject_reasons_(non-exclusive)": dict(passage_rejects),
            "used_for_summarize": len(sum_logs),
            "pool_for_suggest_edits": len(edit_pool),
        },
        "summarize_rejects": reject_table(sum_logs),
        "suggest_edits": {
            "categories": dict(Counter(m["category"] for _, m in edits)),
            "error_kinds": dict(Counter(k for _, m in edits for k in m["error_kinds"])),
            "pool_passages_used_or_skipped": len(edit_pool),
        },
        "timing_seconds": {
            "total_generation_wall": round(gen_seconds, 1),
            "model_calls": len(calls),
            "mean_per_call": round(sum(calls) / len(calls), 2) if calls else None,
            "per_kept_example": round(gen_seconds / max(1, len(examples)), 2),
        },
    }
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
