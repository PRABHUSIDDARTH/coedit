"""Raw-reply saving in eval_runner (<label>.outputs.jsonl). Model-free: a local fake
OpenAI-compatible HTTP server on 127.0.0.1 stands in for the model. unittest-style: runs under
pytest or `python3 -m unittest discover -s scripts/doclm/tests`."""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import eval_runner
import make_seed_data
from schema import read_jsonl, write_jsonl
from scoring import build_messages, score_example, summarize_scores

N_TASKS = 10  # seed.jsonl-style data written by make_seed_data.build()


def fake_reply(system: str, user: str) -> str:
    """Deterministic in the request alone (not in arrival order), with awkward whitespace and
    non-ASCII text that must survive the round trip exactly."""
    base = eval_runner._stub_reply(system, user)
    tag = hashlib.sha256((system + user).encode()).hexdigest()[:6]
    return f'{base}\r\n  trailing é中\U0001f600 "q" \\ {tag}  \n\n'


class _Fake(BaseHTTPRequestHandler):
    with_usage = True
    fail_after: int | None = None  # answer HTTP 500 once this many requests were served
    served = 0

    def do_POST(self) -> None:
        cls = type(self)
        n = int(self.headers.get("Content-Length", "0"))
        req = json.loads(self.rfile.read(n))
        cls.served += 1
        if cls.fail_after is not None and cls.served > cls.fail_after:
            self.send_response(500)
            self.end_headers()
            return
        m = req["messages"]
        body = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": fake_reply(m[0]["content"], m[1]["content"]),
                    },
                    "finish_reason": "stop",
                }
            ]
        }
        if cls.with_usage:
            body["usage"] = {"prompt_tokens": 11, "completion_tokens": 7}
        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_a: object) -> None:
        return


class SavedOutputsTests(unittest.TestCase):
    def setUp(self) -> None:
        _Fake.with_usage, _Fake.fail_after, _Fake.served = True, None, 0
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), _Fake)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base_url = f"http://127.0.0.1:{self.srv.server_address[1]}/v1"
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.data = self.d / "seed.jsonl"
        write_jsonl(self.data, make_seed_data.build()[:N_TASKS])
        self.exs = read_jsonl(self.data)

    def tearDown(self) -> None:
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def run_cli(self, out_dir: Path, *extra: str, label: str = "t") -> tuple[int, str, str]:
        argv = [
            "eval_runner.py",
            "--data", str(self.data),
            "--base-url", self.base_url,
            "--model", "fake-model",
            "--label", label,
            "--out-dir", str(out_dir),
            "--max-tokens", "256",
            "--timeout", "10",
            *extra,
        ]  # fmt: skip
        out, err = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(sys, "argv", argv),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            rc = eval_runner.main()
        return rc, out.getvalue(), err.getvalue()

    @staticmethod
    def lines(path: Path) -> list[dict]:
        text = path.read_text(encoding="utf-8")
        return [json.loads(ln) for ln in text.split("\n") if ln]

    def test_one_line_per_task_with_raw_text_and_metadata(self) -> None:
        out = self.d / "r"
        rc, stdout, _ = self.run_cli(out, "--max-tokens", "300")  # last --max-tokens wins
        self.assertEqual(rc, 0)
        recs = self.lines(out / "t.outputs.jsonl")
        self.assertEqual([r["id"] for r in recs], [e.id for e in self.exs])  # task order kept
        self.assertEqual(len(recs), N_TASKS)
        for i, (r, ex) in enumerate(zip(recs, self.exs, strict=True)):
            msgs = build_messages(ex)
            self.assertEqual(r["reply"], fake_reply(msgs[0]["content"], msgs[1]["content"]))
            self.assertEqual(r["index"], i)
            self.assertEqual(r["task"], ex.task)
            self.assertEqual(r["finish_reason"], "stop")
            self.assertEqual((r["prompt_tokens"], r["completion_tokens"]), (11, 7))
            self.assertIsNone(r["error"])
            self.assertIsInstance(r["latency_s"], float)
            self.assertGreaterEqual(r["latency_s"], 0.0)
            self.assertEqual(
                r["settings"],
                {"model": "fake-model", "temperature": 0, "max_tokens": 300, "timeout_s": 10.0},
            )
            self.assertEqual(r["data_sha256"], eval_runner.sha256_file(self.data))
        # whitespace and non-ASCII are preserved exactly (no strip, no newline normalisation)
        self.assertTrue(recs[0]["reply"].endswith("  \n\n"))
        self.assertIn("\r\n", recs[0]["reply"])
        self.assertIn("中\U0001f600", recs[0]["reply"])
        self.assertIn(str(out / "t.outputs.jsonl"), stdout)

    def test_missing_usage_gives_null_token_counts(self) -> None:
        _Fake.with_usage = False
        out = self.d / "r"
        self.assertEqual(self.run_cli(out)[0], 0)
        for r in self.lines(out / "t.outputs.jsonl"):
            self.assertIsNone(r["prompt_tokens"])
            self.assertIsNone(r["completion_tokens"])
            self.assertEqual(r["finish_reason"], "stop")

    def test_request_error_is_recorded_with_empty_reply(self) -> None:
        _Fake.fail_after = N_TASKS - 2  # the last two requests fail
        out = self.d / "r"
        rc, _, _ = self.run_cli(out)
        self.assertEqual(rc, 1)  # unchanged: request errors still make the run invalid
        recs = self.lines(out / "t.outputs.jsonl")
        self.assertEqual(len(recs), N_TASKS)
        self.assertEqual([r["error"] for r in recs[-2:]], ["http_500", "http_500"])
        self.assertEqual([r["reply"] for r in recs[-2:]], ["", ""])
        self.assertIsNone(recs[0]["error"])

    def test_partial_file_survives_a_mid_run_failure(self) -> None:
        out = self.d / "r"
        calls = {"n": 0}
        real = eval_runner.score_example

        def boom(ex, reply):  # type: ignore[no-untyped-def]
            calls["n"] += 1
            if calls["n"] == 4:
                raise RuntimeError("simulated crash while scoring task 4")
            return real(ex, reply)

        with mock.patch.object(eval_runner, "score_example", boom), self.assertRaises(RuntimeError):
            self.run_cli(out)
        recs = self.lines(out / "t.outputs.jsonl")  # every line complete and parseable
        # the reply of the task being scored is saved BEFORE scoring, so 4 lines exist
        self.assertEqual([r["id"] for r in recs], [e.id for e in self.exs[:4]])
        self.assertFalse((out / "t.json").exists())  # no scored output for the crashed run
        # and the crashed run's file is now protected from a silent overwrite
        rc, _, err = self.run_cli(out)
        self.assertEqual(rc, 2)
        self.assertIn("refusing to overwrite", err)
        self.assertEqual(len(self.lines(out / "t.outputs.jsonl")), 4)

    def test_existing_outputs_file_is_never_overwritten(self) -> None:
        out = self.d / "r"
        out.mkdir()
        keep = out / "t.outputs.jsonl"
        keep.write_text("KEEP ME\n", encoding="utf-8")
        before = _Fake.served
        rc, _, err = self.run_cli(out)
        self.assertEqual(rc, 2)
        self.assertIn("refusing to overwrite", err)
        self.assertIn(str(keep), err)
        self.assertEqual(keep.read_text(encoding="utf-8"), "KEEP ME\n")
        self.assertEqual(_Fake.served, before)  # refused before any request was sent
        self.assertFalse((out / "t.json").exists())
        self.assertFalse((out / "t.md").exists())

    def test_scores_identical_with_and_without_saving(self) -> None:
        a, b = self.d / "with", self.d / "without"
        self.assertEqual(self.run_cli(a)[0], 0)
        self.assertEqual(self.run_cli(b, "--no-save-outputs")[0], 0)
        self.assertTrue((a / "t.outputs.jsonl").exists())
        self.assertFalse((b / "t.outputs.jsonl").exists())
        for name in ("t.json", "t.md"):
            self.assertEqual((a / name).read_bytes(), (b / name).read_bytes(), name)
        # and both equal what the scorer gives for the same replies, computed directly
        res = json.loads((a / "t.json").read_text(encoding="utf-8"))
        scores = []
        for ex in self.exs:
            m = build_messages(ex)
            scores.append(score_example(ex, fake_reply(m[0]["content"], m[1]["content"])))
        self.assertEqual(res["summary"], summarize_scores(scores))
        self.assertEqual([i["total"] for i in res["items"]], [s.total for s in scores])
        self.assertEqual([i["items"] for i in res["items"]], [s.items for s in scores])

    def test_saved_replies_rescore_to_the_run_results(self) -> None:
        out = self.d / "r"
        self.assertEqual(self.run_cli(out)[0], 0)
        res = json.loads((out / "t.json").read_text(encoding="utf-8"))
        for r, ex, item in zip(
            self.lines(out / "t.outputs.jsonl"), self.exs, res["items"], strict=True
        ):
            s = score_example(ex, r["reply"])
            self.assertEqual((s.total, s.items), (item["total"], item["items"]))

    def test_outputs_dir_option_and_default_location(self) -> None:
        out, elsewhere = self.d / "r", self.d / "elsewhere"
        self.assertEqual(self.run_cli(out, "--outputs-dir", str(elsewhere))[0], 0)
        self.assertTrue((elsewhere / "t.outputs.jsonl").exists())
        self.assertFalse((out / "t.outputs.jsonl").exists())
        self.assertTrue((out / "t.json").exists())
        out2 = self.d / "r2"
        self.assertEqual(self.run_cli(out2)[0], 0)  # default: next to the results
        self.assertTrue((out2 / "t.outputs.jsonl").exists())

    def test_dry_run_never_writes_an_outputs_file_and_stays_repeatable(self) -> None:
        out = self.d / "r"
        for _ in range(2):  # a second dry run must not hit the "never overwrite" refusal
            argv = ["eval_runner.py", "--dry-run", "--data", str(self.data), "--out-dir", str(out)]
            with (
                mock.patch.object(sys, "argv", argv),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(eval_runner.main(), 0)
        self.assertEqual(list(out.glob("*.outputs.jsonl")), [])
        self.assertTrue((out / "dry-run.json").exists())

    def test_chat_still_returns_the_two_tuple(self) -> None:
        ep = eval_runner.Endpoint(self.base_url, "fake-model", None, 10)
        text, err = ep.chat(
            [{"role": "system", "content": "TASK: x"}, {"role": "user", "content": "u"}], 8
        )
        self.assertEqual(err, None)
        self.assertEqual(text, fake_reply("TASK: x", "u"))


if __name__ == "__main__":
    unittest.main()
