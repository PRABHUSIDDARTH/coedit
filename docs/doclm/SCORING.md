# docLM scoring rules

Implemented in `scripts/doclm/scoring.py`. Deterministic, offline, no LLM judge. These are structural and
reference-based checks, **not** a measure of writing quality; hand-read some outputs too.

## Total score

```
total = form_mean x product(content items) x product(penalty items)        # 0 if any hard item is 0
```

| Class | Items | Role |
|---|---|---|
| hard (0 -> total 0) | `parse`, `complete`, `changed`, `shorter_than_source`, `ids_exact`, `in_range`, `critical`, `no_real_change` | explicit constraints |
| content (multiply) | `must_include`, `sections`, `score_closeness`, `recall`, `precision`, `no_false_positive` | right content, not just right shape |
| penalty (multiply) | `must_not_include`, `within_limit`, `unknown_fields` | passing earns nothing, failing costs |
| form (averaged) | everything else (`no_preamble`, `length_sane`, `rationale_len`, `grounded`, `has_reason`, `non_noop`, ...) | shape |

A reply with the right shape and no right content scores about 0. A perfect reference scores 1.0.

## Phrase checks (`checks.must_include`, `must_not_include`)

- Each `must_include` entry is a phrase **or a list of acceptable alternatives** (any one counts).
- Matching normalises both sides: case, punctuation, hyphens, apostrophes, ordinals (`3rd` = `3`), dates
  (`3 January` = `January 3rd` = `the 3rd of January`), number words up to twenty and the tens
  (`thirty` = `30`), `%` = `percent`, and plural stems (`retry` = `retries`, `days` = `day`).
- It does **not** equate near-synonyms or different numbers (`a month` is not `30 days`; `retrying` is not `retry`).
  Put real alternatives in the list.

## Hard gate and raw match (`checks.critical`, `checks.must_include_raw`)

`must_include` costs only 1/n per missed entry, so a single wrong fact can still score 0.50 to 0.83. For facts that must
not be wrong, a task may declare:

- `checks.critical`: a list of phrases, each a string **or a list of acceptable alternatives**, matched exactly like
  `must_include` (same normalisation). If **any** entry has no matching alternative, the item `critical` is 0 and the
  whole example scores 0 (it is a hard item). It is not part of the form mean. Use alternatives wherever a correct
  answer can word the fact differently (for example `["seven business days", "seven working days"]`).
- `checks.must_include_raw`: a list of plain strings matched as a **raw, case-folded, whitespace-collapsed substring** of
  the reply. There is no other normalisation (punctuation, numbers, plurals and number words are not equated). Use it
  for command strings: `go build ./...` is not matched by `go build`, `go build ./cmd/...` or `go build -o x ./cmd/w`,
  which the normaliser would otherwise treat as the same thing. All raw entries are required, and they feed the same
  `critical` gate (a miss = 0). Raw entries have no alternatives list, so a legitimately different command fails.

Both apply to the text tasks that use phrase checks (rewrite, agents_md, architecture_md, summarize). Entries in
`critical` are not also needed in `must_include`. Used so far by the five tasks reviewed in batch 4 (`ho-rewrite-07`,
`-08`, `-09`, `ho-agents-md-01`, `-02`).

**Known limits of phrase checks (all of the above):**
- **Negation and "at least" flips are not caught.** "Refunds take at least seven business days", "we do not process
  refunds within seven business days", "never run `go build ./...`" and "never commit migrations" all contain the
  required phrases and can still score 1.000.
- **Invented "done" criteria are not caught** on a task that does not declare `must_say_unknown` (for example
  `ho-agents-md-01`): extra or made-up criteria score 1.000 as long as the required phrases appear.
- A phrase in the wrong context passes ("10 minutes" about something else), and extra invented facts, kept jargon and
  swapped meaning outside the listed phrases are not detected.
- Section headings must contain the exact names (`stack`, `commands`, `conventions`, `definition of done`, case
  ignored); "Done criteria" or "Definition-of-done" loses 0.25.
- A hard gate makes a missing alternative cost the whole example, so an incomplete alternatives list is a bigger risk
  than before: review alternatives for fairness.

## Word limit (summarize)

```
factor = clamp( 1 - (words / max_words - 1) / 0.25 , 0 , 1 )
```
Within the limit: 1.0. Over by up to 25%: falls linearly to 0.0 at +25%. Beyond +25%: 0. The factor multiplies the
total. Example, limit 30: 30 words = 1.0, 33 words = 0.60, 37 words = 0.07, 38+ = 0.

**What counts as a word:** a word is a whitespace-separated token, exactly `len(text.split())` (`scoring._words`).
Hyphenated terms (`7-2`), numbers (`1.8`) and standalone symbols each count as one token; punctuation attached to a
word adds nothing. No normalisation is applied before counting.

## suggest_edits: spans, recall, precision

- Each change's `original` is located in the document by character offsets (first match). Not found = ungrounded.
- **recall** = share of the reference's expected errors that are **fixed** after applying the model's changes by
  offset (overlapping changes: the first wins). "Fixed" = an accepted replacement, with one word of original
  context on each side, appears in the edited document, **and** some change touches that span. Accepted
  replacements = the reference replacement plus any alternatives in `checks.must_include[i]` (index i = reference
  change i). Punctuation-only fixes are compared with punctuation kept.
- **precision** = share of the model's changes that, applied alone, fix an expected error and are targeted
  (original no longer than 3x the expected error + 60 characters). Everything else (wrong span, ungrounded,
  meaning-changing rewording, a change to a document that needs none) is spurious.
- If the reference needs no change, any change fails (`no_false_positive`).
- `checks.optional_edits` (list of reference-change indices) marks stylistic edits as optional: skipping one is not
  penalised (recall ignores it; if every expected edit is optional, recall is 1.0), and a targeted change on its span
  is never spurious, in any wording. Anything elsewhere is still spurious. Used by `ho-suggest-edits-06` (a stylistic
  edit) and by `ho-suggest-edits-05` and `-08`, where change index 2 is a real but secondary punctuation error (comma
  splice before "please"; missing comma before "then") that the reference lists so a model fixing it is not penalised.
- **Empty or no-op answers (`no_real_change`).** If the reference has at least one **required** (not optional) edit and
  the reply has no change with `original != replacement` (an empty list, or only no-op changes), the item
  `no_real_change` is 0 and the example scores 0. It is a hard item, emitted only on failure, so it never changes the
  form mean. It does not apply when every expected edit is optional (`ho-suggest-edits-06`) or when the reference
  needs no change (`ho-suggest-edits-04`, where any change already fails `no_false_positive`). It does **not** change
  what "optional" means.
- **Alternatives must not already occur in the original text.** An acceptable replacement (in `checks.must_include[i]`)
  that, with its one word of context on each side, already appears in the unedited document would let a no-op count as
  a fix. Audit new alternatives against the original text (`ho-suggest-edits-07` had `after that`, now removed; the
  cost is that a valid replacement "after that" is no longer accepted there).
  The audit uses the normaliser: an alternative that differs from the original only by a plural (`totals are wrong` vs
  `total are wrong` in `ho-suggest-edits-05`) has the same tokens and cannot be added.
- Known weakness: a harmless extra improvement outside the expected spans is counted as spurious.

## Invented content (`checks.must_say_unknown`, optional)

A task may list section names (for example `"Definition of done"`) that the brief does not specify. The section must
exist and say unknown / not specified / not provided / not stated / n/a / TBD / not defined / not mentioned / unspecified / to be determined / not given. Applies only to tasks that declare
it. It is a **multiplier of 0.5**, not a zero: `factor = 1 - 0.5 x (share of declared sections that invented content or
are missing)`. One declared field that invents content halves the total; the rest of the file still earns credit.
Section-level only (it cannot check a single bullet such as "Run: unknown"). `must_not_include` is the forbidden-phrase list.

**Authoring rule for "Definition of done" (held-out agents_md tasks):** a Definition of done is derived in the
reference only when the brief states a must-pass or before-commit rule (for example "`cargo test` ... must pass",
"run X before every commit", "done when tests pass"). Otherwise the reference says `unknown` and the task declares
`must_say_unknown: ["Definition of done"]`. Other rules in a brief ("migrations must be committed", "token must never
be logged") are conventions, not a definition of done. This is a convention for writing references; the scorer only
enforces the `must_say_unknown` declaration.

## Code fences

A single outer ``` fence is stripped before scoring prose tasks, so it does not change the score; it is recorded as
`fenced` (and `fenced_rate` in reports). JSON tasks stay strict: a fenced reply is invalid JSON, and
`json_valid_lenient` records whether it would be valid after unfencing (not scored).

Coedit's council parser (read-only check, `backend/app/council/prompts.py`): `parse_scores` strips ```` ``` ```` and
```` ```json ```` fences, so fenced critique JSON is tolerated there. `parse_files` splits only on
`=== FILE: name ===` markers and has no fence handling, so a fence around the whole reply leaves a stray closing
fence at the end of the last file.

## Two-way tests

`data/known_bad.jsonl` (60 outputs, must score <= 0.30) and `data/known_good_variants.jsonl` (36 variants, must
score >= 0.80, except entries marked `ambiguous`, which are reported but not asserted; only `a month` for `30 days` is
left ambiguous). Ten variants were written blind to the checks. See `tests/test_known_good.py`.
