#!/usr/bin/env python3
"""Fail if the repo (tracked files or git history) contains something that looks like a secret.

Checks, all in one run (exit 1 on any finding, 0 otherwise; stdlib only):
  1. tracked files must not include .env files or key files (.pem, .key, id_rsa, ...);
  2. tracked file contents must not match the secret patterns below;
  3. every line ever added on any ref must not match them either (a secret removed later is
     still leaked), and no such file may ever have been committed.

Allowlist (for obviously fake test fixtures):
  - a line containing the marker `fake-secret-ok` (put it in a comment on that line), or
  - a path glob in `.secrets-allowlist` at the repo root (fnmatch, one per line, `#` comments).
Findings print the location and the kind of pattern, never the matched text.

Usage: python3 scripts/secrets_check.py [--repo PATH]
"""

import argparse
import fnmatch
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

MARKER = "fake-secret-ok"
ALLOWLIST_FILE = ".secrets-allowlist"

PATTERNS: dict[str, re.Pattern[str]] = {
    "OpenAI/Anthropic-style key (sk-...)": re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}"),
    "Google API key (AIza...)": re.compile(r"(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}"),
    "Groq key (gsk_...)": re.compile(r"(?<![A-Za-z0-9])gsk_[A-Za-z0-9]{20,}"),
    "NVIDIA key (nvapi-...)": re.compile(r"(?<![A-Za-z0-9])nvapi-[A-Za-z0-9_-]{20,}"),
    "NexusCloud token (nct_...)": re.compile(r"(?<![A-Za-z0-9])nct_[A-Za-z0-9]{20,}"),
    "private key header": re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----"),
}

ENV_SAFE = {".env.example", ".env.sample", ".env.template"}
KEY_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk")
KEY_NAMES = {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"}


def git(repo: Path, *args: str) -> bytes:
    done = subprocess.run(  # noqa: S603
        ["git", "-C", str(repo), *args],  # noqa: S607
        capture_output=True,
        check=False,
    )
    if done.returncode != 0:
        sys.exit(f"secrets-check: git {args[0]} failed: {done.stderr.decode(errors='replace')[:200]}")
    return done.stdout


def forbidden_file(path: str) -> str | None:
    name = PurePosixPath(path).name
    if name == ".env" or (name.startswith(".env.") and name not in ENV_SAFE):
        return "environment file"
    if name in KEY_NAMES or name.lower().endswith(KEY_SUFFIXES):
        return "key file"
    return None


def load_allowlist(repo: Path) -> list[str]:
    file = repo / ALLOWLIST_FILE
    if not file.is_file():
        return []
    lines = (ln.split("#", 1)[0].strip() for ln in file.read_text().splitlines())
    return [ln for ln in lines if ln]


def line_hits(line: str) -> list[str]:
    if MARKER in line:
        return []
    return [kind for kind, pattern in PATTERNS.items() if pattern.search(line)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent))
    repo = Path(parser.parse_args().repo).resolve()
    allow = load_allowlist(repo)

    def allowed(path: str) -> bool:
        return any(fnmatch.fnmatch(path, glob) for glob in allow)

    findings: list[str] = []

    tracked = [p for p in git(repo, "ls-files", "-z").decode().split("\0") if p]
    for path in tracked:
        if kind := forbidden_file(path):
            findings.append(f"tracked {kind}: {path}")
    for path in tracked:
        file = repo / path
        if allowed(path) or not file.is_file() or file.is_symlink():
            continue
        data = file.read_bytes()
        if b"\0" in data:
            continue
        for number, line in enumerate(data.decode(errors="replace").splitlines(), 1):
            findings += [f"{path}:{number}: {kind}" for kind in line_hits(line)]

    # History: every added line on every ref, and every path ever added.
    names = git(repo, "log", "--all", "--diff-filter=A", "--name-only", "--format=", "-z")
    for path in sorted({p for p in names.decode(errors="replace").split("\0") if p.strip()}):
        if kind := forbidden_file(path):
            findings.append(f"{kind} committed in history: {path}")
    log = git(repo, "log", "--all", "-p", "-U0", "--no-color", "--format=COMMIT %h")
    commit, path, commits = "?", "", 0
    for raw in log.decode(errors="replace").splitlines():
        if raw.startswith("COMMIT "):
            commit, path, commits = raw[7:], "", commits + 1
        elif raw.startswith("+++ "):
            path = raw[6:] if raw.startswith("+++ b/") else ""
        elif raw.startswith("+") and path and not allowed(path):
            findings += [f"history {commit} {path}: {kind}" for kind in line_hits(raw[1:])]

    if findings:
        print("secrets-check: FAILED", file=sys.stderr)
        for finding in dict.fromkeys(findings):
            print(f"  {finding}", file=sys.stderr)
        print(
            f"Remove the secret (and rotate it), or mark an obviously fake fixture with "
            f"`{MARKER}` on its line / a glob in {ALLOWLIST_FILE}.",
            file=sys.stderr,
        )
        return 1
    print(f"secrets-check: OK ({len(tracked)} tracked files, {commits} commits scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
