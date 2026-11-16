"""serve_hf.check_weights: pure file checks, no torch, no GPU, never starts a server."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import serve_hf


def make_model(d: Path, shard_bytes: int = 1000, total: int = 2000, partial: bool = False) -> None:
    for n in serve_hf.NEEDED:
        (d / n).write_text("{}")
    (d / "model.safetensors.index.json").write_text(
        json.dumps(
            {
                "metadata": {"total_size": total},
                "weight_map": {"a": "m-1.safetensors", "b": "m-2.safetensors"},
            }
        )
    )
    for n in ("m-1.safetensors", "m-2.safetensors"):
        (d / n).write_bytes(b"x" * shard_bytes)
    if partial:
        (d / ".cache" / "huggingface" / "download").mkdir(parents=True)
        (d / ".cache" / "huggingface" / "download" / "x.incomplete").write_bytes(b"x")


class CheckWeightsTests(unittest.TestCase):
    def test_complete(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            make_model(Path(d))
            self.assertEqual(serve_hf.check_weights(d), [])

    def test_missing_dir_missing_shard_short_shards_and_partials(self) -> None:
        self.assertTrue(serve_hf.check_weights("/definitely/not/here"))
        with tempfile.TemporaryDirectory() as d:
            make_model(Path(d))
            (Path(d) / "m-2.safetensors").unlink()
            self.assertTrue(any("missing weight shard" in p for p in serve_hf.check_weights(d)))
        with tempfile.TemporaryDirectory() as d:
            make_model(Path(d), shard_bytes=400)  # 800 of 2000
            self.assertTrue(any("incomplete" in p for p in serve_hf.check_weights(d)))
        with tempfile.TemporaryDirectory() as d:
            make_model(Path(d), partial=True)
            self.assertTrue(any("partial" in p for p in serve_hf.check_weights(d)))

    def test_resume_command_is_valid_shell(self) -> None:
        import subprocess

        self.assertEqual(
            subprocess.run(["bash", "-n", "-c", serve_hf.RESUME_CMD], check=False).returncode, 0
        )


if __name__ == "__main__":
    unittest.main()
