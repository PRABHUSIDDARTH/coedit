import pytest
from httpx import AsyncClient

from app.config import get_settings
from app.ratelimit import SlidingWindowLimiter
from tests.conftest import PASSWORD, register, unique_email


@pytest.fixture
def limits(monkeypatch: pytest.MonkeyPatch):
    """Lower the limits for one test (settings are cached, so patch the instance)."""

    def apply(ip: int = 100000, email: int = 100000, trusted: str = "", window: int = 900) -> None:
        s = get_settings()
        monkeypatch.setattr(s, "rate_limit_ip_max", ip)
        monkeypatch.setattr(s, "rate_limit_email_max", email)
        monkeypatch.setattr(s, "rate_limit_trusted_proxies", trusted)
        monkeypatch.setattr(s, "rate_limit_window_seconds", window)

    return apply


async def _login(c: AsyncClient, email: str, password: str = "x" * 12, **kw):
    return await c.post("/api/auth/login", json={"email": email, "password": password}, **kw)


def test_window_slides_and_reports_retry_after() -> None:
    lim = SlidingWindowLimiter()
    assert [lim.hit("k", 2, 10, now=t) for t in (0, 1)] == [0, 0]
    assert lim.hit("k", 2, 10, now=2) == 8  # oldest hit leaves the window at t=10
    assert lim.hit("k", 2, 10, now=9.5) == 1  # always at least 1 second
    assert lim.hit("k", 2, 10, now=10.5) == 0  # first hit expired
    assert lim.hit("other", 2, 10, now=2) == 0  # keys are independent
    assert lim.hit("k", 0, 10, now=2) == 0  # limit 0 = disabled


def test_expired_keys_are_swept_at_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.ratelimit as rl

    monkeypatch.setattr(rl, "_MAX_KEYS", 3)
    lim = SlidingWindowLimiter()
    for i in range(3):
        lim.hit(f"old{i}", 5, 10, now=0)
    lim.hit("new", 5, 10, now=100)
    assert set(lim._hits) == {"new"}


async def test_login_email_limit_429_with_retry_after(client: AsyncClient, limits) -> None:
    limits(email=3)
    email = unique_email()
    for _ in range(3):
        assert (await _login(client, email)).status_code == 401
    resp = await _login(client, email.upper())  # same bucket regardless of case
    assert resp.status_code == 429
    assert 1 <= int(resp.headers["retry-after"]) <= 900
    assert (await _login(client, unique_email())).status_code == 401  # another email is unaffected


async def test_limit_applies_before_password_check(client: AsyncClient, limits) -> None:
    email = unique_email()
    await register(client, email)
    limits(email=2)
    await _login(client, email)
    await _login(client, email)
    # Even the correct password is refused once the bucket is full.
    assert (await _login(client, email, PASSWORD)).status_code == 429


async def test_login_ip_limit_across_emails(client: AsyncClient, limits) -> None:
    limits(ip=3)
    for _ in range(3):
        assert (await _login(client, unique_email())).status_code == 401
    assert (await _login(client, unique_email())).status_code == 429


async def test_register_is_limited_separately_from_login(client: AsyncClient, limits) -> None:
    limits(ip=2)
    body = {"password": PASSWORD, "display_name": "T"}
    for _ in range(2):
        r = await client.post("/api/auth/register", json={"email": unique_email(), **body})
        assert r.status_code == 201
    r = await client.post("/api/auth/register", json={"email": unique_email(), **body})
    assert r.status_code == 429 and "retry-after" in r.headers
    assert (await _login(client, unique_email())).status_code == 401  # login bucket untouched


# httpx's ASGI transport presents every request as coming from 127.0.0.1.


async def test_forwarded_header_ignored_when_trust_is_off(client: AsyncClient, limits) -> None:
    limits(ip=2, trusted="")
    for i in range(2):
        await _login(client, unique_email(), headers={"X-Forwarded-For": f"9.9.9.{i}"})
    # Spoofing a new address does not buy a new bucket.
    r = await _login(client, unique_email(), headers={"X-Forwarded-For": "9.9.9.200"})
    assert r.status_code == 429


async def test_spoofed_header_from_untrusted_peer_is_ignored(client: AsyncClient, limits) -> None:
    limits(ip=2, trusted="10.0.0.0/8")  # the peer (127.0.0.1) is not inside this range
    for i in range(2):
        await _login(client, unique_email(), headers={"X-Forwarded-For": f"9.9.9.{i}"})
    r = await _login(client, unique_email(), headers={"X-Forwarded-For": "9.9.9.200"})
    assert r.status_code == 429


async def test_trusted_peer_header_selects_bucket_by_last_entry(
    client: AsyncClient, limits
) -> None:
    limits(ip=1, trusted="10.0.0.0/8, 127.0.0.0/8")
    # A forged first entry is ignored; the last entry (appended by the trusted proxy) picks the bucket.
    r1 = await _login(client, unique_email(), headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.1"})
    r2 = await _login(client, unique_email(), headers={"X-Forwarded-For": "2.2.2.2, 10.0.0.1"})
    r3 = await _login(client, unique_email(), headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.2"})
    assert (r1.status_code, r2.status_code, r3.status_code) == (401, 429, 401)


async def test_trusted_peer_with_garbage_header_falls_back_to_peer(
    client: AsyncClient, limits
) -> None:
    limits(ip=1, trusted="127.0.0.0/8")
    r1 = await _login(client, unique_email(), headers={"X-Forwarded-For": "not-an-ip"})
    r2 = await _login(client, unique_email())  # no header: the peer's own bucket, already used
    assert (r1.status_code, r2.status_code) == (401, 429)


def test_trusted_proxies_must_be_cidrs() -> None:
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(rate_limit_trusted_proxies="10.0.0.0/8, nonsense")
    assert Settings(rate_limit_trusted_proxies="10.0.0.0/8, fd00::/8").trusted_proxy_networks
