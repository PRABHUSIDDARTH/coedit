from httpx import AsyncClient

from tests.conftest import PASSWORD, new_client, register, unique_email


async def test_register_login_me(client: AsyncClient) -> None:
    email = unique_email()
    user = await register(client, email, "Ada")
    assert user["email"] == email
    assert user["display_name"] == "Ada"
    assert "password" not in user and "password_hash" not in user

    async with new_client() as other:  # fresh cookie jar
        resp = await other.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert resp.status_code == 200
        cookie = resp.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=lax" in cookie
        me = await other.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["id"] == user["id"]


async def test_register_sets_session(client: AsyncClient) -> None:
    user = await register(client)
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]


async def test_email_is_case_insensitive(client: AsyncClient) -> None:
    email = unique_email("Mixed")
    await register(client, email)
    async with new_client() as other:
        resp = await other.post(
            "/api/auth/login", json={"email": email.upper(), "password": PASSWORD}
        )
        assert resp.status_code == 200
        dup = await other.post(
            "/api/auth/register",
            json={"email": email.upper(), "password": PASSWORD, "display_name": "Dup"},
        )
        assert dup.status_code == 409


async def test_bad_password_401(client: AsyncClient) -> None:
    email = unique_email()
    await register(client, email)
    async with new_client() as other:
        resp = await other.post("/api/auth/login", json={"email": email, "password": "wrong-pw-1"})
        assert resp.status_code == 401
        assert "set-cookie" not in resp.headers
        assert (await other.get("/api/auth/me")).status_code == 401


async def test_unknown_email_401(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/auth/login", json={"email": unique_email("ghost"), "password": PASSWORD}
    )
    assert resp.status_code == 401


async def test_no_cookie_401(client: AsyncClient) -> None:
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_garbage_cookie_401(client: AsyncClient) -> None:
    client.cookies.set("coedit_session", "not-a-jwt")
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_logout_clears_session(client: AsyncClient) -> None:
    await register(client)
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_short_password_422(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/auth/register",
        json={"email": unique_email(), "password": "short", "display_name": "X"},
    )
    assert resp.status_code == 422


async def test_mutating_request_needs_csrf_header() -> None:
    async with new_client() as c:
        c.headers.pop("X-Requested-With")
        resp = await c.post("/api/auth/login", json={"email": unique_email(), "password": PASSWORD})
        assert resp.status_code == 403


async def test_session_lifetime_is_configurable_default_24h(
    client: AsyncClient, monkeypatch
) -> None:
    import jwt

    from app.config import Settings, get_settings
    from app.security import SESSION_COOKIE

    assert Settings.model_fields["session_ttl_hours"].default == 24

    def lifetime(resp) -> tuple[int, int]:
        morsel = resp.cookies[SESSION_COOKIE]
        claims = jwt.decode(morsel, options={"verify_signature": False})
        max_age = int(resp.headers["set-cookie"].lower().split("max-age=")[1].split(";")[0])
        return claims["exp"] - claims["iat"], max_age

    monkeypatch.setattr(get_settings(), "session_ttl_hours", 24)
    email = unique_email()
    await register(client, email)
    resp = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert lifetime(resp) == (24 * 3600, 24 * 3600)

    monkeypatch.setattr(get_settings(), "session_ttl_hours", 2)
    resp = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert lifetime(resp) == (2 * 3600, 2 * 3600)
