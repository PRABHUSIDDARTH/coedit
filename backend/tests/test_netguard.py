"""SSRF guard tests. DNS is stubbed; no real network."""

import httpx
import pytest

from app.council import netguard
from app.council.netguard import UnsafeURL, guarded_client, is_public, validate_base_url

PRESETS = frozenset({"api.groq.com"})


def resolver(mapping: dict[str, list[str]]):
    async def resolve(host: str, port: int) -> list[str]:
        return mapping[host]

    return resolve


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.9",
        "192.168.1.1",
        "169.254.169.254",
        "0.0.0.0",  # noqa: S104 - an address under test, not a bind
        "100.64.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "224.0.0.1",
    ],
)
def test_non_public_addresses(address: str) -> None:
    assert not is_public(address)


def test_public_addresses() -> None:
    assert is_public("8.8.8.8") and is_public("2606:4700::1111")


@pytest.mark.parametrize(
    "url",
    [
        "ftp://api.groq.com/v1",
        "file:///etc/passwd",
        "http://user:pw@api.groq.com/v1",
        "http:///x",
        "http://api.groq.com:99999/v1",
        "not a url",
    ],
)
async def test_rejects_bad_shapes(url: str) -> None:
    with pytest.raises(UnsafeURL):
        await validate_base_url(
            url,
            allow_local=False,
            preset_hosts=PRESETS,
            resolver=resolver({"api.groq.com": ["8.8.8.8"]}),
        )


async def test_preset_host_public_is_allowed_and_normalised() -> None:
    url = await validate_base_url(
        "https://api.groq.com/openai/v1/",
        allow_local=False,
        preset_hosts=PRESETS,
        resolver=resolver({"api.groq.com": ["8.8.8.8"]}),
    )
    assert url == "https://api.groq.com/openai/v1"


async def test_unknown_host_rejected_without_flag_even_if_public() -> None:
    with pytest.raises(UnsafeURL, match="not an allowed provider"):
        await validate_base_url(
            "https://evil.example/v1",
            allow_local=False,
            preset_hosts=PRESETS,
            resolver=resolver({"evil.example": ["8.8.8.8"]}),
        )


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:11434/v1",
        "http://127.0.0.1:11434/v1",
        "http://[::1]:11434/v1",
        "http://10.0.0.5/v1",
        "http://169.254.169.254/latest",
        "http://192.168.0.2/v1",
    ],
)
async def test_localhost_and_private_literals_rejected_without_flag(url: str) -> None:
    with pytest.raises(UnsafeURL):
        await validate_base_url(
            url,
            allow_local=False,
            preset_hosts=PRESETS,
            resolver=resolver({"localhost": ["127.0.0.1"]}),
        )


async def test_preset_host_resolving_private_is_rejected() -> None:
    # the preset name was repointed at an internal address
    with pytest.raises(UnsafeURL, match="private or local"):
        await validate_base_url(
            "https://api.groq.com/openai/v1",
            allow_local=False,
            preset_hosts=PRESETS,
            resolver=resolver(
                {"api.groq.com": ["8.8.8.8", "10.0.0.7"]}
            ),  # one bad record is enough
        )


async def test_flag_allows_local_hosts() -> None:
    for url in (
        "http://localhost:11434/v1",
        "http://host.docker.internal:11434/v1",
        "http://10.0.0.5/v1",
    ):
        await validate_base_url(
            url,
            allow_local=True,
            resolver=resolver({"localhost": ["127.0.0.1"], "host.docker.internal": ["172.17.0.1"]}),
        )


async def test_unresolvable_host() -> None:
    async def fail(host: str, port: int) -> list[str]:
        raise UnsafeURL("The provider host could not be resolved.")

    with pytest.raises(UnsafeURL, match="resolved"):
        await validate_base_url(
            "https://api.groq.com/v1", allow_local=False, preset_hosts=PRESETS, resolver=fail
        )


def make_client(handler, mapping, *, allow_local=False):
    return guarded_client(
        allow_local=allow_local,
        preset_hosts=PRESETS,
        resolver=resolver(mapping),
        inner=httpx.MockTransport(handler),
    )


async def test_transport_pins_the_validated_address() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    async with make_client(handler, {"api.groq.com": ["8.8.8.8"]}) as client:
        response = await client.get("https://api.groq.com/openai/v1/models")
    assert response.status_code == 200
    assert seen[0].url.host == "8.8.8.8"  # connects to the IP that was checked
    assert seen[0].headers["host"] == "api.groq.com"
    assert seen[0].extensions["sni_hostname"] == "api.groq.com"


async def test_dns_rebinding_is_caught_at_connect_time() -> None:
    """Public when the seat was validated, private when the request is made."""
    answers = iter([["8.8.8.8"], ["127.0.0.1"]])

    async def flip(host: str, port: int) -> list[str]:
        return next(answers)

    assert await validate_base_url(
        "https://api.groq.com/v1", allow_local=False, preset_hosts=PRESETS, resolver=flip
    )
    reached: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        reached.append(request)
        return httpx.Response(200)

    client = guarded_client(
        allow_local=False, preset_hosts=PRESETS, resolver=flip, inner=httpx.MockTransport(handler)
    )
    async with client:
        with pytest.raises(httpx.ConnectError, match="private or local"):
            await client.get("https://api.groq.com/v1/models")
    assert reached == []  # nothing was sent


async def test_redirect_to_private_host_is_blocked() -> None:
    reached: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        reached.append(request.url.host)
        if request.url.host == "8.8.8.8":
            return httpx.Response(
                302, headers={"location": "http://169.254.169.254/latest/meta-data"}
            )
        return httpx.Response(200, text="secret")

    async with make_client(handler, {"api.groq.com": ["8.8.8.8"]}) as client:
        with pytest.raises(httpx.ConnectError):
            await client.get("https://api.groq.com/v1/models")
    assert reached == ["8.8.8.8"]  # the metadata address was never contacted


async def test_redirect_to_non_preset_host_is_blocked_and_chains_are_capped() -> None:
    def to_other(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://other.example/x"})

    async with make_client(
        to_other, {"api.groq.com": ["8.8.8.8"], "other.example": ["8.8.4.4"]}
    ) as c:
        with pytest.raises(httpx.ConnectError, match="not an allowed provider"):
            await c.get("https://api.groq.com/v1/models")

    hops: list[int] = []

    def loop(request: httpx.Request) -> httpx.Response:
        hops.append(1)
        return httpx.Response(302, headers={"location": "https://api.groq.com/again"})

    async with make_client(loop, {"api.groq.com": ["8.8.8.8"]}) as c:
        with pytest.raises(httpx.TooManyRedirects):
            await c.get("https://api.groq.com/v1/models")
    assert len(hops) == netguard.MAX_REDIRECTS + 1


async def test_flag_lets_local_requests_through() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    async with make_client(
        handler, {"host.docker.internal": ["172.17.0.1"]}, allow_local=True
    ) as c:
        assert (await c.get("http://host.docker.internal:11434/v1/models")).status_code == 200


async def test_pinned_connection_still_verifies_tls_against_the_hostname(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real TLS: the guard connects to the checked IP, yet the certificate must match the NAME
    (SNI + verification use it), and the Host header keeps it."""
    import datetime
    import http.server
    import ssl
    import threading

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "provider.test")])
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(hours=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("provider.test")]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_file, key_file = tmp_path / "c.pem", tmp_path / "k.pem"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = f"host={self.headers['Host']}".encode()
            self.send_response(200)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: object) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_file, key_file)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    monkeypatch.setenv("SSL_CERT_FILE", str(cert_file))
    try:
        async with guarded_client(
            allow_local=True,
            resolver=resolver({"provider.test": ["127.0.0.1"], "other.test": ["127.0.0.1"]}),
        ) as client:
            ok = await client.get(f"https://provider.test:{port}/x")
            assert ok.status_code == 200 and ok.text == f"host=provider.test:{port}"
            with pytest.raises(httpx.ConnectError):  # same IP, certificate is for another name
                await client.get(f"https://other.test:{port}/x")
    finally:
        server.shutdown()


async def test_resolver_order_is_kept_and_a_dead_address_falls_through_to_the_next() -> None:
    """A and AAAA records: the first address may be unroutable from this network."""
    tried: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        tried.append(request.url.host)
        if request.url.host == "2606:4700::1111":
            raise httpx.ConnectError("Network is unreachable", request=request)
        return httpx.Response(200, json={})

    mapping = {"api.groq.com": ["2606:4700::1111", "104.18.38.236"]}
    async with make_client(handler, mapping) as client:
        assert (await client.get("https://api.groq.com/v1/models")).status_code == 200
    assert tried == ["2606:4700::1111", "104.18.38.236"]  # resolver order, then fallback

    async with make_client(handler, {"api.groq.com": ["2606:4700::1111"]}) as client:
        with pytest.raises(httpx.ConnectError):  # all addresses dead -> a plain connect error
            await client.get("https://api.groq.com/v1/models")


async def test_one_private_address_among_several_still_refuses_the_host() -> None:
    reached: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        reached.append(request.url.host)
        return httpx.Response(200)

    async with make_client(handler, {"api.groq.com": ["8.8.8.8", "10.0.0.1"]}) as client:
        with pytest.raises(httpx.ConnectError, match="private or local"):
            await client.get("https://api.groq.com/v1/models")
    assert reached == []
