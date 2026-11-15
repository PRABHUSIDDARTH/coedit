"""Blob storage behind one interface (`StorageBackend`).

Two backends: `local` (default; a volume, content-addressed by sha256: a file is named by the hash
of its bytes, never by anything a user supplied, so an upload can neither choose its path nor
overwrite another file; identical content is stored once) and `nexuscloud`
(`services/nexuscloud.py`; selected with STORAGE_BACKEND). Each `file_versions` row records the
backend that holds it, so switching the setting never strands older versions.
"""

import hashlib
import os
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.config import get_settings

CHUNK = 1024 * 1024
_KEY = re.compile(r"^[0-9a-f]{64}$")


class TooLarge(Exception):
    """The upload exceeded the configured size limit."""


class StorageMissing(Exception):
    """The backend has no object for this key."""


class StorageError(Exception):
    """A backend failed. The message is only a status code: never a body, URL or token."""

    def __init__(self, status: int | None = None) -> None:
        self.status = status
        super().__init__(f"storage backend error (status {status if status else 'none'})")


@dataclass(frozen=True)
class Stored:
    key: str
    size: int
    sha256: str
    backend: str


class _Readable(Protocol):
    async def read(self, size: int = -1) -> bytes: ...


class StorageBackend(Protocol):
    name: str
    # True when different uploads can share a key (content addressing): never delete such a key
    # just because one upload was abandoned.
    shared_keys: bool

    async def put(self, source: _Readable, max_bytes: int) -> Stored:
        """Store the stream. Raises TooLarge past `max_bytes` (nothing is left behind) or
        StorageError."""
        ...

    async def get(self, key: str) -> AsyncIterator[bytes]:
        """Open the object. Raises StorageMissing / StorageError before returning; iterating
        yields its bytes."""
        ...

    async def delete(self, key: str) -> None:
        """Remove the object. Deleting something already gone is not an error."""
        ...


def _root() -> Path:
    return Path(get_settings().blob_dir)


def blob_path(key: str) -> Path:
    if not _KEY.fullmatch(key):
        raise ValueError("invalid storage key")
    return _root() / key[:2] / key


class LocalBackend:
    name = "local"
    shared_keys = True

    async def put(self, source: _Readable, max_bytes: int) -> Stored:
        """Stream `source` to disk, keyed by its sha256. Raises TooLarge past `max_bytes` and
        leaves nothing behind in that case."""
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
            os.replace(
                tmp, final
            )  # atomic; same content gives the same file, so overwriting is safe
            return Stored(key, size, key, self.name)
        finally:
            tmp.unlink(missing_ok=True)

    async def get(self, key: str) -> AsyncIterator[bytes]:
        path = blob_path(key)
        if not path.is_file():
            raise StorageMissing

        async def chunks() -> AsyncIterator[bytes]:
            with path.open("rb") as handle:
                while chunk := handle.read(CHUNK):
                    yield chunk

        return chunks()

    async def delete(self, key: str) -> None:
        blob_path(key).unlink(missing_ok=True)


_instances: dict[str, StorageBackend] = {}


def backend_named(name: str) -> StorageBackend:
    """The backend that holds an existing version. Unknown or unconfigured names raise StorageError."""
    if name not in _instances:
        if name == "local":
            _instances[name] = LocalBackend()
        elif name == "nexuscloud":
            settings = get_settings()
            if not (settings.nexuscloud_base_url and settings.nexuscloud_token.get_secret_value()):
                raise StorageError
            from app.services.nexuscloud import NexusCloudBackend

            _instances[name] = NexusCloudBackend(
                settings.nexuscloud_base_url,
                settings.nexuscloud_token.get_secret_value(),
                allow_private=settings.nexuscloud_allow_private,
            )
        else:
            raise StorageError
    return _instances[name]


def get_backend() -> StorageBackend:
    """The backend new uploads go to."""
    return backend_named(get_settings().storage_backend)


async def save_stream(source: _Readable, max_bytes: int) -> Stored:
    return await get_backend().put(source, max_bytes)


async def save_bytes(data: bytes) -> Stored:
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


async def discard(stored: Stored) -> None:
    """Best-effort removal of an object whose database row was never committed."""
    backend = backend_named(stored.backend)
    if backend.shared_keys:
        return
    try:
        await backend.delete(stored.key)
    except Exception:  # noqa: BLE001,S110  (cleanup must not mask the original failure)
        pass
