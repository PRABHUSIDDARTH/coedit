# Held-out set: review and freeze

File: `scripts/doclm/data/heldout.draft.jsonl` (50 tasks: 9 critique, 9 rewrite, 8 each of agents_md, architecture_md, summarize, suggest_edits).

**Provenance:** drafted by Claude in one pass and not yet reviewed by a human. That is acceptable for evaluation only. It must never be used for training, and Claude-written text must never go into docLM's training data either (see PLAN section 4).

## What to check (about 30-45 minutes)
1. **Reference answers are what you would accept.** Especially the 9 critique score vectors: they are one person's judgment, and `score_closeness` measures distance to them.
2. **`checks.must_include` / `must_not_include` are fair.** A correct answer phrased differently must not fail. Loosen any check that is too literal (for example exact numbers or phrases).
3. **Coverage.** The tasks are short (20-90 words) and plain English. Add harder, longer, messier cases if you want a tougher test; keep exactly 50.
4. **Self-consistency.** All 50 references already score 1.0 under `scoring.py` and none overlap the 10 seed examples (checked by script).

## Freeze
```bash
mv scripts/doclm/data/heldout.draft.jsonl scripts/doclm/data/heldout.jsonl
python3 scripts/doclm/eval_runner.py --freeze scripts/doclm/data/heldout.jsonl   # writes heldout.jsonl.sha256
git add scripts/doclm/data/heldout.jsonl scripts/doclm/data/heldout.jsonl.sha256 && git commit
```
After freezing, `eval_runner.py` refuses to run if the file changes. Before any training run, call `schema.check_no_overlap(train_examples, heldout_examples)`.

## Known limits
- Scoring is structural plus reference-based, so it rewards literal agreement. Hand-read 10 outputs per model.
- With 8-9 tasks per type, one task is 11-12 points of a row: treat small deltas as noise.
