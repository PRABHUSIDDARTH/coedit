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
