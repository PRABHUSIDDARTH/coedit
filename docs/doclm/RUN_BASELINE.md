# Run the docLM baseline yourself (no Claude needed)

Copy-paste runbook: freeze the held-out set, commit it, serve the base model, score it, write `BASELINE.md`, stop the server.
**This file was written from the scripts' source without running any of the commands.** Numbers marked "~" come from the
earlier smoke tests recorded in `PROGRESS.md`; yours may differ slightly. Everything runs from the repo root, on the branch you are on
(`git branch --show-current`).

Fixed settings (do not change them; the docLM run later must use the same ones): base model Phi-4-mini-instruct, bf16 on the GPU,
greedy decoding (`do_sample=False`), `max_new_tokens` 1024, the tokenizer's chat template, prompts from `scoring.build_messages`.
Rules: the held-out set is never used for training or prompt tuning; do not edit the scorer or prompts after you have seen baseline numbers;
run the baseline once.

## 0. Preflight (2 minutes)

```bash
cd /home/psTech/psTech/coedit
git branch --show-current
git status --short                      # expect exactly the two uncommitted docLM files:
                                        #  M docs/doclm/SCORING.md
                                        #  M scripts/doclm/data/heldout.draft.jsonl
python3 -m unittest discover -s scripts/doclm/tests 2>&1 | tail -4     # expect "Ran 76 tests ... OK" (count may grow)
df -h / | tail -1                       # need several GB free; the root disk was once 100% full
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv       # expect NVIDIA GeForce RTX 5070, little memory used
~/doclm-env/bin/python scripts/doclm/serve_hf.py --model-path ~/doclm-models/Phi-4-mini-instruct --check-only
                                        # expect: weights OK: /home/psTech/doclm-models/Phi-4-mini-instruct   (exit 0)
```
If any of these fail, jump to **Troubleshooting** before continuing.

## 1. Check the draft is committed (already done for v1)

The final scorer and held-out edits were merged to `main` (PRs #5 to #8) before the freeze, so there are no uncommitted
docLM files to commit. Freezing copies the draft, so the draft you freeze must be the committed one. Check:

```bash
git status --short                      # expect only the owner's untracked docs (docs/RAG_PLAN.md, docs/SECURITY_GOVERNANCE.md)
```
The v1 freeze has been run (step 2 below, sha256 `2e010fe5...e6da`); do not run it again.

## 2. Freeze (one-shot, cannot be undone)

Only after you have reviewed the tasks (`docs/doclm/HELDOUT_REVIEW.md`).

```bash
python3 scripts/doclm/freeze_heldout.py
```
Expected, one line, exit 0:
```
frozen heldout.v1.jsonl sha256=<64 hex characters> (read-only)
```
Created: `scripts/doclm/data/heldout.v1.jsonl` (mode 0444), `scripts/doclm/data/heldout.v1.jsonl.sha256`, `docs/doclm/HELDOUT_HASH.txt`.

### Hash check (all four values must be identical)
```bash
cd /home/psTech/psTech/coedit
sha256sum scripts/doclm/data/heldout.v1.jsonl scripts/doclm/data/heldout.draft.jsonl | cut -c1-64
cat scripts/doclm/data/heldout.v1.jsonl.sha256
head -1 docs/doclm/HELDOUT_HASH.txt | cut -c1-64
stat -c '%a' scripts/doclm/data/heldout.v1.jsonl        # expect 444
wc -l < scripts/doclm/data/heldout.v1.jsonl             # expect 50
```
Success = the first four hashes match (v1, draft, sidecar, HELDOUT_HASH.txt), mode 444, 50 lines.
Failure modes:
- `error: refusing to overwrite existing heldout.v1.jsonl: a frozen set is never replaced` (exit 1): it was already frozen. Do not delete it to retry; verify the hash instead.
- `error: held-out set must have exactly 50 tasks, has N` / `needs at least 8 <task> tasks` / `only split=heldout records`: fix the draft, commit that (step 1), then freeze.
- `error: ... SchemaError text` for a bad record: fix the draft record named by the message, commit, retry. Nothing was written if it fails.

### Commit the frozen files
`scripts/doclm/data/` is un-ignored by `scripts/doclm/.gitignore`, but `-f` is harmless and the repo root ignores `data/`:
```bash
git add -f scripts/doclm/data/heldout.v1.jsonl scripts/doclm/data/heldout.v1.jsonl.sha256 docs/doclm/HELDOUT_HASH.txt
git commit -m "doclm: freeze held-out v1"
git status --short                      # expect empty
```

## 3. Start the model server (terminal 1, or background as below)

```bash
cd /home/psTech/psTech/coedit
nohup ~/doclm-env/bin/python scripts/doclm/serve_hf.py \
  --model-path ~/doclm-models/Phi-4-mini-instruct --name phi4-mini-base --port 8008 \
  > /tmp/doclm-serve.log 2>&1 &
echo $! > /tmp/doclm-serve.pid
until grep -q '^serving ' /tmp/doclm-serve.log; do
  kill -0 "$(cat /tmp/doclm-serve.pid)" 2>/dev/null || { echo "SERVER DIED:"; cat /tmp/doclm-serve.log; break; }
  sleep 2
done
cat /tmp/doclm-serve.log
```
Expected log (about 2 to 60 s; the first load after a reboot is slower than the ~1.5 s measured with a warm file cache):
```
weights OK: /home/psTech/doclm-models/Phi-4-mini-instruct
{"load_seconds": ~1.5, "device": "cuda:0", "gpu": "NVIDIA GeForce RTX 5070", "capability": [12, 0], "param_dtype": "torch.bfloat16", "torch": "2.15.0+cu132", "cuda_build": "13.2", "vram_allocated_mib": ~7300-7500}
serving phi4-mini-base on http://127.0.0.1:8008/v1
```
Success = `device` is `cuda:0`, `param_dtype` is `torch.bfloat16`, last line starts with `serving`. The server prints nothing per request (by design:
request bodies may be private). Peak VRAM is ~7.9 GiB (of 12).

Quick sanity request (should return JSON with a short reply in `choices[0].message.content`, ~1 to 3 s):
```bash
curl -s http://127.0.0.1:8008/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi in three words."}],"max_tokens":16}' | head -c 400; echo
```

## 4. Run the baseline (terminal 2 or the same one)

```bash
cd /home/psTech/psTech/coedit
python3 scripts/doclm/eval_runner.py \
  --data scripts/doclm/data/heldout.v1.jsonl \
  --base-url http://127.0.0.1:8008/v1 --model phi4-mini-base \
  --label base --max-tokens 1024 --timeout 300 2>&1 | tee /tmp/doclm-baseline.out
echo "eval exit code: ${PIPESTATUS[0]}"
```
It sends the 50 tasks one at a time and prints nothing until the end: expect roughly 10 to 25 minutes at ~68 tokens/s greedy. Watch progress with
`watch -n 5 nvidia-smi` (GPU utilisation should stay high). Do not interrupt it. `--timeout 300` only raises the per-request wait; it does not change outputs.

Expected end of output:
```
# Eval results: base

Endpoint model id: `phi4-mini-base`. Data: `heldout.v1.jsonl`.

| task | n | mean score (0-1) | JSON-valid rate (strict) | JSON-valid if unfenced | fenced |
|---|---|---|---|---|---|
| <six task rows, n adding up to 50> |
wrote .../scripts/doclm/results/base.md and .../scripts/doclm/results/base.json
eval exit code: 0
```

Raw replies: the run also writes every reply to `scripts/doclm/results/base.outputs.jsonl`, one line per task, flushed as it goes (so a crash keeps the partial file).
It never overwrites: a rerun with the same label stops with an error until you move or delete that file. `results/` is gitignored, so **copy `base.json`, `base.md`
and `base.outputs.jsonl` to `~/doclm-results-backup/base-<date>/` after the run** (and before deleting `base.*` for a rerun). `--no-save-outputs` turns it off; `--dry-run` never writes it.

### Success or failure
Success needs ALL of:
- exit code `0`, no `Request errors (counts by status label)` line, no `DRY RUN` note;
- six task rows, `n` sums to 50;
- `base.json` records the frozen hash and no errors:
```bash
python3 - <<'EOF'
import json
r = json.load(open("scripts/doclm/results/base.json"))
frozen = open("scripts/doclm/data/heldout.v1.jsonl.sha256").read().strip()
print("errors:", r["errors"], "| dry_run:", r["dry_run"], "| items:", len(r["items"]))
print("hash matches frozen:", r["data_sha256"] == frozen)
assert r["errors"] == {} and not r["dry_run"] and len(r["items"]) == 50 and r["data_sha256"] == frozen
print("BASELINE RUN OK")
EOF
```
Failure:
- exit `1` + `Request errors ...`: some requests failed (timeouts, connection reset, server crashed). The numbers are NOT a valid baseline. Check the server is still alive
  (`kill -0 $(cat /tmp/doclm-serve.pid)`; `tail /tmp/doclm-serve.log`), fix the cause (see Troubleshooting), delete `scripts/doclm/results/base.*`, rerun step 4.
- exit `2` with `error: held-out file is not frozen: run --freeze first` or `held-out file changed since it was frozen`: the data file or its `.sha256` is wrong.
  Never edit v1. Restore it: `git checkout -- scripts/doclm/data/heldout.v1.jsonl scripts/doclm/data/heldout.v1.jsonl.sha256`, redo the hash check.
- exit `2` with `--base-url and --model are required` / `--label is required`: a typo in the command.

## 5. Write BASELINE.md

No script writes it; this assembles it from the run (still in the repo root, server still running so its load line is in the log):
```bash
cd /home/psTech/psTech/coedit
{
  echo "# docLM baseline: Phi-4-mini-instruct (no fine-tuning)"
  echo
  echo "- date: $(date -I)"
  echo "- repo commit: $(git rev-parse --short HEAD)"
  echo "- held-out set: heldout.v1.jsonl, sha256 $(cat scripts/doclm/data/heldout.v1.jsonl.sha256)"
  echo "- model: microsoft/Phi-4-mini-instruct, weights index sha256 $(sha256sum ~/doclm-models/Phi-4-mini-instruct/model.safetensors.index.json | cut -c1-16)..."
  echo "- settings: bf16, greedy (do_sample=False), max_new_tokens 1024, tokenizer chat template, scoring.build_messages prompts, served by scripts/doclm/serve_hf.py"
  echo "- server load line: \`$(grep '^{"load_seconds' /tmp/doclm-serve.log)\`"
  echo "- scorer rules: docs/doclm/SCORING.md (unchanged since the freeze)"
  echo
  cat scripts/doclm/results/base.md
  echo
  echo "Caveat: the scorer checks structure and required content, not writing quality; read some outputs yourself. Single run, greedy."
} > docs/doclm/BASELINE.md
head -20 docs/doclm/BASELINE.md        # check it looks right
git add docs/doclm/BASELINE.md
git add -f scripts/doclm/results/base.json scripts/doclm/results/base.md    # results/ is gitignored; keep the raw record
git commit -m "doclm: baseline for Phi-4-mini-instruct on held-out v1"
```

## 6. Stop the server

```bash
kill "$(cat /tmp/doclm-serve.pid)" && sleep 3
kill -0 "$(cat /tmp/doclm-serve.pid)" 2>/dev/null && echo "still running: kill -9 $(cat /tmp/doclm-serve.pid)" || echo "server stopped"
rm -f /tmp/doclm-serve.pid
nvidia-smi --query-gpu=memory.used --format=csv     # should drop back to the desktop's usage (a few hundred MiB)
ss -ltn | grep :8008 || echo "port 8008 free"
```
(If you ran it in a foreground terminal, press Ctrl-C there.)

## Troubleshooting

### Weights missing or incomplete (`serve_hf.py` exits 3, "NOT started")
It lists what is wrong (`missing file`, `missing weight shard`, `weights incomplete: X GB of about 7.7 GB`, `N partial download file(s) (*.incomplete)`).
The first download stopped at about 4.3 of 7.7 GB. The download is resumable; the resume command below is the same one `serve_hf.py` prints.
It sets `HF_HUB_DISABLE_XET=1`, which switches Hugging Face downloads from the newer Xet transfer backend to plain HTTP, and a longer timeout.
Our record shows the Xet-backed download stalled partway and that this setting is what we resumed with; the exact error text was not kept.
```bash
cd ~ && HF_HUB_DISABLE_XET=1 HF_HUB_DOWNLOAD_TIMEOUT=120 ~/doclm-env/bin/python -c 'from huggingface_hub import snapshot_download as d; print(d("microsoft/Phi-4-mini-instruct", local_dir="/home/psTech/doclm-models/Phi-4-mini-instruct", allow_patterns=["*.safetensors","*.json","merges.txt","LICENSE","NOTICE.md","README.md"]))'
```
Run it again if it stops (it continues from the partial files), then rerun the `--check-only` command from step 0. Also check `df -h /` (a full disk also truncates downloads),
and that `~/doclm-models/Phi-4-mini-instruct/.cache` has no `*.incomplete` files left after success.
Phi-4-mini-instruct is MIT-licensed and ungated: no token is needed. Do not paste a token anywhere for this.

### GPU not usable (`serve_hf.py` exits 4: "torch.cuda.is_available() is False; refusing to run on CPU")
The server refuses to fall back to CPU on purpose. Check in order:
```bash
nvidia-smi                                                        # must list the RTX 5070; if it errors, the driver is not loaded (reboot, or reinstall the driver)
~/doclm-env/bin/python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
# expect: 2.15.0+cu132 13.2 True NVIDIA GeForce RTX 5070
```
- Use `~/doclm-env/bin/python`, not `python3` (system Python has no torch/CUDA build). The card is Blackwell (sm_120); it needs the cu132 torch build in that env.
- `is_available()` False with a working `nvidia-smi` usually means a torch build without CUDA support or a driver/runtime mismatch: re-check the `+cu132` suffix.
- After suspend/resume or a driver update CUDA can fail until a reboot.
- A warning about the GPU architecture (sm_120) from torch means the wrong torch build; the smoke tests earlier ran without kernel errors on this env.

### Out of memory while loading
You need about 8 GiB free of the 12 GiB. Another process holds VRAM:
```bash
nvidia-smi                      # look at the process list
ollama ps                       # Ollama keeps models loaded; free it with: ollama stop <model>
```
Close GPU-heavy apps (browsers with hardware acceleration can hold a few hundred MiB; that is fine).

### Port already in use (`Address already in use`)
```bash
ss -ltnp | grep 8008            # an old server? kill it by PID
```
or pick another port: `--port 8009` in step 3 and `--base-url http://127.0.0.1:8009/v1` in step 4.

### Eval requests time out or the run is much slower than ~10 to 25 minutes
The GPU may be shared or throttled (`nvidia-smi` clocks, temperature). One request at a time is by design. Do not run anything else on the GPU during the baseline.
If a request times out the run ends with exit 1 and a `Request errors` line: rerun after fixing, results are not valid otherwise.

### The server died mid-run
`tail -30 /tmp/doclm-serve.log`. A CUDA out-of-memory on a long prompt means something else grew in VRAM; stop it and rerun from step 3. Delete the partial `results/base.*` first.

## What not to do
- Do not rerun `freeze_heldout.py` or edit `heldout.v1.jsonl`; a change means `heldout.v2.jsonl` and a new baseline.
- Do not train on, or tune prompts against, the held-out tasks. Before building training data run `python3 scripts/doclm/check_overlap.py --train <file>` (exit 1 means overlap).
- Do not report the baseline from a `--dry-run` or from the draft file; only `heldout.v1.jsonl` counts.
