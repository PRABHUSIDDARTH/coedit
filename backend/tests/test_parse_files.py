"""council.prompts.parse_files: outer code fences and stray closing fences."""

from app.council import prompts

AGENTS = "# AGENTS.md\n\n## Stack\nPython\n"
ARCH = "# ARCHITECTURE.md\n\n## Overview\nA web app.\n"


def reply(*, agents: str = AGENTS, arch: str = ARCH) -> str:
    return f"=== FILE: AGENTS.md ===\n{agents}=== FILE: ARCHITECTURE.md ===\n{arch}"


def test_unfenced_reply_is_unchanged() -> None:
    assert prompts.parse_files(reply()) == {"AGENTS.md": AGENTS, "ARCHITECTURE.md": ARCH}


def test_reply_wrapped_in_a_markdown_fence() -> None:
    fenced = "```markdown\n" + reply() + "```"
    files = prompts.parse_files(fenced)
    assert files == {"AGENTS.md": AGENTS, "ARCHITECTURE.md": ARCH}
    assert "```" not in files["ARCHITECTURE.md"]  # no stray closing fence in the last file


def test_reply_wrapped_in_a_plain_fence_with_blank_lines_and_spaces() -> None:
    fenced = "\n  ```\n" + reply().rstrip("\n") + "\n```  \n\n"
    assert prompts.parse_files(fenced) == {"AGENTS.md": AGENTS, "ARCHITECTURE.md": ARCH}


def test_stray_closing_fence_when_the_opening_fence_is_not_at_the_start() -> None:
    text = "Here are the files:\n```markdown\n" + reply() + "```\n"
    files = prompts.parse_files(text)
    assert files["ARCHITECTURE.md"] == ARCH
    assert files["AGENTS.md"] == AGENTS


def test_fences_inside_file_bodies_are_kept() -> None:
    agents = "# AGENTS.md\n\n```bash\nmake test\n```\n\nDone.\n"
    arch = (
        "# ARCHITECTURE.md\n\n```mermaid\ngraph TD\n```\n"  # last file ends with a balanced block
    )
    assert prompts.parse_files(reply(agents=agents, arch=arch)) == {
        "AGENTS.md": agents,
        "ARCHITECTURE.md": arch,
    }


def test_fences_inside_bodies_survive_an_outer_fence_and_a_stray_one() -> None:
    agents = "# AGENTS.md\n\n```bash\nmake test\n```\n"
    arch = "# ARCHITECTURE.md\n\n```text\nA -> B\n```\n"
    wrapped = "```markdown\n" + reply(agents=agents, arch=arch) + "```"
    assert prompts.parse_files(wrapped) == {"AGENTS.md": agents, "ARCHITECTURE.md": arch}
    stray = reply(agents=agents, arch=arch) + "```\n"  # balanced block + one stray closer
    assert prompts.parse_files(stray) == {"AGENTS.md": agents, "ARCHITECTURE.md": arch}


def test_only_the_last_block_loses_a_stray_fence() -> None:
    first = "# AGENTS.md\n\nunbalanced:\n```\n"  # an earlier file is never edited
    assert prompts.parse_files(reply(agents=first)) == {"AGENTS.md": first, "ARCHITECTURE.md": ARCH}


def test_inline_triple_backticks_are_not_fences() -> None:
    arch = "# ARCHITECTURE.md\n\nUse ```inline``` code here.\n"
    assert prompts.parse_files(reply(arch=arch))["ARCHITECTURE.md"] == arch


def test_missing_markers_return_nothing() -> None:
    assert prompts.parse_files("no markers at all") == {}
    assert prompts.parse_files("```markdown\n# AGENTS.md\njust text\n```") == {}
    assert prompts.parse_files("```markdown\n=== FILE: agents.md ===\nx\n```") == {}  # exact names


def test_repeated_name_keeps_the_last_block_even_when_fenced() -> None:
    text = "```\n=== FILE: PRD.md ===\nfirst\n=== FILE: PRD.md ===\nsecond\n```"
    assert prompts.parse_files(text) == {"PRD.md": "second\n"}
