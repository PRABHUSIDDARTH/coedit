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

**Final tweaks (the last check changes before the baseline):**
- `ho-summarize-04`: `big organizations` and `large organizations` added to the "large companies" alternatives
  (plural stems make "organization" match too).
- `ho-suggest-edits-06`: new `optional_edits: [0]`. The reference edit ("and then back to 3 pm") is stylistic, so
  skipping it is not penalised and a targeted change on that span is never spurious.
- `must_say_unknown` is now a 0.5 multiplier instead of a zero (see SCORING.md).
- `ho-rewrite-01` stays strict on purpose: "a month" does not count as "30 days". It is the one remaining
  `ambiguous` entry in `known_good_variants.jsonl`.

**Still fragile (please look):** `ho-rewrite-01` (above), and every check that lists one phrasing only.

## Review batch 4 (draft lines 16-20): review mode, NOT approved, NOT committed

Tasks: `ho-rewrite-07`, `-08`, `-09`, `ho-agents-md-01`, `-02`. Branch `docllm-batch4-review`. Nothing frozen, no baseline, no model run.
Only the `checks` field of these five lines was edited; inputs and references are untouched (compared field by field against the copy taken before the edits).
Replies called "probe" are ad-hoc replies written in a scratch directory outside the repo; they are not in `known_bad.jsonl` or `known_good_variants.jsonl`.

**What was run:**
- Schema validation of all 50 lines: OK. All 50 gold answers score 1.000 (re-run after the last edit).
- `check_overlap.py` against `seed.jsonl` (the only training-side file): OK. Max 5-gram containment 0.000 for every pair for the five tasks, except `ho-agents-md-01` vs the `seed-agents-md-01` reference at 0.037 (threshold 0.40).
- Existing entries: `known_bad` has 5 entries for `ho-agents-md-01` only; `known_good_variants` has one each for `ho-rewrite-07`, `-08`, `-09` and `ho-agents-md-02`. Everything else is probe-only (about 75 probes).
- Model-free unit tests (without `test_doclm`, `test_freeze`, `test_serve_check`): 61 tests, all pass, including the new `tests/test_critical.py`.

**Scorer changes made after the owner approved them (`scoring.py`, `schema.py`):** `checks.critical` (hard gate), `checks.must_include_raw` (raw case-folded substring), five extra `UNKNOWN_MARKERS` (`not defined`, `not mentioned`, `unspecified`, `to be determined`, `not given`; the fifth added on a later owner approval). Documented in `docs/doclm/SCORING.md`, including the known limits.

**Checks changed on the five tasks:** facts moved to `critical` with alternatives (`10 minutes`/`10 min`; `seven business days`/`seven working days`; `refund`/`refunded`/`refunding`/`money back`/`reimburse`; `Dana reviewed`/`Dana checked`; `Luis approved`/`signed off`/`gave approval`/`gave his approval`; `client`/`customer`; `go 1.22`/`golang 1.22`; `environment variables`/`env vars`/`environment variable`/`env variables`/`from the environment`; `django 5`; `postgresql 16`/`postgres 16`); `go build ./...` and `go test ./...` in `must_include_raw` on `ho-agents-md-01`. "Working days" = business days and "reimburse" = refund are accepted alternatives by the owner's decision.

**Not caught (measured with probes, still 1.000):** "at least seven business days", "do not process refunds within seven business days", "within seven business days before you send your return", "at least 10 minutes", "never sent it", "Luis approved it but we never sent it", "never run go build ./...", "never commit migrations", "put secrets in settings.py; do not use environment variables", "do not use pytest", invented done criteria on `ho-agents-md-01`.
**Still below 1.000 for a correct answer (probes):** headings "Done criteria", "Definition-of-done", "## Done" (0.75 / 0.75 / 0.375) (heading variants left alone by the owner's decision). "Not given" now passes.

## Review batch 7 (draft lines 36-50): review mode, NOT approved, NOT committed
Tasks: `ho-summarize-02` to `-08` and `ho-suggest-edits-01` to `-08`. Branch `docllm-batch7-review` (off `docllm-batch4-review`). Nothing frozen, no baseline, no model run.
Only the `checks` field of these lines was edited (inputs and references compared field by field with the copy taken before the edits). Replies called "probe" are ad-hoc and live in a scratch directory outside the repo.

**What was run:**
- All 50 golds score 1.000 after the last edit; `check_overlap` numbers for the 15 tasks: max 5-gram containment 0.000 against the other held-out tasks and against `seed.jsonl`.
- Existing entries: `known_bad` covers only `ho-summarize-05`, `ho-suggest-edits-01` and `-04` (all 0.000); `known_good_variants` has 16 entries across 13 of the 15 tasks (all 1.000).
- 66 model-free tests (without `test_doclm`, `test_freeze`, `test_serve_check`) pass; `ruff` clean.

**Scorer change approved by the owner (`scoring.py`):** `no_real_change` (hard item): an empty reply or one whose changes all have `original == replacement` scores 0 when the reference has at least one required edit. New `tests/test_no_real_change.py`. It does not apply to `ho-suggest-edits-06` (its only edit is optional); the meaning of "optional" is unchanged and `-06` is untouched.

**Audit, suggest_edits alternatives that already appear in the original text:** all 8 tasks audited (every reference replacement and every `must_include` alternative, tested as a no-op). One hit: `ho-suggest-edits-07`, alternative `after that` (also in the original span), which made a no-op count as a fix (no-op 0.750). Removed. Cost: a valid replacement "after that" now scores 0.000 on `-07` (was 1.000). The other 7 tasks: none.

**Checks changed:** `ho-suggest-edits-07` (above). `ho-summarize-02` to `-08`: facts moved to `critical` with alternatives, including the direction of the claim where a probe showed a flip scored 1.000 (Windows 7 dropped, vote in favour, bookings carry over, "twice as likely", cause = failed transformer, 14 to 6 minutes and 72 to 90 percent, half price after 6 pm, 81 percent tied to keyword rules).
Probe results (current checks vs new): adds-Windows-7 flip, voted-against, bookings cancelled, half as likely, storm cause, setup 6 to 14, completion reversed, half price before 6 pm, roles swapped 88/81 all 1.000 or 0.667 before and 0.000 after; all 18 GOOD summarize probes stay 1.000.

**Not changed / still weak (measured):** suggest_edits tasks 01, 02, 03, 05, 08: fixing only one of two required errors scores 0.500; a wrong extra edit costs only 1/n (`-08` spurious "12 to 8 characters" 0.667; `-01` spurious database to databases 0.500); `-05` "totals are wrong" (a reasonable alternative) scores 0.250; `-06` empty answer 1.000 and no-op 0.750 (owner decision pending). Summarize: the claim-direction alternatives are long lists and a correct answer worded differently will fail (hard gate); `ho-summarize-01` was not part of this batch.

**Batch 7 follow-up (owner-approved):**
- `git fetch` + `git merge origin/main`: already up to date (`origin/main` 93fca17 was already an ancestor). This branch is main plus the batch 4 commit `b0da161` (PR #5, not merged) plus the batch 7 changes.
- `known_good_variants.jsonl`: 14 new correct summaries (2 for each of `ho-summarize-02` to `-08`, worded differently from the gold and the earlier probes, within the word limit; written with the checks visible, so not blind) plus 1 for `ho-suggest-edits-05`. All 15 score 1.000. Three of the 14 failed first (hard gate): `-02` "Support for Windows 7 is dropped", `-04` "large employers", `-08` "keyword matching managed 81 percent". Fixed with alternatives (12 for `-02` direction, 10 for `-04` size, 15 for `-08` baseline wording). Earlier BAD probes still score 0 and earlier GOOD probes still 1.000.
- `ho-suggest-edits-05`: "totals are wrong" was **not** added. It normalises to the same tokens as the original "total are wrong" (the stemmer removes the plural), so it already "appears" in the original text; a real fix with that wording also fails the span test (probe 0.250, unchanged). Added instead (each audited: not in the original, no-op does not count as fixed): `total is incorrect`, `totals are incorrect`, `total is not correct`, `total is not right`, `totals are not correct`, `totals are not right` (probes 1.000). Tense variants (`total was wrong`) were not added. A no-op on the second edit plus the first fix scores 0.188.
- Verification after these edits: 66 model-free tests pass, `ruff` clean, all 50 golds 1.000. `ho-suggest-edits-06` untouched.
