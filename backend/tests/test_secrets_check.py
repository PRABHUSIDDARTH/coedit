"""`make secrets-check` (scripts/secrets_check.py) against throwaway git repos."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "secrets_check.py"
# Built at runtime so this file itself never contains a key-shaped string.
FAKE_KEY = "sk-" + "ant-api03-" + "PLANTEDFAKEKEY0123456789abcdefABCDEF"
FAKE_GROQ = "gsk_" + "PLANTEDFAKEKEY0123456789"
FAKE_PEM = "-----BEGIN " + "RSA PRIVATE KEY-----"


def run(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
    }
    return subprocess.run(  # noqa: S603
        args, cwd=repo, env=env, capture_output=True, text=True, check=False
    )


def git(repo: Path, *args: str) -> None:
    done = run(repo, "git", *args)
    assert done.returncode == 0, done.stderr


def check(repo: Path) -> subprocess.CompletedProcess[str]:
    return run(repo, sys.executable, str(SCRIPT), "--repo", str(repo))


def commit(repo: Path, files: dict[str, str], message: str = "c") -> None:
    for name, content in files.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", message)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q")
    commit(tmp_path, {"README.md": "hello\n", ".env.example": "APP_SECRET=\n"})
    return tmp_path


def test_clean_repo_passes(repo: Path) -> None:
    done = check(repo)
    assert done.returncode == 0, done.stderr
    assert "OK" in done.stdout


@pytest.mark.parametrize(
    "secret", [FAKE_KEY, FAKE_GROQ, "nvapi-" + "A1b2C3d4E5f6G7h8I9j0K1l2", "nct_" + "A" * 32]
)
def test_planted_secret_fails_the_check_without_echoing_it(repo: Path, secret: str) -> None:
    commit(repo, {"backend/tests/test_x.py": f'TOKEN = "{secret}"\n'})
    done = check(repo)
    assert done.returncode == 1
    assert "backend/tests/test_x.py:1" in done.stderr
    assert secret not in done.stdout + done.stderr


def test_google_key_and_private_key_header_fail(repo: Path) -> None:
    commit(repo, {"a.txt": "k = AIza" + "SyD" + "x" * 32 + "\n", "b.txt": FAKE_PEM + "\n"})
    done = check(repo)
    assert done.returncode == 1
    assert "a.txt:1" in done.stderr and "b.txt:1" in done.stderr


def test_marker_comment_allowlists_only_that_line(repo: Path) -> None:
    commit(
        repo,
        {
            "t.py": f'OK = "{FAKE_KEY}"  # fake-secret-ok\nBAD = "{FAKE_GROQ}"\n',
        },
    )
    done = check(repo)
    assert done.returncode == 1
    assert "t.py:2" in done.stderr and "t.py:1" not in done.stderr
    assert "history" in done.stderr  # the unmarked line is also caught in history

    commit(repo, {"t.py": f'OK = "{FAKE_KEY}"  # fake-secret-ok\n'}, "fix")
    # the bad line is still in history: a secret removed later is still leaked
    assert check(repo).returncode == 1


def test_marked_fixture_passes_in_tree_and_history(repo: Path) -> None:
    commit(repo, {"t.py": f'OK = "{FAKE_KEY}"  # fake-secret-ok\n'})
    done = check(repo)
    assert done.returncode == 0, done.stderr


def test_path_allowlist_file(repo: Path) -> None:
    commit(repo, {"fixtures/keys.txt": FAKE_KEY + "\n"})
    assert check(repo).returncode == 1
    commit(repo, {".secrets-allowlist": "# fakes\nfixtures/*.txt\n"}, "allow")
    done = check(repo)
    assert done.returncode == 0, done.stderr


def test_secret_removed_from_the_tree_is_still_found_in_history(repo: Path) -> None:
    commit(repo, {"cfg.py": f'KEY = "{FAKE_KEY}"\n'})
    commit(repo, {"cfg.py": "KEY = ''\n"}, "remove")
    done = check(repo)
    assert done.returncode == 1
    assert "history" in done.stderr and "cfg.py" in done.stderr
    assert FAKE_KEY not in done.stderr


@pytest.mark.parametrize(
    "name", [".env", ".env.local", "backend/.env", "certs/server.pem", "k/id_rsa", "x.key"]
)
def test_tracked_env_and_key_files_fail(repo: Path, name: str) -> None:
    commit(repo, {name: "nothing secret-looking\n"})
    done = check(repo)
    assert done.returncode == 1
    assert "tracked" in done.stderr and name in done.stderr


def test_env_example_is_fine_and_untracked_env_is_ignored(repo: Path) -> None:
    (repo / ".env").write_text(f"KEY={FAKE_KEY}\n")  # untracked: not scanned
    assert check(repo).returncode == 0


def test_makefile_target_exists_and_is_part_of_lint() -> None:
    makefile = (ROOT / "Makefile").read_text()
    assert "\nsecrets-check:\n\tpython3 scripts/secrets_check.py" in makefile
    lint = makefile.split("\nlint:\n", 1)[1].split("\n\n", 1)[0]
    assert "secrets-check" in lint


def test_this_repo_is_clean() -> None:
    done = check(ROOT)
    assert done.returncode == 0, done.stderr
