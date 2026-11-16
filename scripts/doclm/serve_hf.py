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
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--model-path", required=True)
    ap.add_argument("--adapter", help="optional PEFT/LoRA directory")
    ap.add_argument("--name", default="local")
    ap.add_argument("--port", type=int, default=8008)
    args = ap.parse_args()

    import torch  # imported late so --help works without the training env
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.model_path)
    model = AutoModelForCausalLM.from_pretrained(args.model_path, dtype=torch.bfloat16).cuda()
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
                "usage": {"prompt_tokens": n_in, "completion_tokens": int(out.shape[1] - n_in)},
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
