#!/usr/bin/env python3
"""Run a docLM eval set against any OpenAI-compatible /chat/completions endpoint.

Standard library only. Never prints or logs the API key (read from an env var; the var NAME is
the only thing ever shown). HTTP failures report the status code only, never the body.

  # no model needed (starts a local stub server; numbers are NOT a model measurement):
  python3 scripts/doclm/eval_runner.py --dry-run

  # real endpoint, e.g. Ollama on this machine (no key):
  python3 scripts/doclm/eval_runner.py --data scripts/doclm/data/heldout.jsonl \
      --base-url http://localhost:11434/v1 --model llama3.1:8b-instruct-q4_K_M --label base

  # freeze the held-out file (writes <file>.sha256; later runs refuse a changed file):
  python3 scripts/doclm/eval_runner.py --freeze scripts/doclm/data/heldout.jsonl

  # base vs docLM table:
  python3 scripts/doclm/eval_runner.py --compare results/base.json results/doclm.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema import STRICT_JSON_TASKS, TASKS, Example, SchemaError, read_jsonl  # noqa: E402
from scoring import Score, build_messages, score_example, summarize_scores  # noqa: E402

HERE = Path(__file__).resolve().parent
HELDOUT_TOTAL = 50
HELDOUT_MIN_PER_TASK = 8


# ---------------------------------------------------------------- held-out freezing


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def freeze(path: Path) -> Path:
    exs = read_jsonl(path)
    check_heldout_shape(exs)
    sha = path.with_suffix(path.suffix + ".sha256")
    sha.write_text(sha256_file(path) + "\n", encoding="utf-8")
    return sha


def check_heldout_shape(exs: list[Example], *, allow_small: bool = False) -> None:
    if any(e.split != "heldout" for e in exs):
        raise SchemaError("held-out file must contain only split=heldout records")
    if allow_small:
        return
    if len(exs) != HELDOUT_TOTAL:
        raise SchemaError(f"held-out set must have exactly {HELDOUT_TOTAL} tasks, has {len(exs)}")
    for t in TASKS:
        if sum(e.task == t for e in exs) < HELDOUT_MIN_PER_TASK:
            raise SchemaError(f"held-out set needs at least {HELDOUT_MIN_PER_TASK} {t} tasks")


def verify_frozen(path: Path) -> None:
    sha = path.with_suffix(path.suffix + ".sha256")
    if not sha.exists():
        raise SchemaError("held-out file is not frozen: run --freeze first")
    if sha.read_text(encoding="utf-8").strip() != sha256_file(path):
        raise SchemaError("held-out file changed since it was frozen")


# ---------------------------------------------------------------- client


class Endpoint:
    def __init__(self, base_url: str, model: str, key_env: str | None, timeout: float):
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.timeout = timeout
        # Read once; never stored anywhere that is printed.
        self._key = os.environ.get(key_env) if key_env else None

    def chat(self, messages: list[dict[str, str]], max_tokens: int) -> tuple[str, str | None]:
        """Return (reply_text, error_label). error_label never contains a response body."""
        body = json.dumps({
            "model": self.model, "messages": messages, "temperature": 0, "max_tokens": max_tokens,
        }).encode()
        headers = {"Content-Type": "application/json"}
        if self._key:
            headers["Authorization"] = f"Bearer {self._key}"
        req = urllib.request.Request(self.url, data=body, headers=headers, method="POST")  # noqa: S310
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:  # noqa: S310
                data = json.loads(r.read())
            return str(data["choices"][0]["message"]["content"] or ""), None
        except urllib.error.HTTPError as e:
            return "", f"http_{e.code}"
        except (urllib.error.URLError, TimeoutError, OSError):
            return "", "unreachable"
        except (KeyError, IndexError, TypeError, json.JSONDecodeError):
            return "", "bad_response_shape"


# ---------------------------------------------------------------- stub server (--dry-run)


def _stub_reply(system: str, user: str) -> str:
    task = system.split("\n", 1)[0].removeprefix("TASK: ").strip()
    if task == "critique":
        ids = [ln[2:].split(" ", 1)[0] for ln in user.splitlines() if ln.startswith("- ")]
        return json.dumps({"scores": dict.fromkeys(ids, 3), "rationale": "Stub reply."})
    if task == "suggest_edits":
        return json.dumps({"changes": []})
    if task == "agents_md":
        return "# AGENTS.md\n\n## Stack\nunknown\n\n## Commands\nunknown\n"
    if task == "architecture_md":
        return "# ARCHITECTURE.md\n\n## Overview\nunknown\n\n## Components\nunknown\n"
    return "Stub reply."


class _Stub(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        n = int(self.headers.get("Content-Length", "0"))
        req = json.loads(self.rfile.read(n))
        msgs = req["messages"]
        out = _stub_reply(msgs[0]["content"], msgs[1]["content"])
        payload = json.dumps({"choices": [{"message": {"role": "assistant", "content": out}}]})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload.encode())

    def log_message(self, *_a: Any) -> None:  # silence request logging
        return


def start_stub() -> tuple[ThreadingHTTPServer, str]:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)  # port 0: OS picks a free port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/v1"


# ---------------------------------------------------------------- report


def render_table(label: str, summary: dict[str, dict[str, Any]], note: str = "") -> str:
    lines = [f"# Eval results: {label}", ""]
    if note:
        lines += [note, ""]
    lines += [
        "| task | n | mean score (0-1) | JSON-valid rate (strict) | JSON-valid if unfenced | fenced |",
        "|---|---|---|---|---|---|",
    ]
    for t in TASKS:
        if t in summary:
            r = summary[t]
            jv = f"{r['json_valid_rate']:.0%}" if "json_valid_rate" in r else "n/a"
            jl = f"{r['json_valid_lenient_rate']:.0%}" if "json_valid_lenient_rate" in r else "n/a"
            lines.append(
                f"| {t} | {r['n']} | {r['mean']:.3f} | {jv} | {jl} | {r.get('fenced_rate', 0):.0%} |"
            )
    return "\n".join(lines) + "\n"


def render_compare(base: dict[str, Any], tuned: dict[str, Any]) -> str:
    lines = [
        f"# Base vs docLM ({base['label']} vs {tuned['label']})", "",
        "| task | n | base | docLM | delta | base JSON-valid | docLM JSON-valid |",
        "|---|---|---|---|---|---|---|",
    ]
    for t in TASKS:
        b, d = base["summary"].get(t), tuned["summary"].get(t)
        if not b or not d:
            continue
        jb = f"{b['json_valid_rate']:.0%}" if "json_valid_rate" in b else "n/a"
        jd = f"{d['json_valid_rate']:.0%}" if "json_valid_rate" in d else "n/a"
        lines.append(
            f"| {t} | {b['n']} | {b['mean']:.3f} | {d['mean']:.3f} | {d['mean'] - b['mean']:+.3f} "
            f"| {jb} | {jd} |"
        )
    if base.get("data_sha256") != tuned.get("data_sha256"):
        lines += ["", "WARNING: the two runs used different data files; the comparison is invalid."]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- main


def run(args: argparse.Namespace) -> int:
    data = Path(args.data)
    exs = read_jsonl(data)
    if any(e.split == "heldout" for e in exs):
        check_heldout_shape(exs, allow_small=args.allow_small)
        if not args.dry_run:
            verify_frozen(data)
    srv = None
    if args.dry_run:
        srv, base_url = start_stub()
        model, key_env, label = "stub", None, args.label or "dry-run"
        note = "**DRY RUN against a local stub server. These numbers are not a model measurement.**"
    else:
        if not args.base_url or not args.model:
            print("error: --base-url and --model are required (or use --dry-run)", file=sys.stderr)
            return 2
        base_url, model, key_env, label = args.base_url, args.model, args.api_key_env, args.label
        note = f"Endpoint model id: `{model}`. Data: `{data.name}`."
        if not label:
            print("error: --label is required (e.g. base, doclm)", file=sys.stderr)
            return 2
    ep = Endpoint(base_url, model, key_env, args.timeout)
    scores: list[Score] = []
    errors: dict[str, int] = {}
    try:
        for ex in exs:
            reply, err = ep.chat(build_messages(ex), args.max_tokens)
            if err:
                errors[err] = errors.get(err, 0) + 1
            s = score_example(ex, reply)
            if err:
                s.note = err
            scores.append(s)
    finally:
        if srv:
            srv.shutdown()
            srv.server_close()
    summary = summarize_scores(scores)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {
        "label": label, "model": model, "dry_run": bool(args.dry_run), "data": data.name,
        "data_sha256": sha256_file(data), "errors": errors, "summary": summary,
        "items": [
            {"id": s.id, "task": s.task, "total": s.total, "json_valid": s.json_valid,
             "json_valid_lenient": s.json_valid_lenient, "fenced": s.fenced,
             "items": s.items, "note": s.note}
            for s in scores
        ],
    }
    (out_dir / f"{label}.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    table = render_table(label, summary, note)
    if errors:
        table += f"\nRequest errors (counts by status label): {json.dumps(errors)}\n"
    (out_dir / f"{label}.md").write_text(table, encoding="utf-8")
    print(table)
    print(f"wrote {out_dir / (label + '.md')} and {out_dir / (label + '.json')}")
    return 0 if not errors else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--data", default=str(HERE / "data" / "seed.jsonl"))
    ap.add_argument("--base-url", help="e.g. http://localhost:11434/v1")
    ap.add_argument("--model")
    ap.add_argument("--api-key-env", default=None, help="NAME of the env var holding the key")
    ap.add_argument("--label", help="name for the results files, e.g. base or doclm")
    ap.add_argument("--out-dir", default=str(HERE / "results"))
    ap.add_argument("--max-tokens", type=int, default=1024)
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--dry-run", action="store_true", help="use a local stub server, no model")
    ap.add_argument("--allow-small", action="store_true", help="skip the 50-task shape check")
    ap.add_argument("--freeze", metavar="HELDOUT_JSONL", help="write the sha256 freeze file")
    ap.add_argument("--compare", nargs=2, metavar=("BASE_JSON", "DOCLM_JSON"))
    args = ap.parse_args()
    try:
        if args.freeze:
            print(f"froze: {freeze(Path(args.freeze))}")
            return 0
        if args.compare:
            a, b = (json.loads(Path(p).read_text(encoding="utf-8")) for p in args.compare)
            print(render_compare(a, b))
            return 0
        return run(args)
    except (SchemaError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
