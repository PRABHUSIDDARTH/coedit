#!/usr/bin/env python3
"""Tiny OpenAI-compatible /v1/chat/completions server over a local HF model (+ optional LoRA).

Why: base and docLM must be scored through the SAME serving path (same dtype, same chat template),
otherwise a bf16-vs-GGUF-quantisation difference would be mixed into the comparison. Needs the
training env (torch, transformers, peft); run it with ~/doclm-env/bin/python. Loopback only,
no auth, one request at a time. Never use on a shared host.

  ~/doclm-env/bin/python scripts/doclm/serve_hf.py --model-path ~/doclm-models/Phi-4-mini-instruct \
      --name phi4-mini-base --port 8008
  # after training:  ... --adapter <lora_dir> --name doclm
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Same command that fetched the weights; it resumes partial files. Run it in a separate terminal.
RESUME_CMD = (
    "cd ~ && HF_HUB_DISABLE_XET=1 HF_HUB_DOWNLOAD_TIMEOUT=120 ~/doclm-env/bin/python -c "
    "'from huggingface_hub import snapshot_download as d; "
    'print(d("microsoft/Phi-4-mini-instruct", local_dir="/home/psTech/doclm-models/Phi-4-mini-instruct", '
    'allow_patterns=["*.safetensors","*.json","merges.txt","LICENSE","NOTICE.md","README.md"]))\''
)
NEEDED = ("config.json", "tokenizer.json", "tokenizer_config.json", "model.safetensors.index.json")


def check_weights(path: str) -> list[str]:
    """Return a list of problems (empty = weights look complete). Stdlib only, no GPU, no network."""
    root = Path(path).expanduser()
    if not root.is_dir():
        return [f"directory not found: {root}"]
    problems = [f"missing file: {n}" for n in NEEDED if not (root / n).exists()]
    index = root / "model.safetensors.index.json"
    if index.exists():
        try:
            meta = json.loads(index.read_text())
            shards = sorted(set(meta["weight_map"].values()))
            expected = int(meta["metadata"]["total_size"])
        except (ValueError, KeyError, TypeError):
            return problems + ["model.safetensors.index.json is unreadable"]
        have = 0
        for sh in shards:
            f = root / sh
            if not f.exists():
                problems.append(f"missing weight shard: {sh}")
            else:
                have += f.stat().st_size
        if have < expected * 0.995:  # shard files carry small headers, so allow >= expected
            problems.append(f"weights incomplete: {have / 1e9:.2f} GB of about {expected / 1e9:.2f} GB")
    partial = list((root / ".cache").rglob("*.incomplete")) if (root / ".cache").exists() else []
    if partial:
        problems.append(f"{len(partial)} partial download file(s) (*.incomplete) still present")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--model-path", required=True)
    ap.add_argument("--adapter", help="optional PEFT/LoRA directory")
    ap.add_argument("--name", default="local")
    ap.add_argument("--port", type=int, default=8008)
    ap.add_argument("--check-only", action="store_true", help="verify the weights and exit")
    args = ap.parse_args()

    problems = check_weights(args.model_path)  # before importing torch: fast, no GPU needed
    if problems:
        print("docLM server NOT started: the base-model weights are missing or incomplete.", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print("\nResume the download in a separate terminal (it continues from the partial files):\n"
              f"  {RESUME_CMD}\n", file=sys.stderr)
        return 3
    print(f"weights OK: {args.model_path}", flush=True)
    if args.check_only:
        return 0

    import torch  # imported late so --help works without the training env
    from transformers import AutoModelForCausalLM, AutoTokenizer

    import time

    if not torch.cuda.is_available():  # never fall back to CPU silently
        print("ERROR: torch.cuda.is_available() is False; refusing to run on CPU. "
              f"torch={torch.__version__} cuda_build={torch.version.cuda}", file=sys.stderr)
        return 4
    t0 = time.perf_counter()
    tok = AutoTokenizer.from_pretrained(args.model_path)
    model = AutoModelForCausalLM.from_pretrained(args.model_path, dtype=torch.bfloat16).cuda()
    load_s = time.perf_counter() - t0
    p0 = next(model.parameters())
    print(json.dumps({
        "load_seconds": round(load_s, 1), "device": str(p0.device),
        "gpu": torch.cuda.get_device_name(0), "capability": list(torch.cuda.get_device_capability(0)),
        "param_dtype": str(p0.dtype), "torch": torch.__version__, "cuda_build": torch.version.cuda,
        "vram_allocated_mib": torch.cuda.memory_allocated() // 2**20,
    }), flush=True)
    if args.adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    lock = threading.Lock()

    class H(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            if not self.path.rstrip("/").endswith("/chat/completions"):
                self.send_error(404)
                return
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            max_new = int(req.get("max_tokens") or 1024)
            enc = tok.apply_chat_template(
                req["messages"], add_generation_prompt=True, return_tensors="pt", return_dict=True
            ).to("cuda")
            with lock, torch.inference_mode():
                out = model.generate(**enc, max_new_tokens=max_new, do_sample=False)
            n_in = enc["input_ids"].shape[1]
            text = tok.decode(out[0][n_in:], skip_special_tokens=True)
            body = json.dumps({
                "model": args.name,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                             "finish_reason": "stop"}],
                "usage": {"prompt_tokens": n_in, "completion_tokens": int(out.shape[1] - n_in),
                          "peak_vram_mib": torch.cuda.max_memory_allocated() // 2**20},
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_a: object) -> None:  # request bodies may be private documents
            return

    print(f"serving {args.name} on http://127.0.0.1:{args.port}/v1", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), H).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
