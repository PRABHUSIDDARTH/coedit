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

## What changed in the held-out checks after the scorer fixes (draft, not frozen)

Scoring rules are in `docs/doclm/SCORING.md`. The task inputs and references are unchanged; only `checks` changed.

**Alternatives added to `must_include`** (the old literal phrase is still accepted):

| Task | Old phrase | Now accepts | Why |
|---|---|---|---|
| `ho-summarize-01` | `3 km` | 3 km / 3 kilometres / 3 kilometers / 3 kilometre | unit spelling |
| `ho-summarize-04` | `large companies` | large companies / big companies / 500 staff / 500 employees / over 500 / more than 500 | was fitted to my own reference; many valid ways to say it |
| `ho-summarize-07` | `half price` | half price / 50 percent off / 50 percent discount | half price vs 50% |
| `ho-architecture-md-01` | `deploy independently` | deploy independently / deployed independently / independent deployment / deploy separately | inflection/paraphrase |
| `ho-architecture-md-03` | `streaming` | streaming / stream / real time | inflection |
| `ho-architecture-md-05` | `in-process` | in-process / same process / in process | phrasing |
| `ho-architecture-md-07` | `idempotent` | idempotent / idempotency / idempotence | inflection |
| `ho-architecture-md-08` | `overwrite` | overwrite / overwritten / overwriting / overwrites | inflection (stemmer only handles plurals) |
| `ho-agents-md-02` | `environment variables` | environment variables / env vars / environment variable | phrasing |
| `ho-agents-md-03` | `unknown` | unknown / none / no automated tests / not available / n/a | literal 'unknown' too strict |
| `ho-agents-md-04` | `doc comments` | doc comments / documentation comments / docs comments | phrasing |
| `ho-agents-md-06` | `never be logged` | never be logged / never logged / not be logged / never log / must not log | phrasing |
| `ho-agents-md-07` | `unknown` | unknown / not specified / not provided / n/a | literal 'unknown' too strict |

**Resolved by normalisation alone (no edit needed):** `ho-rewrite-05` ("Friday 3 January" now matches "Friday, January 3rd"),
`ho-summarize-05` ("30 November" matches "November 30"), `seed-architecture-md-01` ("retries" matches "retry"),
`ho-rewrite-07` ("10 minutes" matches "10-minute" and "ten minutes"), `ho-rewrite-01` ("30 days" matches "thirty days").

**`suggest_edits` tasks (01, 02, 03, 05, 06, 07, 08):** scoring is now span-based. `checks.must_include[i]` now lists
acceptable replacement phrasings for reference change i (old values like `["They're going", "than"]` were
substring checks and were replaced). `ho-suggest-edits-01` and `-03` now rely on the reference replacement only.

**`must_say_unknown: ["Definition of done"]` added** to `ho-agents-md-02`, `-03`, `-06`, `-07` (the briefs do not say
what "done" means). `seed-agents-md-02` also declares it.

**Still fragile after the fixes (please look):** `ho-summarize-04` (a paraphrase like "big organizations" is still
rejected), `ho-rewrite-01` (a human may accept "a month" for 30 days), `ho-suggest-edits-06` (the reference edit is
optional and stylistic). These three are recorded as `ambiguous` in `known_good_variants.jsonl`.
