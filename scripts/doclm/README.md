# scripts/doclm

Offline scaffolding for **docLM** (see `docs/doclm/PLAN.md`). Python 3.12, standard library only:
no new dependencies, no downloads, no real API calls unless you point `eval_runner.py` at one.

Run everything from the repo root.

```bash
# 1. Write the 10 hand-written SEED examples (pipeline test data only, not held-out, not training)
python3 scripts/doclm/make_seed_data.py

# 2. Plumbing check with no model (local stub server; NOT a model measurement)
python3 scripts/doclm/eval_runner.py --dry-run

# 3. Tests (21). Either runner works:
python3 -m unittest discover -s scripts/doclm/tests -v
uv run --offline --no-project --with pytest python -m pytest -q scripts/doclm/tests   # if pytest is cached
```

## Measuring a real model (needs a running OpenAI-compatible server, e.g. Ollama)

```bash
# Freeze the held-out set once it has exactly 50 hand-written records (split="heldout"):
python3 scripts/doclm/eval_runner.py --freeze scripts/doclm/data/heldout.jsonl

# BASELINE FIRST, before any training:
python3 scripts/doclm/eval_runner.py --data scripts/doclm/data/heldout.jsonl \
  --base-url http://localhost:11434/v1 --model <base-model-tag> --label base

# After training/export (model registered in Ollama as "doclm"):
python3 scripts/doclm/eval_runner.py --data scripts/doclm/data/heldout.jsonl \
  --base-url http://localhost:11434/v1 --model doclm --label doclm

# Base vs docLM table:
python3 scripts/doclm/eval_runner.py --compare scripts/doclm/results/base.json scripts/doclm/results/doclm.json
```

For a hosted endpoint that needs a key, pass the NAME of an env var, never the key:
`export DOCLM_API_KEY=...` then `--api-key-env DOCLM_API_KEY`. The key is read in memory, sent only
as the `Authorization` header, and never printed or written. HTTP errors show the status code only.

## Data-build rule

Every script that writes training data must call `check_overlap.assert_no_overlap(examples)` before writing, or be followed by
`python3 scripts/doclm/check_overlap.py --train <file>` (exit 1 = overlap). `make_seed_data.py` already does.

## Files

| File | Purpose |
|---|---|
| `schema.py` | dataclasses for the six task inputs/outputs, `Example` record, JSONL reader/writer, `check_no_overlap` (train vs held-out) |
| `scoring.py` | prompts, strict reply parsing, programmatic scoring, per-task summary |
| `eval_runner.py` | runs a JSONL set against `/chat/completions`, writes `results/<label>.{md,json}`, `--freeze`, `--compare`, `--dry-run` |
| `make_seed_data.py` | writes `data/seed.jsonl` (10 hand-written seeds, `split="seed"`) |
| `check_overlap.py` | held-out leak guard: exact, normalized, 5-gram containment >= 0.40 |
| `freeze_heldout.py` | one-shot freeze of the reviewed held-out file (see docs/doclm/HELDOUT_REVIEW.md) |
| `serve_hf.py` | local OpenAI-compatible server over the HF weights (+ LoRA) for base/docLM scoring |
| `tests/test_doclm.py` | schema, scorer, runner, key-handling tests |

Data lines: `{"id","task","split":"seed|train|heldout","source","input":{...},"reference":{...},"checks":{...}}`.
`source` (provenance) is required so every training line can be audited for licence. Held-out
records must have a reference and must never be used for training or prompt tuning.

The scorer checks structure (valid JSON, sections, grounding, limits, required phrases), not writing
quality. Read some outputs yourself.
