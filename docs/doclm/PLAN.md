# docLM plan

Status: planning and scaffolding only. Nothing was trained, downloaded or sent to any API.
Anything marked **(unverified)** is from memory or estimation, not checked in this session.

## 0. Measured hardware (read-only commands, 2026-11-16)

| Item | Result |
|---|---|
| GPU | NVIDIA GeForce RTX 5070, **12,227 MiB** VRAM (218 MiB used by the desktop), driver 595.99.02, CUDA 13.2 visible |
| OS | Native Ubuntu 24.04 (not WSL2, not Windows); `nvcc` not installed |
| RAM / CPU | 31 GiB, 8 GiB swap, 24 threads |
| Python / Ollama | 3.12.3 / 0.24.0 (one model present: `llama3.1:8b-instruct-q4_K_M`) |
| **Disk** | `/` is **100% full: 476 MB free of 937 GB** |

**Blocker:** training, merging and GGUF export need roughly 40-60 GB free **(estimate)**. Free disk first. The GPU is usable, so the training plan stays; the eval and data work below needs almost no space. RTX 50-series (Blackwell) needs a recent PyTorch/bitsandbytes build **(unverified)**; confirm with a 1-minute CUDA smoke test before anything else.

## 1. Goal and honest claim

docLM is a small local model tuned for Coedit's six document tasks. The only claim we will make: *on a frozen, human-written, held-out set of 50 tasks, docLM scores higher than its own untuned base model.* No claim of matching large hosted models.

## 2. Task types

Schemas live in `scripts/doclm/schema.py`; each example below is abbreviated.

| Task | Input | Output | Example |
|---|---|---|---|
| critique | `document`, `rubric[{id,description,max_score}]` | **strict JSON** `{"scores":{id:int},"rationale":"<=80 words"}` | rubric `clarity` 0..5 -> `{"scores":{"clarity":3},"rationale":"Repeats one claim."}` |
| rewrite | `passage`, `rubric` | rewritten passage only | "leverage synergy to action refunds" -> "We refund customers within five business days." |
| agents_md | `brief` | AGENTS.md (Stack, Commands, Conventions, Definition of done); "unknown" not invention | brief "FastAPI, `pytest -q`" -> file with those commands |
| architecture_md | `brief` | ARCHITECTURE.md (Overview, Components, Data flow, Decisions, Risks) | brief "form -> API -> Postgres" -> file |
| summarize | `document`, `max_words` | summary within the limit | 60-word notice, 25 words max -> 2 sentences |
| suggest_edits | `document` | **strict JSON** `{"changes":[{location,original,replacement,reason}]}`; `original` copied verbatim | "the the invoice" -> change to "the invoice" |

## 3. Model size choice

Mapping (QLoRA = 4-bit NF4 base + LoRA; all VRAM figures are **estimates, unverified**; batch 1, gradient checkpointing, bf16 compute):

| Free VRAM | Base size | Max seq | LoRA r / alpha | Notes |
|---|---|---|---|---|
| 8 GB | 3-4B | 2048 | 16 / 32 | ~6-7 GB |
| **12 GB (this machine)** | 3-4B comfortable; 7-8B tight | 2048 (4B), 1024-2048 (8B) | 16 / 32 | 8B ~10-11.5 GB; may OOM on long briefs |
| 16 GB | 7-8B | 2048-4096 | 16-32 | |
| 24 GB | 7-14B | 4096 | 32 / 64 | |

Candidates (ids from memory, **verify on the hub before use**; newer open models may exist that I did not check):

| Candidate | Licence (unverified) | Fine-tune OK? | Use | ~QLoRA VRAM |
|---|---|---|---|---|
| `microsoft/Phi-4-mini-instruct` (~3.8B) | MIT | yes | commercial and research | 6-8 GB |
| `Qwen/Qwen2.5-7B-Instruct` | Apache-2.0 | yes | commercial and research | 10-12 GB |
| `meta-llama/Llama-3.1-8B-Instruct` | Llama 3.1 Community Licence (gated; attribution, naming rule, usage policy, user cap) | yes, with conditions | commercial with conditions | 10-12 GB |

**Recommendation:** start with the ~4B candidate to prove the pipeline on 12 GB, then try a 7-8B only if the baseline leaves headroom. Qwen 3B is under a different licence than Qwen 7B **(unverified)**; check per size.

## 4. Data sourcing (training use must be permitted)

**Hard rule:** no Claude, GPT or Gemini outputs in training data until you confirm their terms allow it. **Also excluded: this repo's own AGENTS.md, ARCHITECTURE.md, PROGRESS.md and README.md, because they appear to have been written with Claude's help** (confirm authorship).

| Option | Licence/terms | Volume | Risk |
|---|---|---|---|
| Hand-written seeds by you | yours | 100-300 | slow; cheapest and cleanest; **all 50 held-out tasks must be this** |
| Public-domain text (e.g. Project Gutenberg) as rewrite/summarize/critique sources | public domain (verify per work) | thousands of passages | needs labels; style is old |
| Permissive public datasets | check each dataset card; accept MIT/Apache/CC0/CC-BY only | unknown | licence drift, hidden synthetic-LLM content **(unverified)**; share-alike (CC-BY-SA) is unclear for weights, so avoid |
| READMEs/AGENTS.md from MIT/Apache/BSD repos | per-repo licence | hundreds | filter per repo; needs a download step later (your approval) |
| Synthetic from a local open-weights model | model licence must allow output use for training (Apache-2.0 likely; Llama 3.1 terms **unverified**) | 1-3k | teacher bias, noisy labels, circular gains if teacher = base family; run locally via Ollama |

Target for a first run: ~150 hand-written + ~1,000 filtered synthetic, all with `source` provenance recorded per line.

## 5. Training approach

- Start: r=16, alpha=32, dropout 0.05, all linear layers, lr 2e-4 cosine, warmup 3%, 2-3 epochs, effective batch 16 (micro-batch 1 x accumulate 16), max seq 2048, paged AdamW 8-bit, loss on assistant tokens only, bf16.
- Time on this GPU: roughly **1-4 hours** for ~1,000 examples, 3 epochs, 4-8B **(estimate; unmeasured)**.
- Checkpoint every 100 steps, keep the last 3 (adapters are small), seed fixed, `resume_from_checkpoint` on restart. Checkpoints live on a disk that is not full.
- Stop early if the validation loss (a train-split slice, never the held-out set) rises for 2 evals.

## 6. Evaluation

- **Held-out:** 50 hand-written tasks (9 critique, 9 rewrite, 8 agents_md, 8 architecture_md, 8 summarize, 8 suggest_edits), each with a human reference. Freeze with `eval_runner.py --freeze`; the runner refuses a changed file. `check_no_overlap` blocks id or input overlap with training data.
- **Scoring (programmatic, `scoring.py`):** JSON validity (strict: no code fences or prose), rubric-id match and range, closeness to human scores, section coverage, length limits, verbatim-grounded edits, required/forbidden phrases. These are structural checks, **not writing quality**; also hand-review 10 outputs per model.
- **Baseline first:** run the untuned base through the same endpoint (Ollama or any OpenAI-compatible server) **before any training**; save `results/base.json`.
- **Report:** `--compare base.json doclm.json` prints a per-task table (n, base, docLM, delta, JSON-valid rate). With 8-9 items per task, small deltas are noise.

## 7. Export and use

1. Merge the LoRA into the fp16 base; 2. convert with llama.cpp `convert_hf_to_gguf.py`; 3. quantize (e.g. Q4_K_M) **(needs a llama.cpp build; cmake, no `nvcc` needed for CPU quantize)**; 4. write a `Modelfile` (`FROM ./doclm.gguf`, chat template from the base model, `PARAMETER temperature 0`); 5. `ollama create doclm -f Modelfile`; 6. rerun `eval_runner.py` against `http://localhost:11434/v1` with model `doclm`.

In Coedit: Council seat with preset **Ollama (local)** (`http://host.docker.internal:11434/v1`, no key), model `doclm`, a price you set. Needs `COUNCIL_ALLOW_LOCAL_PROVIDERS=1` in `.env`, then `docker compose up -d api`. Ollama must listen beyond loopback for the container to reach it (`OLLAMA_HOST=0.0.0.0` or the docker bridge address) **(unverified on this host)**.

> **Security:** `COUNCIL_ALLOW_LOCAL_PROVIDERS=1` disables the SSRF guard (any host, any address). Keep it **off** on any hosted or multi-user deployment.

## 8. Risks and unknowns (ranked)

1. **Disk full (476 MB).** Nothing downloads, trains or exports until fixed.
2. Training data licensing and provenance: Claude-written repo docs must stay out.
3. Held-out set does not exist yet; 50 hand-written tasks are the real effort (hours).
4. Blackwell GPU software support (PyTorch, bitsandbytes) unverified.
5. Gains may not appear: base may already do well, scorer is structural only, n is small.
6. Model ids, sizes and licences above are from memory.
7. Council use: Ollama reachability from Docker; model price entry.

**You must provide or decide:** free a disk of 60+ GB or name another one; confirm whether the repo's AGENTS/ARCHITECTURE files were Claude-written; approve downloading a base model and its licence; pick the base candidate; write (or approve time for) the 50 held-out tasks; say whether any hosted-model terms permit training use (default: no).
