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

## Review batch 4 (draft lines 16-20): review mode, merged via PR #5, not human-reviewed

_Status (corrected to match git): merged to `main` via PR #5. Reviewed by the Claude agent in review mode; **not independently human-reviewed or approved**. No human sign-off is claimed._

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

## Review batch 7 (draft lines 36-50): review mode, merged via PR #6, not human-reviewed

_Status (corrected to match git): merged to `main` via PR #6. Reviewed by the Claude agent in review mode; **not independently human-reviewed or approved**. No human sign-off is claimed._
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

## Review batch 6 (draft lines 21-35): review mode, merged via PR #7, not human-reviewed

_Status (corrected to match git): merged to `main` via PR #7. Reviewed by the Claude agent in review mode; **not independently human-reviewed or approved**. No human sign-off is claimed._
Tasks: `ho-agents-md-03` to `-08`, `ho-architecture-md-01` to `-08`, `ho-summarize-01`. Branch `docllm-batch6-review` (off `main`). Nothing frozen, no baseline, no model run.
Only the `checks` field of these 15 lines was edited (compared field by field against `git show HEAD`: no other field differs on any of the 50 lines). Replies called "probe" are ad-hoc and live in a scratch directory outside the repo.

**What was run (before the edits unless stated):**
- Schema validation of all 50 lines: OK. All 50 gold answers score 1.000, before and after the edits.
- `check_overlap` (every other held-out task plus `seed.jsonl`, the only training-side file; no `train.jsonl` exists): max 5-gram containment 0.000 for 13 of the 15 tasks, 0.040 for `ho-agents-md-07` (vs `seed-agents-md-01` reference) and 0.019 for `ho-architecture-md-02` (vs `seed-architecture-md-01` reference); threshold 0.40.
- Existing entries: `known_bad` had 5 entries each for `ho-agents-md-05`, `ho-architecture-md-02`, `-06` and `ho-summarize-01` (all 0.000 before and after); `known_good_variants` had one each for `ho-agents-md-03`, `-04`, `-06`, `ho-architecture-md-01`, `-03`, `-06` (all 1.000 after; the `-06` one, a fenced smoke-run answer, dropped to 0.000 after the first draft of the new checks and was fixed with alternatives).
- Probes: 74 GOOD (correct answers), 3 BORDER (arguable) and 145 BAD (single wrong fact, dropped fact, flipped meaning, swapped role, wrong number, invented fact) over the 15 tasks.

**Before / after (current checks vs new checks):** BAD probes scoring 1.000: 95 of 145 before, 21 after; BAD probes above 0.5: 139 before, 21 after (the same 21). GOOD probes at 1.000: 57 of 74 before, 71 after. The 3 GOOD probes still below 1.000 are known and left alone: the heading variants `## Done criteria` on `ho-agents-md-03` (0.375) and `-08` (0.750), and `ho-agents-md-05` "Never run apply or destroy locally" (0.000, existing `must_not_include: terraform destroy`). BORDER probes: `Test: unknown` and `expo start` (no `npx`) on `ho-agents-md-03` and "after a 7-2 vote" (no direction) on `ho-summarize-01` went from 1.000 / 0.667 / 1.000 to 0.000 by design. Many GOOD gains come from alternatives added after seeing the failing probe, so they are not independent evidence.

**Residual strictness, measured:** a fresh batch of 24 correct-looking paraphrases (21 GOOD, 3 BORDER) was scored after the first round of alternatives: 5 of the 21 GOOD ones scored 0.000 on the hard gate (`outside CI`, `do not hand-edit`, `ship on its own`, `deduplicating on insert`, `dollars from the state`), about 1 in 4. Alternatives were then added for those five and they now pass, but the next batch of unseen wordings will likely hit zeros at a similar order of magnitude. Do not read the gated mean as a clean measure of correctness; the `ungated` column proposed below is there to find these zeros.

**Checks changed (all 15 tasks):** the named technologies, numbers and the one direction fact per task moved from `must_include` to `critical` with alternatives, e.g. `ho-agents-md-05` `never run terraform apply locally` (56 wordings, including `outside CI` and `only CI runs`) so "Always run terraform apply locally" and "Never run terraform apply in CI; apply locally" now score 0; `ho-agents-md-07` `generated/` must be negated and `DAGs` must be in `dags/` (it used to pass on the `pytest dags/tests` command alone); `ho-architecture-md-06` "a minute" ("ten minutes" and "an hour" now score 0); `ho-architecture-md-03` nightly plus once-a-day plus "late file delays reports"; `ho-summarize-01` vote 7-2 plus approval direction plus 3 km plus 1.8 million plus state grant plus Harbor Road. Commands moved to `must_include_raw`: `npx expo start`, `npm run lint` (`ho-agents-md-03`), `terraform fmt -check`, `terraform validate` (`-05`), `pytest dags/tests` (`-07`), `make run`/`make test`/`make lint` (`-08`). `ho-agents-md-04` takes `-D warnings` as a normalised alternative (`-D warnings`, `deny warnings`, `warnings as errors`) so `--all-targets` still passes. `ho-architecture-md-07` also gets `must_not_include: non-idempotent, not idempotent` (a hit costs 0.5, not 0). `ho-agents-md-03`: the old third `must_include` alternative list contained `unknown`, which the "Definition of done" line already supplied, so it checked nothing about tests; it is now a `critical` list without `unknown`.

**Known good variants:** 30 new (2 per task, worded differently from the gold and from the probes) in `known_good_variants.jsonl`, **written with the checks visible, so not blind**. First run: 26 of 30 scored 1.000; 4 failed the hard gate (`ho-architecture-md-05` "plugins are executed in-process / share the host process", `ho-architecture-md-07` "device connectivity is unreliable", and both `ho-summarize-01` variants, "backs extending" and "voted 7 to 2 for"). Fixed with alternatives; all 30 now score 1.000.

**Not caught (measured, still 1.000; phrase checks cannot see these):** `ho-agents-md-03` "do not enable TypeScript strict mode", "never run npm run lint"; `-04` a different Definition of done ("cargo build succeeds"); `-07` an invented run command (`airflow standalone`, `docker compose up ...`; `must_say_unknown` is section-level only); `-08` the three make targets swapped between Run/Test/Lint; `ho-architecture-md-01` "teams cannot deploy independently", gateway bypassed, an invented Kafka component; `-02` "no honeypot", the Lambda reading instead of writing; `-03` bad rows dropped; `-05` plugins loaded from a package server; `-06` "searchable instantly", synchronous indexing, "the queue never backs up"; `-07` Grafana writing and the collector reading, no broker; `-08` "we avoid last-write-wins"; `ho-summarize-01` wrong construction months (June to December) and an invented extra decision (not required, because a 30-word summary may drop the dates).

**Too strict, still (reasonable answers that score 0, by design or left):** `ho-agents-md-03` "Test: unknown" (the brief says no tests exist) and `expo start` without `npx` (raw command match); `ho-agents-md-05` mentioning `terraform destroy` even when negated; `ho-summarize-01` "after a 7-2 vote" (no direction). Heading variants stay at 0.75 / 0.375 by the owner's earlier decision. Alternatives lists are long but finite: an unlisted wording of a decision or risk fails the gate.

**Alternatives audit (rule: never add an alternative that already appears in the task's original text):** every `critical` / `must_include` alternative on the 15 tasks was tested against the brief or document with the normaliser. Alternatives that batch 6 added and that occur in the brief and that no gold, variant or GOOD probe needed were removed (25: for example `no server`, `each night`, `once a day`, `delays reports`, `at once`, `can overwrite`, `1.8 million dollars`). What remains in the brief is either an alternative that was already in the old checks (for example `3 kilometers`, `npm start`, `never be logged`, `deploy independently`, `streaming`; left untouched) or the brief's own wording of the fact, which the gold also uses and cannot be removed without breaking the 1.000 gold (for example `never run terraform apply locally`, `make test and make lint`, `handlers need table-driven tests`, `postgres first`, `a day`, `in dags`, `-D warnings`, `nothing to patch`). This is a departure from a literal reading of the rule for those, because on agents_md / architecture_md / summarize tasks the fact must be accepted in the brief's wording. A verbatim copy of the input still scores 0.000 on all 15 tasks (sections, `shorter_than_source`, word limit), so no alternative lets a copy pass. Pruning has a cost: wordings such as "each night" now depend on the other alternatives in the list. The owner decides whether to keep this reading.

**Scorer change (group B, approved by the owner and applied):** a per-task `ungated` total that ignores `critical` and `no_real_change`, with `mean_ungated` and `gated_zero` in the summary and table, `gated_zero_ids` and a per-item `ungated` in the JSON, and the ids listed under the table. Changes in `scoring.py` and `eval_runner.py`; new `tests/test_ungated.py` (6 tests). Documented in `SCORING.md`. `test_doclm.py` has no assertion on the `render_table` header and `render_compare` is unchanged; it was read, not run.

**Verification after the last edit:** 66 model-free tests pass (the same eight test files as before; `test_doclm`, `test_freeze` and `test_serve_check` not run), `ruff check` and `ruff format --check` clean, `check_overlap --train seed.jsonl` OK, all 50 golds 1.000, all 81 `known_good_variants` at 1.000 except the one `ambiguous` entry, all 60 `known_bad` at or below 0.30 (58 at 0.000; two critique `plausible_wrong` entries at 0.200 and 0.067, unchanged and not part of this batch). The freeze decision is the owner's.

## Review batch 5 (draft lines 1-15): review mode, PR open (not merged), not human-reviewed

_Status: committed on `docllm-batch5-review` with a pull request to `main` that is not merged. Reviewed by the Claude agent in review mode; **not independently human-reviewed or approved**. The owner approved the year decision and the `must_not_critical` scorer change (below); that is not a sign-off on the whole batch._
Tasks: `ho-critique-01` to `-09` and `ho-rewrite-01` to `-06` (confirmed against the local file). Branch `docllm-batch5-review` (off `main`, which already contains batches 4, 6 and 7). Nothing frozen, no baseline, no model run.
Only the `checks` field of `ho-rewrite-01` to `-06` was edited (compared field by field against `git show HEAD`: no other field differs on any of the 50 lines). The 9 critique lines are untouched. Replies called "probe" are ad-hoc and live in a scratch directory outside the repo.

**Critique tasks (schema, gold, known entries, overlap only; no probes, no checks added):** schema OK; all 9 golds 1.000; max 5-gram containment 0.000 against every other held-out task and `seed.jsonl` (`check_overlap.py --train seed.jsonl` OK). Existing `known_bad` entries exist for `ho-critique-01` and `-05` only (5 each); none scores above 0.30 (highest: `-01` `plausible_wrong` 0.200, `-05` `plausible_wrong` 0.067). Existing `known_good_variants`: `-01`, `-05`, `-06`, `-08`, `-09` (0.933 each). Reference scores (the owner's judgment, `score_closeness` measures distance to them; rubric closeness cannot be gated):
`-01` clarity 2 / concision 1 / evidence 0; `-02` 5/5/5; `-03` 1/1/0; `-04` 5/4/5; `-05` repro_steps 0 / expected_vs_actual 1 / environment 0; `-06` 4/5/3; `-07` ask_is_clear 1 / deadline 0 / tone 3; `-08` 5/3/4; `-09` 3/3/1.

**Rewrite tasks, before the edits (77 BAD / 46 GOOD probes, 6 tasks):** 61 of 77 BAD probes scored 0.5 or more and 46 scored 1.000 (wrong month/year, flipped meaning, swapped actor, dropped cause, wrong team, "$412 each", passive kept without the listed phrase, jargon kept). 9 of the 46 GOOD probes were below 1.000 (false strictness: `renews`, `2:10 am`, `37 of our customers`, `3 January (Friday)` = 0, `Jan 3` = 0, `Fri 3 January` = 0).

**Checks changed (group A only):** the facts moved from `must_include` to `critical` with alternatives; `must_not_include` is unchanged on all six tasks.
- `ho-rewrite-01`: `30 days` + direction (`30 days before/ahead/in advance/or more before/notice`, `30 or more days before`), `renewal`/`renews`, written (`written/in writing/writing/write to us/email/letter`).
- `-02`: `02:10`/`2:10`, `on-call engineer`, `engineer restarted/rebooted/...` (so a swapped actor or `got restarted by` fails), `monitoring`, an after/once/when/because/so word, `disk full` family, `server`.
- `-03`: `14 departments`, `dashboard`, `unusual/odd/strange/...`, a plain finding verb (so `hide`, `normal spending`, `anomalous`/`identification` fail).
- `-04`: `37 customers/clients`, `$412`, `march`, `overcharged/too much` (so `undercharged` fails), `total/in total/altogether/...` (so `$412 each` fails), `billing team made/overcharged/...` (swapped actor and `got overcharged by` passives fail).
- `-05`: weekday + date forms (`Friday 3 January`, `3 January (Friday)`, `Fri 3 Jan`, `Jan 3`, ...), `closed/shut/not open/...`, `holiday`. **The year is not required** (see below).
- `-06`: `9 June`, `steering committee delayed/postponed/pushed/decided to ...`, `security review/audit/...`, an after/once/following word.
Alternatives already present in the original text (audited with the normaliser): only the fact words the gold itself uses (`renewal`, `in writing`, `02:10`, `on-call engineer`, `monitoring`, `after`, `server`, `14 departments`, `dashboard`, `37 customers`, `$412`, `march`, `overcharged`, `total`, `friday 3 january`, `closed`, `holiday`, `9 June`, `security review`). They cannot be removed without breaking the 1.000 gold (same departure as batch 6). `30 days prior to the renewal` was **not** added (it is in the original), only `30 days prior to your renewal` / `prior to renewal`. A verbatim copy, a copy plus a period or newline and a lowercased copy all score 0.000 on all six tasks.

**Before / after (current checks vs new checks, 123 probes):** GOOD at 1.000: 37 of 46 before, 46 of 46 after. BAD scoring 1.000: 46 before, 13 after. BAD scoring 0.5 or more: 61 before, 15 after. BORDER: `-01` "tell us at least 30 days before ..." (drops "written") 1.000 -> 0.000 by design; `-02` "after monitoring found the disk full" stays 1.000. Many GOOD gains come from alternatives added after seeing the failing probe, so they are not independent evidence.

**Known good variants:** 12 new (2 per task, worded differently from the gold and from the probes) in `known_good_variants.jsonl`, **written with the checks visible, so not blind**. All 12 scored 1.000 on the first run, no alternative had to be added for them. A further 18 fresh GOOD probes written after the new checks: first run 3 scored 0.000 on the gate (ungated 1.000): `-01` "30 or more days before", `-02` "reported a full disk, and the on-call engineer ...", `-04` "The billing team on our side made mistakes ...". Alternatives were added for the first two; the third (unnatural wording) was left, so 1 of 18 (about 6%) still false-zeros. Unseen wordings will probably hit more, so read the `gated_zero_ids` list after the baseline.

**Not caught (measured, still 1.000):** `-01` actor changed ("We will send you a written request ...") and an invented fee; `-02` invented "old log files"; `-03` jargon kept as a different word ("utilize", "utilising": 1.000) and an invented saving; `-04` "got overcharged" passive, an invented refund; `-05` a **wrong year** (2026), a **dropped year**, jargon kept ("Kindly note ... said date ... owing to"), invented hours, "will not reopen". `-03` "facilitates spotting" scores 0.667 (existing `must_not_include`), `-05` "Please be advised" 0.500 (existing).
**Year on `ho-rewrite-05`:** requiring `2025` would zero the existing known-good variant "Friday, January 3rd" (no year, from the smoke run). That variant is the owner's, so the year was left optional. The owner decides.

**Scorer change (owner-approved, applied to `scoring.py` and `schema.py`):** new hard gate `checks.must_not_critical` (phrases or alternative lists that must not appear; any hit gives 0; ignored by `ungated` so a false zero stays visible; not part of the form mean). Used on `ho-rewrite-03` (`utilize`, `utilise`, `utilizing`, `utilising`), `ho-rewrite-04` (`got overcharged`, `get overcharged`, `gets overcharged`) and `ho-rewrite-05` (the wrong years `2023`, `2024`, `2026`, `2027`; the correct year is not required, as decided). New `tests/test_must_not_critical.py` (6 tests). Effect: the probes "utilize kept", "utilising kept", "got overcharged" and "wrong year 2026" went 1.000 -> 0.000; no other probe changed and every GOOD probe stays 1.000. After this, 9 of 77 BAD probes still score 1.000 (11 score 0.5 or more).

**Verification after the last edit:** 78 model-free tests pass (every `tests/test_*.py` except `test_doclm`, `test_freeze`, `test_serve_check`); `ruff check` and `ruff format --check` clean (ruff 0.17.5 from `backend/.venv/bin/ruff`, run inside `scripts/doclm` so its `ruff.toml` applies); `check_overlap --train seed.jsonl` OK; all 50 golds 1.000; all 93 `known_good_variants` at 1.000 except the nine critique ones at 0.933 and the one `ambiguous` entry (`good-ho-rewrite-01-blind2`, "a month before it renews", 0.000; it is the only `ambiguous` entry and `test_known_good.py` skips it by design); all 60 `known_bad` at or below 0.30. The freeze decision is the owner's.
