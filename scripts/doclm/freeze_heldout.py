#!/usr/bin/env python3
"""Freeze the reviewed held-out set. ONE-SHOT: run it once, after you have reviewed the tasks.

  python3 scripts/doclm/freeze_heldout.py

What it does:
  1. validates data/heldout.draft.jsonl (schema, exactly 50 tasks, >= 8 per task type, all split=heldout)
  2. copies it to data/heldout.v1.jsonl and marks that file read-only (0444)
  3. writes the sha256 to docs/doclm/HELDOUT_HASH.txt (and a bare-hash sidecar
     data/heldout.v1.jsonl.sha256, which eval_runner.py verifies before every real run)
It REFUSES to overwrite an existing heldout.v1.jsonl or hash file. If the set must change, create
heldout.v2.jsonl deliberately and re-run the baseline; never edit v1.
Afterwards, commit: git add -f scripts/doclm/data/heldout.v1.jsonl{,.sha256} docs/doclm/HELDOUT_HASH.txt
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import stat
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from eval_runner import check_heldout_shape
from schema import SchemaError, read_jsonl

REPO = HERE.parent.parent


def freeze(src: Path, dst: Path, hash_file: Path, sidecar: Path | None = None) -> str:
    for p in [dst, hash_file] + ([sidecar] if sidecar else []):
        if p.exists():
            raise SchemaError(
                f"refusing to overwrite existing {p.name}: a frozen set is never replaced"
            )
    if not src.exists():
        raise SchemaError(f"{src.name} not found")
    exs = read_jsonl(src)  # raises on any schema problem, never echoing content
    check_heldout_shape(exs)
    sha = hashlib.sha256(src.read_bytes()).hexdigest()
    shutil.copyfile(src, dst)
    if hashlib.sha256(dst.read_bytes()).hexdigest() != sha:
        dst.unlink()
        raise SchemaError("copy does not match source; aborted")
    os.chmod(dst, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)  # 0444
    hash_file.parent.mkdir(parents=True, exist_ok=True)
    hash_file.write_text(
        f"{sha}  {dst.name}\nfrozen: {date.today().isoformat()}\ntasks: {len(exs)}\n"
        "rule: never used for training; any change means a new file (v2) and a new baseline\n",
        encoding="utf-8",
    )
    if sidecar:
        sidecar.write_text(sha + "\n", encoding="utf-8")
        os.chmod(sidecar, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    return sha


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--src", default=str(HERE / "data" / "heldout.draft.jsonl"))
    ap.add_argument("--dst", default=str(HERE / "data" / "heldout.v1.jsonl"))
    ap.add_argument("--hash-file", default=str(REPO / "docs" / "doclm" / "HELDOUT_HASH.txt"))
    args = ap.parse_args()
    dst = Path(args.dst)
    try:
        sha = freeze(
            Path(args.src), dst, Path(args.hash_file), dst.with_suffix(dst.suffix + ".sha256")
        )
    except (SchemaError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"frozen {dst.name} sha256={sha} (read-only)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
