# docLM data build, phase 1 (design)

Status: design plus a dry run of at most 30 examples per task type. **No training has been run, and no example in this
build has been human-reviewed.** Dry-run outputs live outside the repo (`~/doclm-data-dryrun/`).
Code: `scripts/doclm/build_data.py` (CLI), `data_topics.py`, `data_filters.py`, `error_injector.py`;
tests: `scripts/doclm/tests/test_data_build.py` (model-free, fixed strings).

## 1. Decisions (made by the owner; recorded here)

- **Generator: only the local MIT-licensed base model**, `~/doclm-models/Phi-4-mini-instruct`, served by
  `scripts/doclm/serve_hf.py`. No outputs from Claude, GPT, Gemini, Llama or Qwen. No downloads of anything.
- `scripts/doclm/data/seed.jsonl` is **not used** (authorship unverified).
- **Task types in phase 1: `summarize` and `suggest_edits` only.** Not `agents_md`, `architecture_md`, `critique`, `rewrite`.
- **Held-out hygiene.** `heldout.v1.jsonl` and `BASELINE.md` were not read to design prompts or topics, and baseline verdicts are
  not turned into generation prompts. Input domains come from the fixed list in section 4, written before any generation.
  The only held-out check is `check_overlap.py` (it reads the file itself and prints ids and scores only).

## 2. Record format

Each training example is one line of `train.jsonl`, a normal `schema.Example` (`split="train"`), so that
`check_overlap.py` and `schema.read_jsonl` accept it. `Example.from_dict` rejects unknown keys (tested), so the
extra audit data goes in a **sidecar** `train.meta.jsonl`, one line per example, joined on `id`. `schema.py` is not changed.

| Field | Where | Content |
|---|---|---|
| task type | `train.jsonl: task` | `summarize` or `suggest_edits` |
| input | `train.jsonl: input` | summarize `{document, max_words}`; suggest_edits `{document}` |
| reference output | `train.jsonl: reference` | summarize `{"text": ...}`; suggest_edits `{"changes": [{location, original, replacement, reason}]}`; no edit needed = `{"changes": []}` |
| source / provenance | `train.jsonl: source` | exactly `programmatic` (suggest_edits) or `rejection-sampled from Phi-4-mini-instruct, run <run id>` (summarize) |
| scorer hints | `train.jsonl: checks` | summarize `must_include` (the extracted key facts); suggest_edits `optional_edits` (indices of the optional stylistic changes) |
| generator settings | `meta: generator` / `input_text_origin.generation` | model, decoding (greedy for passages; temperature 0.8, top_p 0.95 for summaries), max new tokens, samples per passage |
| seed | `meta: generator.seed`, `base_seed` | per-candidate sampling seed; passage and error plans derive from `--seed` |
| filter results | `meta: filters` | summarize: every candidate's reject reasons and missing facts, the chosen index, scorer total. suggest_edits: grounded, original unique, round trip equals clean text, self-score, empty-answer score |
| other | `meta` | `id`, `task`, `run_id`, `labels`, `input_text_origin` (passage id, topic, generator), suggest_edits `category` and `error_kinds` |

Training chat record (`train.chat.jsonl`): `{"id", "messages": scoring.build_messages(ex) + [assistant]}`. The assistant turn is
`json.dumps(reference)` for suggest_edits (strict JSON, no fence) and `reference["text"]` for summarize.
**The data builder never writes prompt text**: every prompt, including the ones used to sample candidate summaries, comes from
`scoring.build_messages` (a test asserts that the build scripts contain no copy of the system prompts and that the training
prompt equals `build_messages(ex)`). The only prompt the builder writes itself is the passage-writing prompt, which is a
generator prompt for source text and is never an evaluation prompt.

## 3. Change to `serve_hf.py` (needs your decision)

`serve_hf.py` was greedy-only (`do_sample=False`), so "4 samples per passage" would give 4 identical strings. The change adds
`generation_kwargs(req)`: a missing, zero or negative `temperature` returns exactly `{"do_sample": False}` (the evaluation runner
always sends `temperature: 0`), and `temperature > 0` enables sampling with optional `top_p` and `seed`. A test pins the default.
Sampling on CUDA with a fixed seed is **not guaranteed bit-reproducible**, so the dataset's reproducibility comes from the logged
candidates (`summarize.candidates.jsonl`), not from re-generation. If you do not want the eval-path file touched, drop this diff
and summarize falls back to prompt variants under greedy decoding.

## 4. Input domains (fixed before generation)

Chosen by the builder as everyday topics, independent of the held-out set and of baseline results. 40 topics, cycled through a
seeded shuffle (`data_topics.TOPICS`):

1. composting kitchen scraps at home 2. a neighbourhood library changing its opening hours 3. learning to cook rice properly
4. commuting to work by bicycle 5. a community garden starting its season 6. saving money on weekly groceries
7. a local bakery opening a second shop 8. a city bus route being rescheduled 9. looking after houseplants indoors
10. a primary school science fair 11. household recycling rules 12. a weekend farmers market
13. screen time and sleep for teenagers 14. a power outage in a small town 15. a charity fun run
16. washing laundry with less water and energy 17. a public park being renovated 18. a family road trip across the country
19. a repair cafe where neighbours fix broken items 20. learning a musical instrument as an adult 21. birdwatching in a backyard
22. a town swimming pool reopening 23. baking bread at home 24. a lost-and-found service at a train station
25. neighbourhood noise rules 26. the history of a village clock tower 27. daily walking for health
28. renting a bicycle for a day 29. a library book sale 30. keeping winter heating costs down
31. planning a child's birthday party 32. a local football club's season 33. tea and coffee habits
34. a flood warning during heavy rain 35. volunteering at an animal shelter 36. a museum opening a new exhibit
37. buying a used car 38. an apartment building repairing its elevator 39. returning items bought online 40. a school lunch menu change

Genres (one per passage, seeded): a short news item; an explanatory paragraph; a notice to residents; a paragraph from a community
newsletter; a short blog-style paragraph; a description of a local service.
Each passage prompt also asks for four facts, drawn from fixed pools by the seed: a person (20 first names x 20 surnames), a date
(`Month D, YYYY`, 2018 to 2024), a count (12 to 480) and a percentage (5 to 90), written exactly like that. The model writes the
passage; code then checks the four facts are present verbatim. Passages are greedy-decoded, one paragraph of about 130 words.
Both tasks draw on the same pool, one passage per example, and no passage feeds both tasks: the passages that pass the filters
alternate between the two tasks (the first dry run let summarize consume the whole pool and left suggest_edits empty).

Known gap: all documents are single-paragraph everyday prose of 40 to 230 words. The held-out distribution was not inspected,
so any mismatch with it (length, register, structure) is unmeasured.

## 5. suggest_edits (programmatic labels; the model writes only the clean source text)

1. Take a passage that passes the passage filters (section 7). Choose a window of 3 to 6 consecutive sentences (40 to 150 words).
   The window must pass `clean_text_problems`.
2. Category (seeded shuffle, n = 30 gives 9 / 7 / 14): **none** (about 30%: document unchanged, gold `{"changes": []}`);
   **errors + one optional style edit** (about one third of the rest); **errors** (the remainder). 1 to 3 injected errors
   (weights 1:2:1 for 1, 2, 3), error kinds rotated, with a fallback to another kind when the text has no site for the wanted one.
3. Error kinds, each producing an exact inverse edit:
   - **typo**: a lower-case dictionary word of 5 to 12 letters becomes a non-word (swap, drop, double, neighbouring key). The result
     must not be in the system word lists (so `from` to `form` cannot happen). Those lists are the only vocabulary used.
   - **agreement**: only unambiguous subjects: `They/We are|were|have|do` to singular forms; `He/She/It is|has|does` to plural forms;
     `I am` to `I is`; `these|those|several|both|many <noun>s are|were|have|do` and `this|each|every <noun> is|was|has|does`, with
     collective and irregular nouns excluded. `She was` to `She were` is never produced (subjunctive).
   - **doubled**: a word is written twice (`had`, `that`, `is`, `very` and similar legitimate doubles are skipped).
   - **tense**: only in sentences with an explicit past anchor (`yesterday`, `last year`, `3 years ago`, `in 2019`) and no
     present/future marker; `was/were` become `is/are`, a plain past verb becomes `will <base>` (wrong for any subject, so no second error).
   - **style** (optional, restraint): a concise phrase becomes a wordy one (`because`, `to use`, `to start`, `before the`, `after the`, `now`, `many <plural>`, `every day`, `every|each week|month`);
     gold reverts it, stored in `reference.changes` with its index in `checks.optional_edits`. The scorer never penalises skipping it
     and never counts a targeted change there as spurious.
4. `original` is the corrupted token, widened by up to 3 neighbouring words until it occurs **exactly once** in the document
   (`scoring._find_span` takes the first match). `replacement` is the matching clean text. `location` is `sentence N`.
5. **Gates, all required to keep an example:** `original` found and unique; applying every gold change reproduces the clean window
   exactly; `scoring.score_example(ex, json.dumps(reference)).total == 1.0`; the empty answer `{"changes": []}` scores 0 when a
   required edit exists and 1 when none is needed.

What "no-edit" means and does not mean: the text passed spelling (dictionary), doubled-word, punctuation, markdown and preamble
filters. **Grammar is not verified.** Phi-4-mini may have written a grammatical slip that remains in a "no-edit" document, which would
make the gold wrong. Expect some of that until a human reads them.

## 6. summarize (rejection sampling from the base model)

1. Passage from section 4. `max_words` is drawn from {50, 60, 70} and kept below 75% of the passage length.
2. The prompt is `scoring.build_messages` for the example, unchanged. Sample **4** candidates (temperature 0.8, top_p 0.95,
   max 200 new tokens, seed = base seed x 1,000,003 + passage index x 16 + k).
3. Key facts are extracted **by code** (`data_filters.extract_facts`), not by a model: dates (`March 14, 2022`, `14 March 2022`,
   `March 2022`); numbers (digit strings outside dates, with an attached `%`/`percent`); names (runs of 2+ capitalised words with a
   sentence-initial ordinary word dropped, and single capitalised words that are not sentence-initial, not months or weekdays, and
   not ordinary dictionary words). A passage with more than 8 key facts is rejected at passage level.
4. Candidate filters, reported in this order (the first failing one is the primary reason; all failing ones are logged):
   `empty`, `truncated` (completion tokens reached the cap; the server always reports `stop`), `preamble` (`scoring.PREAMBLE`),
   `markdown_or_multiline`, `incomplete` (`scoring._complete`), `over_word_limit` (**strict**: no 25% grace, unlike the scorer),
   `not_shorter_than_source`, `missing_key_facts` (every extracted date, number and name must appear, matched with
   `scoring.contains_phrase`, so `14 March` equals `March 14` and `35%` equals `35 percent`, as at evaluation).
5. Among passing candidates keep **one**, chosen by the seeded RNG (not "first", so sample 0 is not favoured). Gate: the kept
   reference must score `scoring.score_example(...).total == 1.0`.
6. Passages with no passing candidate are dropped and counted. Reject counts by reason are in `report.json`.

Strictness choice to review: names and dates must be retained in full (a summary that says `Ortiz` for `Maya Ortiz`, or omits the
year, is rejected). That lowers yield but keeps the labels unambiguous.

## 7. Passage filters

`clean_text_problems` plus: 70 to 230 words, all four requested facts present verbatim, at most 8 key facts, not truncated.
`clean_text_problems` rejects non-ASCII (curly quotes are normalised first), preamble, markdown or lists, multiple paragraphs,
spacing or punctuation oddities, an existing doubled word, unbalanced quotes, an incomplete last sentence, a lower-case start,
and any lower-case or sentence-initial word not in the system word lists (`/usr/share/dict/words` plus `british-english`, a plural
fallback, and the builder's own name pool). This catches **spelling only**.

## 8. Overlap guard

`build_data.py` calls `check_overlap.assert_no_overlap` before writing the training files, and the finished file is checked with
`python3 scripts/doclm/check_overlap.py --train <file>` (exit 0 required; exit 1 means overlap). Rerun it on every build.

## 9. Dry run procedure

Start the server as in `RUN_BASELINE.md` step 3 (no `eval_runner.py`, no evaluation), run `build_data.py` with `--out` outside the repo
and a `dryrun` run id (capped at 30 per type), then stop the server and confirm the port is free. Nothing is trained.
