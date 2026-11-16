#!/usr/bin/env python3
"""Write 10 hand-written SEED examples (split="seed") so the pipeline can be tested offline.

These are for plumbing tests only. They are NOT held-out data and NOT meant for training.
Authored by hand for this repo; no model output was used. No network, no downloads.

    python3 scripts/doclm/make_seed_data.py [--out scripts/doclm/data/seed.jsonl]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_overlap import assert_no_overlap, default_heldout  # noqa: E402
from schema import Example, write_jsonl  # noqa: E402

SRC = "seed-handwritten (pipeline test only)"
RUBRIC_PROSE = [
    {"id": "clarity", "description": "Each sentence says one clear thing.", "max_score": 5},
    {"id": "concision", "description": "No filler or repeated points.", "max_score": 5},
    {"id": "evidence", "description": "Claims are backed by a number or example.", "max_score": 5},
]
RUBRIC_PLAIN = [
    {"id": "plain_language", "description": "No jargon a new customer would not know."},
    {"id": "brevity", "description": "Under 40 words."},
]


def _critique(n, doc, scores, why):
    return Example(
        id=f"seed-critique-{n:02d}", task="critique", split="seed", source=SRC,
        input={"document": doc, "rubric": RUBRIC_PROSE},
        reference={"scores": scores, "rationale": why},
    )


def _text(task, n, inp, text, checks=None):
    return Example(
        id=f"seed-{task.replace('_', '-')}-{n:02d}", task=task, split="seed", source=SRC,
        input=inp, reference={"text": text}, checks=checks or {},
    )


def build() -> list[Example]:
    ex: list[Example] = []
    ex.append(_critique(
        1,
        "Our new export feature is really very fast. It is fast because we made it fast. "
        "Users will love how fast it is.",
        {"clarity": 3, "concision": 1, "evidence": 0},
        "Repeats one claim three times, gives no measurement, and the reasoning is circular.",
    ))
    ex.append(_critique(
        2,
        "Exporting a 10,000-row sheet now takes 1.2 seconds, down from 9 seconds, because the "
        "CSV is built in one pass instead of one request per row.",
        {"clarity": 5, "concision": 4, "evidence": 5},
        "States a measured before and after number and the cause in one sentence.",
    ))
    ex.append(_text(
        "rewrite", 1,
        {"passage": "We will leverage our synergy-driven refund workflow to action customer "
                    "reimbursement requests within a five-business-day window.",
         "rubric": RUBRIC_PLAIN},
        "We refund customers within five business days of their request.",
        {"must_include": ["refund", "five business days"], "must_not_include": ["synergy"]},
    ))
    ex.append(_text(
        "rewrite", 2,
        {"passage": "Per our earlier correspondence, the aforementioned deadline has been "
                    "subject to a postponement of one week.",
         "rubric": RUBRIC_PLAIN},
        "The deadline has moved back one week.",
        {"must_include": ["one week"], "must_not_include": ["aforementioned"]},
    ))
    ex.append(_text(
        "agents_md", 1,
        {"brief": "Small notes API. Python 3.12, FastAPI, SQLite. Run with `uvicorn app:app`. "
                  "Tests with `pytest -q`. Rule: every route needs a test. Done means tests pass."},
        "# AGENTS.md\n\n## Stack\nPython 3.12, FastAPI, SQLite.\n\n## Commands\n"
        "- Run: `uvicorn app:app`\n- Test: `pytest -q`\n\n## Conventions\n"
        "- Every route has a test.\n\n## Definition of done\nTests pass.\n",
        {"must_include": ["uvicorn app:app", "pytest -q", "FastAPI"]},
    ))
    ex.append(_text(
        "agents_md", 2,
        {"brief": "Static site built with Eleventy and Node 22. Build: `npm run build`. "
                  "No tests yet. Never edit files under `dist/`."},
        "# AGENTS.md\n\n## Stack\nEleventy, Node 22.\n\n## Commands\n- Build: `npm run build`\n"
        "- Test: unknown (no tests yet)\n\n## Conventions\n- Never edit files under `dist/`.\n\n"
        "## Definition of done\nunknown\n",
        {"must_include": ["npm run build", "dist/"], "must_say_unknown": ["Definition of done"]},
    ))
    ex.append(_text(
        "architecture_md", 1,
        {"brief": "A web form posts to an API, the API writes to Postgres, and a worker emails a "
                  "receipt. We chose Postgres over SQLite for concurrent writers. Risk: the email "
                  "provider may be down, so the worker retries."},
        "# ARCHITECTURE.md\n\n## Overview\nForm to API to Postgres, with an email worker.\n\n"
        "## Components\n- Web form\n- API\n- Postgres\n- Email worker\n\n## Data flow\n"
        "The form posts to the API, which writes to Postgres. The worker sends a receipt.\n\n"
        "## Decisions\nPostgres over SQLite for concurrent writers.\n\n## Risks\n"
        "The email provider may be down; the worker retries.\n",
        {"must_include": ["Postgres", "retries"]},
    ))
    doc1 = ("The library closed on Monday for repairs to the roof. Staff expect to reopen on "
            "Friday if the weather holds. Borrowers do not need to return books until the "
            "library reopens, and late fees are paused for the whole week.")
    ex.append(_text(
        "summarize", 1, {"document": doc1, "max_words": 25},
        "The library is closed until about Friday for roof repairs; returns and late fees are "
        "paused meanwhile.",
        {"must_include": ["Friday", "late fees"]},
    ))
    doc2 = ("Quarterly revenue rose 12 percent to 4.1 million dollars, driven mostly by "
            "annual plan renewals. Support costs also rose, by 3 percent, but stayed below "
            "5 percent of revenue. The team plans to hire two engineers next quarter.")
    ex.append(_text(
        "summarize", 2, {"document": doc2, "max_words": 30},
        "Revenue grew 12 percent to 4.1 million dollars on renewals; support costs rose 3 "
        "percent. Two engineers will be hired next quarter.",
        {"must_include": ["12 percent", "two engineers"]},
    ))
    doc3 = "Please send the the invoice by Friday. We will not be able to accept late payments."
    ex.append(Example(
        id="seed-suggest-edits-01", task="suggest_edits", split="seed", source=SRC,
        input={"document": doc3},
        reference={"changes": [
            {"location": "sentence 1", "original": "the the invoice", "replacement": "the invoice",
             "reason": "Repeated word."},
        ]},
        checks={"must_include": ["the invoice"]},
    ))
    return ex


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(Path(__file__).parent / "data" / "seed.jsonl"))
    args = ap.parse_args()
    ex = build()
    try:  # every data-build step must check for held-out overlap BEFORE writing
        default_heldout()
    except Exception:  # noqa: BLE001 - no held-out file yet: nothing to compare against
        pass
    else:
        assert_no_overlap(ex)
    n = write_jsonl(args.out, ex)
    print(json.dumps({"wrote": n, "path": args.out, "split": "seed"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
