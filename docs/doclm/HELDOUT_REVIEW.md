# Held-out set: review and freeze

File: `scripts/doclm/data/heldout.draft.jsonl` (50 tasks: 9 critique, 9 rewrite, 8 each of agents_md, architecture_md, summarize, suggest_edits).

**Provenance:** drafted by Claude in one pass and not yet reviewed by a human. That is acceptable for evaluation only. It must never be used for training, and Claude-written text must never go into docLM's training data either (see PLAN section 4).

## What to check (about 30-45 minutes)
1. **Reference answers are what you would accept.** Especially the 9 critique score vectors: they are one person's judgment, and `score_closeness` measures distance to them.
2. **`checks.must_include` / `must_not_include` are fair.** A correct answer phrased differently must not fail. Loosen any check that is too literal (for example exact numbers or phrases).
3. **Coverage.** The tasks are short (20-90 words) and plain English. Add harder, longer, messier cases if you want a tougher test; keep exactly 50.
4. **Self-consistency.** All 50 references already score 1.0 under `scoring.py` and none overlap the 10 seed examples (checked by script).

## Freeze
After you have reviewed (and edited, if needed) `heldout.draft.jsonl`:
```bash
python3 scripts/doclm/freeze_heldout.py
git add -f scripts/doclm/data/heldout.v1.jsonl scripts/doclm/data/heldout.v1.jsonl.sha256 docs/doclm/HELDOUT_HASH.txt
git commit -m "doclm: freeze held-out v1"
```
It validates the set (50 tasks, at least 8 per type), copies it to `heldout.v1.jsonl` (read-only), writes the sha256 to
`docs/doclm/HELDOUT_HASH.txt` and a bare-hash sidecar that `eval_runner.py` checks before every real run. It refuses to
overwrite an existing v1. Not run yet. After freezing, do not edit the draft either; a change means `v2` plus a new baseline.
Every data-build step must run `scripts/doclm/check_overlap.py` (the guard that keeps training data away from this set).

## Known limits
- Scoring is structural plus reference-based, so it rewards literal agreement. Hand-read 10 outputs per model.
- With 8-9 tasks per type, one task is 11-12 points of a row: treat small deltas as noise.

## The 15 tasks I am least sure about (review these first)

These are my guesses from reading the tasks. **No model has run on them yet**, so "too easy" is unmeasured.

| # | Task | Why I am unsure |
|---|---|---|
| 1 | `ho-critique-09` | Mid-range reference scores (3/3/1) are where two reviewers disagree most; `score_closeness` punishes any other view. |
| 2 | `ho-critique-04` | `concision: 4` is arbitrary; "Most came from..." is informal but arguably fine. |
| 3 | `ho-critique-07` | `tone: 3/4` is subjective, and a vague ask could also lose `ask_is_clear` 1 vs 2. |
| 4 | `ho-critique-06` | `repro_steps: 4` for two steps; a strict reviewer gives 3 or 5. |
| 5 | `ho-critique-02` | Near-perfect 5/5/5 on a one-sentence doc: easy to score, but does it test anything? |
| 6 | `ho-rewrite-05` | `must_include "Friday 3 January"` is literal; "3 January (Friday)" is a correct rewrite that would fail. |
| 7 | `ho-rewrite-07` | Reference drops marketing claims ("best-in-class"); input says "10-minute", check wants "10 minutes". |
| 8 | `ho-rewrite-08` | Plain passive-to-active swap, probably too easy; "specific" rubric item is vague. |
| 9 | `ho-agents-md-03` | Expects the literal word "unknown" for tests; a model writing "none yet" is arguably right but fails. |
| 10 | `ho-agents-md-07` | "Run" is not in the brief and I expect "unknown", but a model could reasonably suggest `airflow` commands; hallucination vs help is a judgement call. |
| 11 | `ho-architecture-md-05` | Short brief, near-copy reference; tests formatting more than understanding. |
| 12 | `ho-architecture-md-08` | Tiny brief, so a correct answer is mostly restating it; likely too easy. |
| 13 | `ho-summarize-04` | I changed this task's check from "500" to "large companies" to match my own reference: a sign the check is fragile. |
| 14 | `ho-suggest-edits-06` | The "fix" is stylistic and optional; a good model might suggest nothing or something else and lose `recall`. |
| 15 | `ho-suggest-edits-07` | "Data are" vs "Data is" and the wordy clause: more than one defensible edit; recall needs my exact span. |

Also worth a glance: all 50 are short plain-English cases written by one author in one sitting, so they share my style; a model tuned on similar synthetic data would find them easier than real documents.
