# docLM baseline: Phi-4-mini-instruct (no fine-tuning)

- date: 2026-11-17
- repo commit: 0ca6735
- held-out set: heldout.v1.jsonl, sha256 2e010fe595a79f4fa27a6ed932b0347c139e5f1258956126f3cef1858cd3e6da
- model: microsoft/Phi-4-mini-instruct, weights index sha256 613a98d5e5716ca9...
- settings: bf16, greedy (do_sample=False), max_new_tokens 1024 (client sends temperature 0, max_tokens 1024), tokenizer chat template, scoring.build_messages prompts, served by scripts/doclm/serve_hf.py
- server load line: `{"load_seconds": 1.7, "device": "cuda:0", "gpu": "NVIDIA GeForce RTX 5070", "capability": [12, 0], "param_dtype": "torch.bfloat16", "torch": "2.15.0+cu132", "cuda_build": "13.2", "vram_allocated_mib": 7316}`
- scorer rules: docs/doclm/SCORING.md (unchanged since the freeze)

# Eval results: base

Endpoint model id: `phi4-mini-base`. Data: `heldout.v1.jsonl`.

| task | n | mean score (0-1) | ungated mean | gated to 0 | JSON-valid rate (strict) | JSON-valid if unfenced | fenced |
|---|---|---|---|---|---|---|---|
| critique | 9 | 0.890 | 0.890 | 0 | 100% | 100% | 0% |
| rewrite | 9 | 0.778 | 1.000 | 2 | n/a | n/a | 0% |
| agents_md | 8 | 0.438 | 0.688 | 2 | n/a | n/a | 100% |
| architecture_md | 8 | 0.875 | 1.000 | 1 | n/a | n/a | 100% |
| summarize | 8 | 0.138 | 0.513 | 3 | n/a | n/a | 0% |
| suggest_edits | 8 | 0.406 | 0.406 | 0 | 100% | 100% | 0% |

Tasks zeroed only by a gate (total 0, ungated > 0): ho-rewrite-01, ho-rewrite-08, ho-agents-md-04, ho-agents-md-05, ho-architecture-md-04, ho-summarize-01, ho-summarize-07, ho-summarize-08

## Status of this held-out set and of this analysis (read first)

- **The held-out set was reviewed only by Claude agents. No human has reviewed or approved it.** (`docs/doclm/HELDOUT_REVIEW.md`: "drafted by Claude ... not yet reviewed by a human"; every review batch is "not human-reviewed".) This analysis was also written by a Claude agent. Treat all verdicts below as unreviewed.
- **False zeros cannot be fixed in v1.** `heldout.v1.jsonl`, its sidecar, `HELDOUT_HASH.txt` and `scoring.py` are frozen. A gated zero that is really a correct answer in unlisted wording stays in the numbers above; such cases are **adjudicated manually** (the verdicts below), not by editing the checks. A change to the checks would mean `heldout.v2.jsonl` and a new baseline.
- The gated mean is therefore not a clean measure of correctness (see `docs/doclm/SCORING.md`, "Measured false-zero rate").

## How the per-task analysis was produced

`eval_runner.py` scores each reply and discards it, so the baseline run kept no model outputs. For this analysis the outputs of 21 tasks (the 8 gated-zero tasks, plus the 8 summarize and 8 suggest_edits tasks; 3 gated ones are summarize tasks) were **regenerated for analysis only**, after the baseline, from the same running server (`phi4-mini-base`), with the same `scoring.build_messages` prompts, `temperature` 0 (greedy, `do_sample=False`) and `max_tokens` 1024, by plain HTTP calls from a script outside the repo. Each regenerated reply was re-scored offline with the unchanged scorer and compared with `base.json` (every per-item score, `total`, `ungated`, `fenced`).

**Re-score match: 21 of 21 matched exactly; no task differed.** The regenerated replies are therefore treated as the scored replies, with the caveat that this proves the scores are identical, not that the text is byte-identical to the original generation. Raw replies and an sha256 manifest are in `~/doclm-results-backup/base-2026-11-17/outputs/` (manifest: `~/doclm-results-backup/base-2026-11-17/outputs.sha256`), outside the repo. Backup of the result files: `~/doclm-results-backup/base-2026-11-17/` (`base.json` sha256 `1c85feea1c7133a8115929ca0cb4d86f96df48a0e2bab46745e6e4b84cb9402d`, `base.md` sha256 `2d6a58f502053fe9d5860f42e8ae0a91cce801d92677a3f046ed9796e2614ed6`).

## Gated zeros: verdict per task

REAL = the reply is wrong or lacks a required fact. FALSE ZERO = the reply states the fact correctly in wording the check does not list. In all 8 cases `critical` was the only item at 0 (ungated 1.0).

| id | failed critical item | verdict |
|---|---|---|
| ho-rewrite-01 | `renewal / renews / renew ...` | FALSE ZERO (leaning; unsure) |
| ho-rewrite-08 | `Dana reviewed` and `Luis approved` | REAL |
| ho-agents-md-04 | `library / crate / lib` | REAL (omission; harsh gate) |
| ho-agents-md-05 | `never run terraform apply locally ...` and `before every commit ...` | REAL on the commit timing; FALSE ZERO on the apply wording |
| ho-architecture-md-04 | `sticky sessions are used/enabled ...` and `all of its connections ...` | FALSE ZERO |
| ho-summarize-01 | `7 to 2`, `voted to extend`, `1.8 million` | REAL |
| ho-summarize-07 | `march` | REAL |
| ho-summarize-08 | `81 percent for keyword ...` | FALSE ZERO (leaning; unsure) |

Tally: 3 FALSE ZERO (ho-rewrite-01 and ho-summarize-08 are only leaning, ho-architecture-md-04 is clear), 4 REAL (ho-rewrite-08, ho-agents-md-04, ho-summarize-01, ho-summarize-07), 1 mixed (ho-agents-md-05: the zero stays justified by the REAL part). Quotes below are from the reply; gold from the reference.

**ho-rewrite-01.** Gold: "To cancel, send us a written request at least 30 days before your renewal date." Reply: "If you want to cancel your subscription, send a written request at least 30 days before your next billing date." Failed: the `renewal` family; the reply says "next billing date". The 30 days and the written request are right. Verdict FALSE ZERO, unsure: "renewal date" and "next billing date" coincide for most subscriptions but are not identical (a yearly plan billed monthly), so this is a small wording-to-meaning shift that a strict reader could call wrong.

**ho-rewrite-08.** Gold: "Dana reviewed the report, Luis approved it, and we sent it to the client on 12 May." Reply: "Dana and Luis reviewed and approved the report, which was then sent to the client on 12 May." Failed: `Dana reviewed`, `Luis approved`. The reply gives both people both actions; the source says Dana reviewed and Luis approved. Verdict REAL (meaning changed: who did what). Note it also keeps "was then sent" (passive), against the active-voice rubric, though that is not what the gate caught.

**ho-agents-md-04.** Gold Stack: "Rust library `fastcsv`, MSRV 1.75." Reply Stack: "- Rust - Cargo - Clippy - Fastcsv" and nothing says it is a library; the other critical items passed (`cargo test`, clippy and `-D warnings`, 1.75, doc-comment rule). Failed: `library / crate / lib`. Verdict REAL as an omission (no correct unlisted wording exists in the reply), but unsure the omission deserves a total zero: it is a low-stakes fact next to the command and rule facts the reply got right. Also seen: MSRV is placed under Definition of done, not Stack, and the doc-comment rule is repeated there.

**ho-agents-md-05.** Gold Conventions: "Never run `terraform apply` locally; CI applies."; Definition of done: "fmt and validate pass before commit." Reply: Commands include "`terraform apply` (CI only)"; Definition of Done: "Code is not applied locally; applied through CI." Failed two items. (1) apply rule: the reply says the same thing ("not applied locally; applied through CI") in wording the list lacks (the list has "terraform apply is not run locally", not "is not applied locally"): FALSE ZERO for this item. (2) `before every commit ...`: the reply says the code is formatted and validated but never says when; the brief says before every commit. REAL omission. The zero stands because of (2); unsure only whether "before every commit" should be a gate rather than a form item.

**ho-architecture-md-04.** Gold Decisions: "Sticky sessions keep a client on one Node instance."; Risks: "A Node restart drops all of its connections at once." Reply: "Sticky sessions are implemented to ensure that a client maintains a connection to the same Node instance." and "A Node.js server restart results in the loss of all its connections ...". Failed: the sticky-session item (list has "are used/enabled/configured", not "are implemented"/"implemented sticky sessions") and the risk item (list has "all of its connections", not "all its connections"). Both facts are correct. Verdict FALSE ZERO, high confidence. Unscored problems in the same reply: it invents a cause ("as sticky sessions are not maintained across restarts") and a rationale for MongoDB ("scalability and flexibility") that the brief does not give.

**ho-summarize-01** (limit 30; reply 26 words). Gold: "Council voted 7-2 to extend the Harbor Road bike lane by 3 km, funded by a 1.8 million dollar state grant, with work from April to September." Reply: "City council extends Harbor Road bike lane by 3 km, funded by state grant, construction from April to September, 2 members opposed due to parking concerns." Failed: `7 to 2`, `voted to extend`, `1.8 million`. The vote count and the 1.8 million amount are absent, and the reply says nothing about a vote having happened. Verdict REAL (it spent words on the opposition and left out the vote and the amount).

**ho-summarize-07** (limit 25; reply 23 words). Gold: "From March the museum opens until 9 pm on first Fridays, half price after 6 pm, as a six-month trial." Reply: "Museum opens late on first Friday of each month until 9 pm, half-price after 6 pm, live music, cafe open, six-month trial program." Failed: `march`. The start month is missing. Verdict REAL (omission of a date; the other three critical facts are present).

**ho-summarize-08** (limit 30; reply 28 words). Gold: "A small model trained on 20,000 tickets routed 88 percent correctly versus 81 percent for keyword rules, but fell to 74 percent on unseen languages." Reply: "A small model trained on 20,000 support tickets achieved 88% accuracy in routing, outperforming keyword rules by 7%. However, accuracy fell to 74% for tickets in untrained languages." Failed: `81 percent for keyword ...`. The reply never states 81 and gives the difference instead; 88 minus 81 is 7 points, so the derived figure is right if read as percentage points, but "7%" is imprecise (a relative gain would be about 8.6%). Verdict FALSE ZERO, unsure: the stated fact is not wrong, but the baseline figure the check wants is not given and "7%" can be misread.

## summarize: all 8 tasks

Mean gated 0.138, mean ungated 0.513. Limit factor = `1 - (words/max - 1)/0.25`, floored at 0 (words = `len(text.split())`).

| id | words / limit | gated | ungated | what fired |
|---|---|---|---|---|
| ho-summarize-01 | 26 / 30 | 0.000 | 1.000 | `critical` only (gate): missed 7 to 2, voted to extend, 1.8 million |
| ho-summarize-02 | 34 / 30 | 0.467 | 0.467 | `within_limit` 0.467 (13% over) |
| ho-summarize-03 | 44 / 25 | 0.000 | 0.000 | `within_limit` 0.000 (76% over, past the +25% cut-off) |
| ho-summarize-04 | 41 / 30 | 0.000 | 0.000 | `within_limit` 0.000 (37% over) |
| ho-summarize-05 | 31 / 25 | 0.040 | 0.040 | `within_limit` 0.040 (24% over) |
| ho-summarize-06 | 33 / 30 | 0.600 | 0.600 | `within_limit` 0.600 (10% over) |
| ho-summarize-07 | 23 / 25 | 0.000 | 1.000 | `critical` only (gate): missed march |
| ho-summarize-08 | 28 / 30 | 0.000 | 1.000 | `critical` only (gate): missed 81 percent for keyword |

Scores below 0.5 and the check behind each: 01, 07 and 08 (gated 0): `critical` gate; 02 (0.467), 03 (0.000), 04 (0.000), 05 (0.040): the word-limit factor. `parse`, `complete` and `shorter_than_source` passed on all 8 (no hard item other than `critical` fired), and every critical phrase present on 02 to 06.

**Why the ungated mean is only 0.513:** ungated ignores the `critical` gate but still applies the word-limit multiplier. Ungated totals are 1.000, 0.467, 0.000, 0.000, 0.040, 0.600, 1.000, 1.000, which sum to 4.107; 4.107 / 8 = 0.513. Three tasks (01, 07, 08) are full marks once the gate is ignored. Four tasks (02 to 05) miss the word limit by 13% to 76% and are cut to 0.467 / 0 / 0 / 0.04; 06 loses 40% for being 10% over. So the model's main summarize failure is length: 5 of 8 replies exceed the limit (the model wrote 31 to 44 words against 25 to 30). The three gated zeros are a separate content problem (two REAL omissions, one FALSE ZERO leaning).

## suggest_edits: what the model got wrong (mean 0.406)

JSON was valid on 8 of 8 (100% strict, none fenced). Scores: 1.000, 1.000, 0.500, 0.000, 0.250, 0.500, 0.000, 0.000.

- **ho-suggest-edits-01 (1.000).** Correct: removed "the the". It replaced the whole sentence and also changed "have" to "has" and "are" to "is" (the reference allows only the repeated word). The scorer gave full marks anyway; see "Open scorer limit" below for the traced reason. Not penalised under these rules, but it over-edits.
- **ho-suggest-edits-02 (1.000).** Correct: both "Their going" and "later then" fixed, in one whole-sentence change.
- **ho-suggest-edits-03 (0.500).** Fixed "is" to "are" (correct), but also proposed an unneeded rewrite of "Please find attached the report." to "Please find the attached report." (reason: "awkward"). That second change counts as spurious: precision 0.5.
- **ho-suggest-edits-04 (0.000).** The document ("We shipped the feature on Friday. It works well and customers like it.") needs no change. The model proposed changing `untrusted_source` to `trusted_source`, text that is not in the document (it is the name of the prompt's wrapper tag), with a reason about trusting the source. Ungrounded and a false positive: `grounded` 0, `no_false_positive` 0. This is a plain model failure (it edited the prompt wrapper, not the document).
- **ho-suggest-edits-05 (0.250).** Changed "recieve" to "receive" and "are" to "is". The "are" to "is" change fixes an expected error ("total is wrong"). The "recieve" to "receive" change fixes the spelling but not the tense: the reference needs "I received" (the invoice arrived yesterday), so "I receive" is still wrong, and the scorer counts that change as spurious and the expected edit as missed. recall 0.5, precision 0.5. The optional comma-splice fix was not attempted (not penalised).
- **ho-suggest-edits-06 (0.500).** The reference makes one optional stylistic edit ("then again to 3 pm" to "then back to 3 pm"); restraint is the test (see `SCORING.md`). The model rewrote the first sentence ("moved" to "rescheduled", "again" to "rescheduled back") and added a made-up cause to the second ("Everyone is confused due to the meeting's rescheduling."). The second change adds content not in the source and is spurious: precision 0.5. Over-editing acceptable text.
- **ho-suggest-edits-07 (0.000).** The only expected edit is shortening "after that period of time has elapsed" to "afterwards". The model changed "thirty days" to "30 days" instead (reason: "standardize"), which is not an error and is outside the expected span: recall 0, precision 0. Missed the real (wordiness) edit and made a spurious one.
- **ho-suggest-edits-08 (0.000).** The text is a run-on missing commas and a full stop. The model changed "12 characters" to "at least 12 characters", which changes the meaning (the brief says 12) and fixes nothing expected: recall 0, precision 0. It missed all punctuation fixes. This is a meaning change on top of a miss.

Overall pattern: it is good at one obvious grammar slip (01, 02, the "is/are" half of 03 and 05), weak at stylistic or punctuation-only fixes, and often adds unrequested or content-changing edits (03, 06, 07, 08), once edited text that is not in the document (04). Scorer note: the whole-sentence replacements in 01 and 02 receive full marks.

## Open scorer limit: extra edits inside one large change are not checked (suggest_edits)

Found by tracing `ho-suggest-edits-01` read-only (no scorer change; `scoring.py` is frozen). Document: "The team have finished the the migration and are now testing the new database." (78 characters). Expected change: "the the migration" to "the migration" (span 23 to 40, 17 characters). The model returned ONE change whose `original` is the whole document (span 0 to 78) and whose replacement is "The team has finished the migration and is now testing the new database."

Scoring path (`scoring.py`, `score_example` then `_score_edit_spans`, `_span_fixed`):
- `grounded` 1.0: the `original` is found verbatim (span 0 to 78). `has_reason` 1.0, `non_noop` 1.0.
- **recall 1.0:** the model's change overlaps the expected span (0 to 78 contains 23 to 40), and `_span_fixed` looks only at a window in the edited document: one word of original context on each side of the expected span ("finished", "and") around the accepted replacement ("the migration"), i.e. tokens `finished the migration and`. That window is present in the edited document, so the error counts as fixed. Everything outside that window (here "have" to "has" and "are" to "is") is never compared with anything.
- **precision 1.0:** a change is "useful" if it overlaps an expected span, is "targeted" (its `original` length is at most `3 x expected length + 60` = 3 x 17 + 60 = 111 characters; the model's is 78, so it passes), and, applied alone, passes the same window check. It does, so the one change counts as useful, 1 of 1.
- No item compares the whole edited document with the reference, and no item penalises extra changes that sit inside a "targeted" change.

Consequence: on short documents (a document of up to about 111 characters is within the 3x + 60 slack for a 17-character error) a model can rewrite the whole sentence, make any additional edits it likes, and still score recall 1.0 and precision 1.0 as long as the expected fix appears with its neighbouring words. `ho-suggest-edits-02` scores 1.0 the same way (span 0 to 79 against an expected 11-character span, limit 93). In 01 the extra edits happen to be harmless ("team have" to "team has" is arguably a fair choice, "are now testing" to "is now testing" follows from it), but the scorer cannot tell harmless from meaning-changing extras in this situation. The `suggest_edits` mean of 0.406 therefore may overstate the model on tasks where it rewrote the whole sentence (01, 02), and it also means a trained model could be rewarded for whole-sentence rewrites. This limit is open: v1 cannot be fixed (frozen); a fix (for example penalising unexplained changes outside the expected windows, or capping `original` length) would belong in `heldout.v2.jsonl` and a new baseline.

## Adjudicated range per task type (manual adjudication, NOT a scorer output)

Produced by hand from the per-task verdicts above, by a Claude agent; no human has reviewed it. The scorer's only outputs are the table at the top (gated) and the ungated mean. Two bounds per task type:
- **Lower bound:** every REAL case and every unsure case stays the gated zero. This equals the reported gated mean.
- **Upper bound:** every FALSE ZERO case and every unsure case is replaced by its ungated score (all five of these have ungated 1.000). REAL cases that are not unsure stay 0. Cases replaced: ho-rewrite-01 (leaning FALSE ZERO, unsure), ho-agents-md-04 (REAL but unsure it deserves a total zero), ho-agents-md-05 (mixed, unsure), ho-architecture-md-04 (FALSE ZERO), ho-summarize-08 (leaning FALSE ZERO, unsure). Cases left at 0 in the upper bound: ho-rewrite-08, ho-summarize-01, ho-summarize-07 (REAL, not unsure).

| task type | n | lower bound = gated | replaced in upper bound | upper bound arithmetic | upper bound |
|---|---|---|---|---|---|
| critique | 9 | 0.890 (8.0056 / 9) | none | 8.0056 / 9 | 0.890 |
| rewrite | 9 | 0.778 (7.000 / 9) | ho-rewrite-01 (0 to 1.000) | (7.000 + 1.000) / 9 = 8.000 / 9 | 0.889 |
| agents_md | 8 | 0.438 (3.500 / 8) | ho-agents-md-04, -05 (0 to 1.000 each) | (3.500 + 2.000) / 8 = 5.500 / 8 | 0.688 |
| architecture_md | 8 | 0.875 (7.000 / 8) | ho-architecture-md-04 (0 to 1.000) | (7.000 + 1.000) / 8 = 8.000 / 8 | 1.000 |
| summarize | 8 | 0.138 (1.107 / 8) | ho-summarize-08 (0 to 1.000) | (1.107 + 1.000) / 8 = 2.107 / 8 | 0.263 |
| suggest_edits | 8 | 0.406 (3.250 / 8) | none | 3.250 / 8 | 0.406 |

Pooled over all 50 tasks (also manual, a plain average of task scores, not a scorer output): lower 29.862 / 50 = 0.597; upper (29.862 + 5.000) / 50 = 34.862 / 50 = 0.697. Sums use unrounded scores, so the displayed sums can differ from the means in the third decimal. The ranges are wide for agents_md, summarize and rewrite, so a later docLM comparison should read gated and adjudicated numbers side by side, not the gated mean alone. suggest_edits and critique have no gated zeros, so their range is a point (see the open scorer limit above for suggest_edits).

## Reproducibility

After `eval_runner.py` was changed to save raw replies, the baseline was rerun once more under the label `base-rerun`, on the same GPU (RTX 5070) and the same software stack (torch 2.15.0+cu132), against the same frozen `heldout.v1.jsonl` (sha256 `2e010fe595a79f4fa27a6ed932b0347c139e5f1258956126f3cef1858cd3e6da`), with the same fixed settings. The numbers above are from the first run (`base`).

- **0 of 50 tasks differed** from the first run in per-item scores or totals; the per-task-type summary is identical. No request errors.
- All 50 `finish_reason` values were `stop` (no reply hit the 1024-token cap).
- The raw replies are saved in `base-rerun.outputs.jsonl` (one line per task). It and `base-rerun.json` / `base-rerun.md` were copied to `~/doclm-results-backup/base-2026-11-17/` (outside the repo; `results/` is gitignored):
  - `base-rerun.json` sha256 `302ca9d68f4f65415f967c7cff42893a1ea5eb40c42fdac37b08abc6e1fbe47e`
  - `base-rerun.md` sha256 `e8a5281913794b4c24b5c84bed000eebde4d06ba2b888ea239092d14f345f9f3`
  - `base-rerun.outputs.jsonl` sha256 `b442b9275e88ac8baa225a9d74d2b039c0d0788ce21ac5f1329d6848b73879c3`
- The saved reply text of the 21 tasks regenerated for the analysis above is identical to the rerun's saved replies (21 of 21).

This applies to this GPU and software stack only. Greedy decoding is not guaranteed to give identical text on a different GPU, driver, torch/CUDA build or batch setting; a docLM comparison should be run on this same setup.

## Caveats

The scorer checks structure and required content, not writing quality; read some outputs yourself. Single run, greedy. Regenerated, not retained, outputs (see above). All verdicts are model-written and not human-reviewed.
