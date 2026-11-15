"""NexusCloud storage backend, tested against a local stub of its REST API and of the cloud
presigned endpoint. No real NexusCloud, cloud account or credentials are involved: this proves
the adapter's request shapes and failure handling, not interoperability with a real deployment."""

import hashlib
import io
import json
import logging
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings, get_settings
from app.council.netguard import UnsafeURL
from app.services import storage
from app.services.nexuscloud import NexusCloudBackend
from tests.conftest import World
from tests.test_files import upload

TOKEN = "nct_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6"  # fake-secret-ok
SECRET_BODY = "internal-detail-do-not-leak"
SIG = "SECRETSIG123"


class Reader:
    def __init__(self, data: bytes) -> None:
        self._io = io.BytesIO(data)

    async def read(self, size: int = -1) -> bytes:
        return self._io.read(size)


class Stub:
    """One server playing both the NexusCloud API and the cloud's presigned endpoint."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.objects: dict[str, bytes] = {}
        self.fail: dict[str, int] = {}  # "METHOD /path-prefix" -> status
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def _record(self, body: bytes) -> None:
                stub.requests.append(
                    {
                        "method": self.command,
                        "path": self.path,
                        "headers": {k.lower(): v for k, v in self.headers.items()},
                        "body": body,
                    }
                )

            def _send(self, status: int, payload: object = None, raw: bytes | None = None) -> None:
                data = (
                    raw
                    if raw is not None
                    else (json.dumps(payload).encode() if payload is not None else b"")
                )
                self.send_response(status)
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _handle(self) -> None:
                length = int(self.headers.get("content-length") or 0)
                body = self.rfile.read(length) if length else b""
                self._record(body)
                key = f"{self.command} {self.path}"
                for prefix, status in stub.fail.items():
                    if key.startswith(prefix):
                        return self._send(
                            status, {"error": {"message": SECRET_BODY, "echo": TOKEN}}
                        )
                path = self.path.split("?")[0]
                base = f"http://127.0.0.1:{stub.port}"
                if path.startswith("/api/"):
                    if self.headers.get("authorization") != f"Bearer {TOKEN}":
                        return self._send(401, {"error": {"message": "no"}})
                    if self.command == "POST" and path == "/api/v1/files/upload-request":
                        file_id = str(uuid.uuid4())
                        stub.objects[file_id] = b""
                        return self._send(
                            200,
                            {
                                "file_id": file_id,
                                "upload_url": f"{base}/obj/{file_id}?sig={SIG}",
                                "required_headers": {"Content-Type": "application/octet-stream"},
                            },
                        )
                    if self.command == "POST" and path.startswith("/api/v1/files/confirm-upload/"):
                        return self._send(200, {"status": "active"})
                    if self.command == "POST" and path.startswith("/api/v1/files/cancel-upload/"):
                        return self._send(204)
                    if self.command == "GET" and path.startswith("/api/v1/files/download/"):
                        file_id = path.rsplit("/", 1)[1]
                        if file_id not in stub.objects:
                            return self._send(404, {"error": {"message": "File not found"}})
                        return self._send(200, {"download_url": f"{base}/obj/{file_id}?sig={SIG}"})
                    if self.command == "DELETE" and path.startswith("/api/v1/files/"):
                        file_id = path.rsplit("/", 1)[1]
                        if stub.objects.pop(file_id, None) is None:
                            return self._send(404, {"error": {"message": "File not found"}})
                        return self._send(204)
                    return self._send(404)
                if path.startswith("/obj/"):
                    file_id = path.rsplit("/", 1)[1]
                    if self.command == "PUT":
                        stub.objects[file_id] = body
                        return self._send(200)
                    if self.command == "GET":
                        return self._send(200, raw=stub.objects[file_id])
                return self._send(404)

            do_GET = do_POST = do_PUT = do_DELETE = _handle

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def stub():
    s = Stub()
    yield s
    s.stop()


def backend_for(stub: Stub, token: str = TOKEN) -> NexusCloudBackend:
    return NexusCloudBackend(stub.base, token, allow_private=True)


async def read_all(chunks) -> bytes:
    return b"".join([c async for c in chunks])


# ---------- behaviour and request shape ----------


async def test_put_get_delete_round_trip_and_request_shape(stub: Stub) -> None:
    backend = backend_for(stub)
    data = b"hello nexus " * 1000
    stored = await backend.put(Reader(data), max_bytes=10**6)
    assert (stored.size, stored.backend) == (len(data), "nexuscloud")
    assert stored.sha256 == hashlib.sha256(data).hexdigest()
    assert stored.key in stub.objects

    order = [(r["method"], r["path"].split("?")[0].rsplit("/", 1)[0]) for r in stub.requests]
    assert order == [
        ("POST", "/api/v1/files"),  # upload-request
        ("PUT", "/obj"),
        ("POST", "/api/v1/files/confirm-upload"),
    ]
    request, put, _ = stub.requests
    assert request["headers"]["authorization"] == f"Bearer {TOKEN}"
    # Opaque name and type: the user's filename and content type never reach NexusCloud.
    assert json.loads(request["body"]) == {
        "original_name": "coedit-blob",
        "size_bytes": len(data),
        "mime_type": "application/octet-stream",
    }
    assert "authorization" not in put["headers"]  # the token never goes to the cloud URL
    assert put["headers"]["content-length"] == str(len(data))
    assert put["body"] == data

    assert await read_all(await backend.get(stored.key)) == data
    download = next(r for r in stub.requests if "/download/" in r["path"])
    assert download["headers"]["authorization"] == f"Bearer {TOKEN}"
    cloud_get = stub.requests[-1]
    assert cloud_get["path"].startswith("/obj/") and "authorization" not in cloud_get["headers"]

    await backend.delete(stored.key)
    await backend.delete(stored.key)  # already gone: not an error
    with pytest.raises(storage.StorageMissing):
        await backend.get(stored.key)


async def test_too_large_and_empty_uploads_never_reach_nexuscloud(stub: Stub) -> None:
    backend = backend_for(stub)
    with pytest.raises(storage.TooLarge):
        await backend.put(Reader(b"x" * 11), max_bytes=10)
    with pytest.raises(storage.StorageError):
        await backend.put(Reader(b""), max_bytes=10)
    assert stub.requests == []


async def test_required_headers_cannot_override_auth_or_length(stub: Stub) -> None:
    class Spy(NexusCloudBackend):
        async def _api(self, method, path, **kwargs):  # type: ignore[no-untyped-def]
            response = await super()._api(method, path, **kwargs)
            if path.endswith("upload-request"):
                data = response.json()
                data["required_headers"] = {
                    "Authorization": "Bearer evil",
                    "Content-Length": "1",
                    "X-Ok": "1",
                }
                return httpx.Response(200, json=data)
            return response

    spy = Spy(stub.base, TOKEN, allow_private=True)
    await spy.put(Reader(b"abc"), max_bytes=10)
    put = next(r for r in stub.requests if r["method"] == "PUT")
    assert "authorization" not in put["headers"] and put["headers"]["content-length"] == "3"
    assert put["headers"]["x-ok"] == "1"


# ---------- errors reduced to status; token and URLs never logged ----------


@pytest.mark.parametrize(
    ("fail", "operation"),
    [
        ("POST /api/v1/files/upload-request", "put"),
        ("PUT /obj/", "put"),
        ("POST /api/v1/files/confirm-upload/", "put"),
        ("GET /api/v1/files/download/", "get"),
        ("GET /obj/", "get"),
        ("DELETE /api/v1/files/", "delete"),
    ],
)
async def test_errors_carry_only_a_status(stub: Stub, fail: str, operation: str, caplog) -> None:
    caplog.set_level(logging.DEBUG)
    backend = backend_for(stub)
    stored = await backend.put(Reader(b"seed"), max_bytes=100)
    stub.requests.clear()
    stub.fail[fail] = 503
    with pytest.raises(storage.StorageError) as caught:
        if operation == "put":
            await backend.put(Reader(b"data"), max_bytes=100)
        elif operation == "get":
            await backend.get(stored.key)
        else:
            await backend.delete(stored.key)
    text = f"{caught.value!s} {caught.value!r} {caught.value.args}"
    assert caught.value.status == 503 and "503" in text
    for secret in (TOKEN, SECRET_BODY, SIG, stub.base, "127.0.0.1"):
        assert secret not in text
        assert secret not in caplog.text
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None or caught.value.__suppress_context__


async def test_failed_upload_is_cancelled_and_token_stays_out_of_logs(stub: Stub, caplog) -> None:
    caplog.set_level(logging.DEBUG)
    backend = backend_for(stub)
    stub.fail["PUT /obj/"] = 500
    with pytest.raises(storage.StorageError):
        await backend.put(Reader(b"data"), max_bytes=100)
    assert any("cancel-upload" in r["path"] for r in stub.requests)
    for secret in (TOKEN, SIG):
        assert secret not in caplog.text


async def test_unreachable_server_and_bad_token_reduce_to_generic_errors(stub: Stub) -> None:
    with pytest.raises(storage.StorageError) as bad:
        await backend_for(stub, "nct_wrong").put(Reader(b"data"), max_bytes=100)
    assert bad.value.status == 401 and "nct_wrong" not in str(bad.value)
    dead = backend_for(stub)
    stub.stop()
    with pytest.raises(storage.StorageError) as down:
        await dead.put(Reader(b"data"), max_bytes=100)
    assert down.value.status is None and "127.0.0.1" not in str(down.value)


def test_settings_never_reveal_the_token_and_validate_the_selection() -> None:
    assert get_settings().storage_backend == "local"  # default: no NexusCloud needed
    with pytest.raises(ValidationError):
        Settings(_env_file=None, storage_backend="nexuscloud")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, storage_backend="s3")
    configured = Settings(
        _env_file=None,
        storage_backend="nexuscloud",
        nexuscloud_base_url="https://n.example",
        nexuscloud_token=TOKEN,
    )
    assert TOKEN not in repr(configured) and TOKEN not in str(configured.model_dump())


# ---------- SSRF ----------

PUBLIC = "93.184.216.34"


def resolver_for(mapping: dict[str, list[str]]):
    async def resolve(host: str, port: int) -> list[str]:
        if host not in mapping:
            raise UnsafeURL("The provider host could not be resolved.")
        return mapping[host]

    return resolve


@pytest.mark.parametrize(
    "url",
    [
        "http://nexus.example",  # plaintext
        "ftp://nexus.example",
        "file:///etc/passwd",
        "https://user:pw@nexus.example",
        "https://nexus.example/#frag",
        "nexus.example",
    ],
)
def test_constructor_refuses_unsafe_base_urls(url: str) -> None:
    with pytest.raises(storage.StorageError):
        NexusCloudBackend(url, TOKEN)


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1",
        "https://localhost",
        "https://169.254.169.254",
        "https://10.0.0.5",
        "https://192.168.1.10:8443",
        "https://[::1]",
        "https://[::ffff:127.0.0.1]",
    ],
)
async def test_startup_check_refuses_private_addresses(url: str) -> None:
    resolver = resolver_for({"localhost": ["127.0.0.1"]})
    with pytest.raises(UnsafeURL):
        await NexusCloudBackend(url, TOKEN, resolver=resolver).check_config()


async def test_startup_check_refuses_a_name_that_resolves_privately_and_accepts_public() -> None:
    private = resolver_for({"nexus.example": ["10.1.2.3"]})
    with pytest.raises(UnsafeURL):
        await NexusCloudBackend("https://nexus.example", TOKEN, resolver=private).check_config()
    mixed = resolver_for({"nexus.example": [PUBLIC, "169.254.169.254"]})
    with pytest.raises(UnsafeURL):
        await NexusCloudBackend("https://nexus.example", TOKEN, resolver=mixed).check_config()
    public = resolver_for({"nexus.example": [PUBLIC]})
    await NexusCloudBackend("https://nexus.example", TOKEN, resolver=public).check_config()


class Mock:
    """httpx.MockTransport standing in for the network, behind the real GuardedTransport."""

    def __init__(self, ticket: dict | None = None) -> None:
        self.seen: list[httpx.Request] = []
        self.ticket = ticket

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        path = request.url.path
        if path.endswith("/upload-request"):
            return httpx.Response(200, json=self.ticket)
        if "/download/" in path:
            return httpx.Response(200, json=self.ticket)
        return httpx.Response(200, json={})

    def hosts(self) -> list[str]:
        return [r.headers["host"] for r in self.seen]


def guarded(mock: Mock, mapping: dict[str, list[str]]) -> NexusCloudBackend:
    return NexusCloudBackend(
        "https://nexus.example",
        TOKEN,
        resolver=resolver_for({"nexus.example": [PUBLIC], **mapping}),
        inner=httpx.MockTransport(mock),
    )


FILE_ID = str(uuid.uuid4())


@pytest.mark.parametrize(
    "target",
    [
        "http://169.254.169.254/latest/meta-data",  # plaintext metadata service
        "https://169.254.169.254/latest",
        "https://10.0.0.7/obj",
        "https://127.0.0.1/obj",
        "https://[::1]/obj",
        "https://internal.example/obj",  # name that resolves to a private address
        "https://user:pw@bucket.example/obj",
        "https://rebind.example/obj",
        "file:///etc/passwd",
    ],
)
async def test_presigned_urls_must_be_public_https_without_credentials(target: str) -> None:
    mock = Mock(
        {"file_id": FILE_ID, "upload_url": target, "download_url": target, "required_headers": {}}
    )
    backend = guarded(
        mock,
        {
            "internal.example": ["10.9.9.9"],
            "rebind.example": [PUBLIC, "192.168.0.1"],
            "bucket.example": [PUBLIC],
        },
    )
    with pytest.raises(storage.StorageError):
        await backend.put(Reader(b"data"), max_bytes=100)
    with pytest.raises(storage.StorageError):
        await backend.get(FILE_ID)
    assert set(mock.hosts()) <= {"nexus.example"}  # nothing was ever sent to the target


async def test_public_presigned_url_works_without_the_token() -> None:
    mock = Mock(
        {
            "file_id": FILE_ID,
            "upload_url": "https://bucket.example/obj?sig=x",
            "download_url": "https://bucket.example/obj?sig=x",
            "required_headers": {},
        }
    )
    backend = guarded(mock, {"bucket.example": [PUBLIC]})
    stored = await backend.put(Reader(b"data"), max_bytes=100)
    assert stored.key == FILE_ID
    cloud = [r for r in mock.seen if r.headers["host"] == "bucket.example"]
    assert [r.method for r in cloud] == ["PUT"] and all(
        "authorization" not in r.headers for r in cloud
    )


async def test_dns_rebinding_between_startup_and_request_is_refused() -> None:
    answers = iter([[PUBLIC], ["127.0.0.1"]])

    async def resolver(host: str, port: int) -> list[str]:
        return next(answers)

    mock = Mock(
        {"file_id": FILE_ID, "upload_url": "https://bucket.example/o", "required_headers": {}}
    )
    backend = NexusCloudBackend(
        "https://nexus.example", TOKEN, resolver=resolver, inner=httpx.MockTransport(mock)
    )
    await backend.check_config()  # public at startup
    with pytest.raises(storage.StorageError):
        await backend.delete(FILE_ID)  # loopback by request time
    assert mock.seen == []


async def test_redirects_are_not_followed_and_never_carry_the_token() -> None:
    def redirect(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(307, headers={"location": "https://evil.example/steal"})

    seen: list[httpx.Request] = []
    backend = NexusCloudBackend(
        "https://nexus.example",
        TOKEN,
        resolver=resolver_for({"nexus.example": [PUBLIC], "evil.example": [PUBLIC]}),
        inner=httpx.MockTransport(redirect),
    )
    with pytest.raises(storage.StorageError) as caught:
        await backend.delete(FILE_ID)
    assert caught.value.status == 307
    assert [r.headers["host"] for r in seen] == ["nexus.example"]


async def test_only_the_configured_host_may_receive_api_calls() -> None:
    mock = Mock({"file_id": FILE_ID})
    backend = guarded(mock, {})
    for bad in ("../../x", "a/b", "", "not-a-uuid"):
        with pytest.raises(storage.StorageError):
            await backend.delete(bad)
    assert mock.seen == []


# ---------- through the Coedit API ----------


async def test_uploads_versions_and_downloads_through_the_api(
    world: World, stub: Stub, monkeypatch
) -> None:
    backend = backend_for(stub)
    monkeypatch.setitem(storage._instances, "nexuscloud", backend)
    monkeypatch.setattr(get_settings(), "storage_backend", "nexuscloud")

    created = await upload(world.editor, world, b"remote bytes " * 50, "plan.txt")
    assert created.status_code == 201, created.text
    file = created.json()
    versions = (await world.viewer.get(f"/api/files/{file['id']}/versions")).json()
    assert versions[0]["sha256"] == hashlib.sha256(b"remote bytes " * 50).hexdigest()
    assert len(stub.objects) == 1  # stored in NexusCloud, not on the local volume

    response = await world.viewer.get(f"/api/files/{file['id']}/versions/1/download")
    assert response.status_code == 200 and response.content == b"remote bytes " * 50
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert TOKEN not in str(response.headers) and SIG not in str(response.headers)

    # Permissions are unchanged: outsiders still get 404.
    assert (
        await world.outsider.get(f"/api/files/{file['id']}/versions/1/download")
    ).status_code == 404

    # Switching back to the default keeps the old version readable and stores new ones locally.
    monkeypatch.setattr(get_settings(), "storage_backend", "local")
    second = await world.editor.post(
        f"/api/files/{file['id']}/versions",
        files={"file": ("v2.txt", b"local bytes", "text/plain")},
    )
    assert second.status_code == 201, second.text
    assert len(stub.objects) == 1
    assert (
        await world.viewer.get(f"/api/files/{file['id']}/versions/1/download")
    ).content == b"remote bytes " * 50
    assert (
        await world.viewer.get(f"/api/files/{file['id']}/versions/2/download")
    ).content == b"local bytes"


async def test_api_hides_backend_failures(world: World, stub: Stub, monkeypatch, caplog) -> None:
    caplog.set_level(logging.DEBUG)
    monkeypatch.setitem(storage._instances, "nexuscloud", backend_for(stub))
    monkeypatch.setattr(get_settings(), "storage_backend", "nexuscloud")
    stub.fail["POST /api/v1/files/upload-request"] = 500
    response = await upload(world.editor, world, b"data", "x.txt")
    assert response.status_code == 502
    assert response.json() == {"detail": "Storage is unavailable"}
    for secret in (TOKEN, SECRET_BODY, stub.base):
        assert secret not in response.text and secret not in caplog.text
    tree = (await world.viewer.get(f"/api/workspaces/{world.workspace_id}/tree")).json()
    assert all(f["name"] != "x.txt" for f in tree["files"])  # nothing half-created


async def test_missing_remote_object_is_a_404(world: World, stub: Stub, monkeypatch) -> None:
    monkeypatch.setitem(storage._instances, "nexuscloud", backend_for(stub))
    monkeypatch.setattr(get_settings(), "storage_backend", "nexuscloud")
    file = (await upload(world.editor, world, b"data", "x.txt")).json()
    stub.objects.clear()
    response = await world.viewer.get(f"/api/files/{file['id']}/versions/1/download")
    assert response.status_code == 404


# ---------- the interface contract on the default (local) backend ----------


async def test_local_backend_implements_the_same_interface() -> None:
    backend = storage.get_backend()
    assert (backend.name, backend.shared_keys) == ("local", True)
    stored = await backend.put(Reader(b"local data"), max_bytes=100)
    assert stored.key == stored.sha256 == hashlib.sha256(b"local data").hexdigest()
    assert await read_all(await backend.get(stored.key)) == b"local data"
    with pytest.raises(storage.TooLarge):
        await backend.put(Reader(b"x" * 101), max_bytes=100)
    await storage.discard(stored)  # shared keys: never deleted just because one upload failed
    assert await read_all(await backend.get(stored.key)) == b"local data"
    await backend.delete(stored.key)
    await backend.delete(stored.key)
    with pytest.raises(storage.StorageMissing):
        await backend.get(stored.key)
    with pytest.raises(ValueError):
        await backend.get("../../etc/passwd")


# ---------- application startup (lifespan in app/main.py) ----------


@pytest.fixture
def startup_with(monkeypatch):
    """Run the real app lifespan with STORAGE_BACKEND=nexuscloud and the given base URL."""
    from app import main
    from app.council import pipeline

    async def no_db() -> None:  # the startup check must not depend on the database
        return None

    monkeypatch.setattr(pipeline, "fail_interrupted_runs", no_db)
    monkeypatch.delitem(storage._instances, "nexuscloud", raising=False)
    settings = get_settings()
    monkeypatch.setattr(settings, "storage_backend", "nexuscloud")
    monkeypatch.setattr(settings, "nexuscloud_token", SecretStr(TOKEN))
    monkeypatch.setattr(settings, "nexuscloud_allow_private", False)

    async def start(base_url: str) -> None:
        monkeypatch.setattr(settings, "nexuscloud_base_url", base_url)
        async with main.lifespan(main.app):
            pass

    yield start
    storage._instances.pop("nexuscloud", None)


@pytest.mark.parametrize(
    ("url", "error"),
    [
        ("https://127.0.0.1", UnsafeURL),  # loopback
        ("https://169.254.169.254", UnsafeURL),  # cloud metadata address
        ("https://10.0.0.5", UnsafeURL),  # private network
        ("https://[::1]", UnsafeURL),
        ("http://nexus.example", storage.StorageError),  # plaintext
        ("file:///etc/passwd", storage.StorageError),
        ("https://user:pw@nexus.example", storage.StorageError),  # credentials in the URL
    ],
)
async def test_app_refuses_to_start_on_an_unsafe_nexuscloud_base_url(
    startup_with, url: str, error: type[Exception], caplog
) -> None:
    with pytest.raises(error) as refused:
        await startup_with(url)
    assert TOKEN not in str(refused.value) and "pw@" not in str(refused.value)
    assert TOKEN not in caplog.text


async def test_app_starts_on_a_public_https_nexuscloud_base_url(startup_with, monkeypatch) -> None:
    backend = NexusCloudBackend(
        "https://nexus.example", TOKEN, resolver=resolver_for({"nexus.example": [PUBLIC]})
    )
    monkeypatch.setitem(storage._instances, "nexuscloud", backend)
    await startup_with("https://nexus.example")  # completes: lifespan enters and exits cleanly
