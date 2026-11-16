"""freeze_heldout.py is tested ONLY against temp files; the real freeze is the owner's to run."""

from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
DRAFT = HERE / "data" / "heldout.draft.jsonl"
V1 = HERE / "data" / "heldout.v1.jsonl"


def run(src: Path, dst: Path, hf: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(HERE / "freeze_heldout.py"),
            "--src",
            str(src),
            "--dst",
            str(dst),
            "--hash-file",
            str(hf),
        ],
        capture_output=True,
        text=True,
        check=False,
    )


class FreezeTests(unittest.TestCase):
    def test_freeze_copies_hashes_locks_and_refuses_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = Path(d, "heldout.draft.jsonl")
            src.write_bytes(DRAFT.read_bytes())
            dst, hf = Path(d, "heldout.v1.jsonl"), Path(d, "HELDOUT_HASH.txt")
            r = run(src, dst, hf)
            self.assertEqual(r.returncode, 0, r.stderr)
            sha = hashlib.sha256(src.read_bytes()).hexdigest()
            self.assertEqual(dst.read_bytes(), src.read_bytes())
            self.assertTrue(hf.read_text().startswith(sha))
            self.assertEqual(Path(d, "heldout.v1.jsonl.sha256").read_text().strip(), sha)
            self.assertEqual(stat.S_IMODE(os.stat(dst).st_mode), 0o444)
            # second run refuses and leaves everything untouched
            before = (dst.read_bytes(), hf.read_text())
            r2 = run(src, dst, hf)
            self.assertEqual(r2.returncode, 1)
            self.assertIn("refusing to overwrite", r2.stderr)
            self.assertEqual((dst.read_bytes(), hf.read_text()), before)

    def test_refuses_invalid_set_and_creates_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            src = Path(d, "small.jsonl")
            src.write_text("".join(DRAFT.read_text().splitlines(True)[:10]))  # only 10 tasks
            dst, hf = Path(d, "v1.jsonl"), Path(d, "HASH.txt")
            r = run(src, dst, hf)
            self.assertEqual(r.returncode, 1)
            self.assertFalse(dst.exists() or hf.exists())

    def test_frozen_file_is_accepted_by_eval_runner_verify(self) -> None:
        import eval_runner

        with tempfile.TemporaryDirectory() as d:
            src = Path(d, "heldout.draft.jsonl")
            src.write_bytes(DRAFT.read_bytes())
            dst = Path(d, "heldout.v1.jsonl")
            self.assertEqual(run(src, dst, Path(d, "H.txt")).returncode, 0)
            eval_runner.verify_frozen(dst)  # sidecar matches

    def test_real_v1_has_not_been_created_by_tests(self) -> None:
        # Tests must never freeze the real set. (Skips once the owner has frozen it.)
        if V1.exists():
            self.skipTest("owner has frozen the set")
        self.assertFalse(V1.exists())


if __name__ == "__main__":
    unittest.main()
