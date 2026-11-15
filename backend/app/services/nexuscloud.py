"""NexusCloud storage backend (https://github.com/NexusCloud-Orchestra): REST API + presigned URLs.

Flow per operation, all with a NexusCloud *service token* (never a user password):
  put:    POST /api/v1/files/upload-request  -> presigned PUT; PUT the bytes there;
          POST /api/v1/files/confirm-upload/{id}. The returned file id is the storage key.
  get:    GET  /api/v1/files/download/{id}   -> presigned GET; stream it.
  delete: DELETE /api/v1/files/{id}.

Safety rules (see tests/test_nexuscloud_backend.py):
- The token goes only to the configured NexusCloud host, never to a presigned URL.
- Errors are reduced to a status code; bodies, URLs and exception text are never kept or logged.
- The base URL is checked at startup and again on every request (resolve, check all addresses,
  connect to the checked IP): https only and public addresses only, unless NEXUSCLOUD_ALLOW_PRIVATE.
  Presigned URLs get the same address check, may name any host, and carry no credentials.
- Redirects are never followed (a redirect could carry the token elsewhere).
Status: only exercised against a stub of the NexusCloud API; never against a real deployment.
"""

import hashlib
import logging
import re
import tempfile
from collections.abc import AsyncIterator
from urllib.parse import urlsplit

import httpx

from app.council.netguard import (
    GuardedTransport,
    Resolver,
    UnsafeURL,
    _host_port,
    system_resolver,
    validate_base_url,
)
from app.services.storage import (
    CHUNK,
    StorageError,
    StorageMissing,
    Stored,
    TooLarge,
    _Readable,
)

# httpx logs every request URL at INFO, and a presigned URL carries its signature in the query.
logging.getLogger("httpx").setLevel(logging.WARNING)

_FILE_ID = re.compile(r"^[0-9a-fA-F-]{32,40}$")
_OPAQUE_NAME = "coedit-blob"  # NexusCloud lists names; never send the user's filename or type
_OPAQUE_MIME = "application/octet-stream"
SPOOL_MEMORY = 8 * 1024 * 1024


def _check_url(url: str, *, allow_private: bool) -> None:
    """Scheme / credentials policy shared by the API base URL and presigned URLs."""
    try:
        scheme, _, _ = _host_port(url)
        parts = urlsplit(url)
    except UnsafeURL:
        raise StorageError from None
    if scheme != "https" and not allow_private:
        raise StorageError
    if parts.fragment:
        raise StorageError


class NexusCloudBackend:
    name = "nexuscloud"
    shared_keys = False

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        allow_private: bool = False,
        resolver: Resolver = system_resolver,
        inner: httpx.AsyncBaseTransport | None = None,
        timeout: float = 60.0,
    ) -> None:
        self._base = base_url.strip().rstrip("/")
        self._token = token
        self._allow_private = allow_private
        self._resolver = resolver
        self._inner = inner
        self._timeout = timeout
        _check_url(self._base, allow_private=allow_private)
        self._host = urlsplit(self._base).hostname or ""

    async def check_config(self) -> None:
        """Startup check of the configured base URL. Raises UnsafeURL with a user-safe message."""
        await validate_base_url(
            self._base,
            allow_local=self._allow_private,
            preset_hosts=frozenset({self._host.lower()}),
            resolver=self._resolver,
        )

    def _client(self, *, api: bool) -> httpx.AsyncClient:
        transport = GuardedTransport(
            allow_local=self._allow_private,
            preset_hosts=frozenset({self._host.lower()}) if api else frozenset(),
            any_host=not api,
            resolver=self._resolver,
            inner=self._inner,
        )
        return httpx.AsyncClient(transport=transport, follow_redirects=False, timeout=self._timeout)

    async def _api(self, method: str, path: str, **kwargs: object) -> httpx.Response:
        try:
            async with self._client(api=True) as client:
                response = await client.request(
                    method,
                    self._base + path,
                    headers={"Authorization": f"Bearer {self._token}"},
                    **kwargs,  # type: ignore[arg-type]
                )
        except httpx.HTTPError:
            raise StorageError from None
        return response

    @staticmethod
    def _json(response: httpx.Response) -> dict:
        try:
            data = response.json()
        except ValueError:
            raise StorageError(response.status_code) from None
        if not isinstance(data, dict):
            raise StorageError(response.status_code)
        return data

    @staticmethod
    def _key(key: str) -> str:
        if not _FILE_ID.fullmatch(key):
            raise StorageError
        return key

    async def put(self, source: _Readable, max_bytes: int) -> Stored:
        # The upload size must be declared up front, so spool (memory, then disk) while hashing.
        digest = hashlib.sha256()
        size = 0
        with tempfile.SpooledTemporaryFile(max_size=SPOOL_MEMORY) as spool:
            while chunk := await source.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise TooLarge
                digest.update(chunk)
                spool.write(chunk)
            if size == 0:
                raise StorageError  # NexusCloud rejects empty uploads
            response = await self._api(
                "POST",
                "/api/v1/files/upload-request",
                json={"original_name": _OPAQUE_NAME, "size_bytes": size, "mime_type": _OPAQUE_MIME},
            )
            if response.status_code != 200:
                raise StorageError(response.status_code)
            ticket = self._json(response)
            key = self._key(str(ticket.get("file_id", "")))
            try:
                await self._upload(spool, size, ticket)
                confirm = await self._api("POST", f"/api/v1/files/confirm-upload/{key}")
                if confirm.status_code != 200:
                    raise StorageError(confirm.status_code)
            except StorageError:
                await self._cancel(key)
                raise
        return Stored(key, size, digest.hexdigest(), self.name)

    async def _upload(self, spool: tempfile.SpooledTemporaryFile, size: int, ticket: dict) -> None:
        url = ticket.get("upload_url")
        headers = ticket.get("required_headers") or {}
        if not isinstance(url, str) or not isinstance(headers, dict):
            raise StorageError
        _check_url(url, allow_private=self._allow_private)
        safe_headers = {
            str(k): str(v)
            for k, v in headers.items()
            if str(k).lower() not in ("authorization", "host", "content-length")
        }
        spool.seek(0)

        async def body() -> AsyncIterator[bytes]:
            while chunk := spool.read(CHUNK):
                yield chunk

        try:
            async with self._client(api=False) as client:
                response = await client.put(
                    url, content=body(), headers={**safe_headers, "Content-Length": str(size)}
                )
        except httpx.HTTPError:
            raise StorageError from None
        if response.status_code >= 300:
            raise StorageError(response.status_code)

    async def _cancel(self, key: str) -> None:
        try:
            await self._api("POST", f"/api/v1/files/cancel-upload/{key}")
        except StorageError:
            pass  # NexusCloud's cleanup worker also sweeps expired reservations

    async def get(self, key: str) -> AsyncIterator[bytes]:
        key = self._key(key)
        response = await self._api("GET", f"/api/v1/files/download/{key}")
        if response.status_code == 404:
            raise StorageMissing
        if response.status_code != 200:
            raise StorageError(response.status_code)
        url = self._json(response).get("download_url")
        if not isinstance(url, str):
            raise StorageError
        _check_url(url, allow_private=self._allow_private)
        client = self._client(
            api=False
        )  # no Authorization header: this is the cloud, not NexusCloud
        try:
            upstream = await client.send(client.build_request("GET", url), stream=True)
        except httpx.HTTPError:
            await client.aclose()
            raise StorageError from None
        if upstream.status_code != 200:
            status = upstream.status_code
            await upstream.aclose()
            await client.aclose()
            if status == 404:
                raise StorageMissing
            raise StorageError(status)

        async def chunks() -> AsyncIterator[bytes]:
            try:
                async for chunk in upstream.aiter_bytes(CHUNK):
                    yield chunk
            except httpx.HTTPError:
                raise StorageError from None
            finally:
                await upstream.aclose()
                await client.aclose()

        return chunks()

    async def delete(self, key: str) -> None:
        response = await self._api("DELETE", f"/api/v1/files/{self._key(key)}")
        if response.status_code not in (204, 404):
            raise StorageError(response.status_code)
