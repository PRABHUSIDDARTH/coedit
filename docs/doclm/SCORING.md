# docLM scoring rules

Implemented in `scripts/doclm/scoring.py`. Deterministic, offline, no LLM judge. These are structural and
reference-based checks, **not** a measure of writing quality; hand-read some outputs too.

## Total score

```
total = form_mean x product(content items) x product(penalty items)        # 0 if any hard item is 0
```

| Class | Items | Role |
|---|---|---|
| hard (0 -> total 0) | `parse`, `complete`, `changed`, `shorter_than_source`, `ids_exact`, `in_range` | explicit constraints |
| content (multiply) | `must_include`, `sections`, `score_closeness`, `recall`, `precision`, `no_false_positive`, `unknown_fields` | right content, not just right shape |
| penalty (multiply) | `must_not_include`, `within_limit` | passing earns nothing, failing costs |
| form (averaged) | everything else (`no_preamble`, `length_sane`, `rationale_len`, `grounded`, `has_reason`, `non_noop`, ...) | shape |

A reply with the right shape and no right content scores about 0. A perfect reference scores 1.0.

## Phrase checks (`checks.must_include`, `must_not_include`)

- Each `must_include` entry is a phrase **or a list of acceptable alternatives** (any one counts).
- Matching normalises both sides: case, punctuation, hyphens, apostrophes, ordinals (`3rd` = `3`), dates
  (`3 January` = `January 3rd` = `the 3rd of January`), number words up to twenty and the tens
  (`thirty` = `30`), `%` = `percent`, and plural stems (`retry` = `retries`, `days` = `day`).
- It does **not** equate near-synonyms or different numbers (`a month` is not `30 days`; `retrying` is not `retry`).
  Put real alternatives in the list.

## Word limit (summarize)

```
factor = clamp( 1 - (words / max_words - 1) / 0.25 , 0 , 1 )
```
Within the limit: 1.0. Over by up to 25%: falls linearly to 0.0 at +25%. Beyond +25%: 0. The factor multiplies the
total. Example, limit 30: 30 words = 1.0, 33 words = 0.60, 37 words = 0.07, 38+ = 0.

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
- Known weakness: a harmless extra improvement outside the expected spans is counted as spurious.

## Invented content (`checks.must_say_unknown`, optional)

A task may list section names (for example `"Definition of done"`) that the brief does not specify. The section must
exist and say unknown / not specified / not provided / not stated / n/a / TBD. Applies only to tasks that declare
it. It multiplies the total, so an invented section zeroes the score. Section-level only (it cannot check a single
bullet such as "Run: unknown"). `must_not_include` is the forbidden-phrase list.

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
score >= 0.80, except entries marked `ambiguous`, which are reported but not asserted). Ten variants were written
blind to the checks. See `tests/test_known_good.py`.
