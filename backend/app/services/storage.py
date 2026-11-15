"""Blob storage on a local volume, content-addressed by sha256.

Files are named by the hash of their bytes, never by anything a user supplied, so an upload
can neither choose its path nor overwrite another file; identical content is stored once.
Swap this module to move blobs to object storage.
"""

import hashlib
import os
import re
import uuid
from pathlib import Path
from typing import Protocol

from app.config import get_settings

CHUNK = 1024 * 1024
_KEY = re.compile(r"^[0-9a-f]{64}$")


class TooLarge(Exception):
    """The upload exceeded the configured size limit."""


class _Readable(Protocol):
    async def read(self, size: int = -1) -> bytes: ...


def _root() -> Path:
    return Path(get_settings().blob_dir)


def blob_path(key: str) -> Path:
    if not _KEY.fullmatch(key):
        raise ValueError("invalid storage key")
    return _root() / key[:2] / key


async def save_stream(source: _Readable, max_bytes: int) -> tuple[str, int]:
    """Stream `source` to disk, returning (sha256 hex, size). Raises TooLarge past `max_bytes`
    and leaves nothing behind in that case."""
    tmp_dir = _root() / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = tmp_dir / uuid.uuid4().hex
    digest = hashlib.sha256()
    size = 0
    try:
        with tmp.open("wb") as out:
            while chunk := await source.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise TooLarge
                digest.update(chunk)
                out.write(chunk)
        key = digest.hexdigest()
        final = blob_path(key)
        final.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp, final)  # atomic; same content gives the same file, so overwriting is safe
        return key, size
    finally:
        tmp.unlink(missing_ok=True)


async def save_bytes(data: bytes) -> tuple[str, int]:
    """Store in-memory content (used for generated files such as council output)."""

    class _Once:
        def __init__(self) -> None:
            self.done = False

        async def read(self, size: int = -1) -> bytes:
            if self.done:
                return b""
            self.done = True
            return data

    return await save_stream(_Once(), max_bytes=len(data))
