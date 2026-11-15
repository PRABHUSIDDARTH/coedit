"""Shared request/response field types."""

from typing import Annotated

from pydantic import StringConstraints

# Display names for workspaces, folders and files: trimmed, non-empty.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
