"""SSRF guard for user-supplied provider base URLs.

Policy: a base URL must be http(s), carry no credentials, and name either a *preset host* or
(only with COUNCIL_ALLOW_LOCAL_PROVIDERS=1) any host. Whatever the host, every address it
resolves to must be public unless that flag is on. The check is made twice:

1. `validate_base_url` when a seat is accepted (fast, clear error for the user);
2. `GuardedTransport` on every outgoing request *and every redirect hop*: it resolves the name
   itself, re-checks all addresses and then connects to the validated IP literal (Host header
   and TLS SNI/verification keep the original name). A name that resolves to a public address
   at validation time and to a private one at connect time (DNS rebinding) is therefore refused,
   and the connection cannot be redirected to a different address after the check.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

import httpx

Resolver = Callable[[str, int], Awaitable[list[str]]]
MAX_REDIRECTS = 3
MAX_ADDRESSES = 4


class UnsafeURL(Exception):
    """The URL was refused. The message is safe to show to the user (it never contains secrets)."""


async def system_resolver(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise UnsafeURL("The provider host could not be resolved.") from None
    return list(dict.fromkeys(str(info[4][0]) for info in infos))  # resolver order, deduped


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped  # ::ffff:127.0.0.1 is loopback
    return ip.is_global and not ip.is_multicast


def _host_port(url: str) -> tuple[str, str, int]:
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        raise UnsafeURL("The provider URL is not valid.") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UnsafeURL("The provider URL must start with http:// or https://.")
    if parts.username is not None or parts.password is not None:
        raise UnsafeURL("The provider URL must not contain credentials.")
    return parts.scheme, parts.hostname.lower(), port or (443 if parts.scheme == "https" else 80)


async def check_host(
    host: str, port: int, *, allow_local: bool, preset_hosts: frozenset[str], resolver: Resolver
) -> list[str]:
    """Return the addresses `host` may be reached at, or raise UnsafeURL."""
    if not allow_local and host not in preset_hosts:
        raise UnsafeURL(
            "That host is not an allowed provider. Use a preset, or ask the operator to allow "
            "local providers (COUNCIL_ALLOW_LOCAL_PROVIDERS=1)."
        )
    try:
        addresses = [str(ipaddress.ip_address(host.strip("[]")))]  # literal: no DNS involved
    except ValueError:
        addresses = await resolver(host, port)
    if not addresses:
        raise UnsafeURL("The provider host could not be resolved.")
    if not allow_local and not all(is_public(a) for a in addresses):
        raise UnsafeURL("The provider host resolves to a private or local address.")
    return addresses


async def validate_base_url(
    url: str,
    *,
    allow_local: bool,
    preset_hosts: frozenset[str] = frozenset(),
    resolver: Resolver | None = None,
) -> str:
    """Validate and normalise (strip trailing slash). Raises UnsafeURL."""
    _, host, port = _host_port(url)
    await check_host(
        host,
        port,
        allow_local=allow_local,
        preset_hosts=preset_hosts,
        resolver=resolver or system_resolver,  # looked up at call time, so tests can replace it
    )
    return url.strip().rstrip("/")


class GuardedTransport(httpx.AsyncBaseTransport):
    """Resolve, re-check and pin every request (including redirect hops)."""

    def __init__(
        self,
        *,
        allow_local: bool,
        preset_hosts: frozenset[str] = frozenset(),
        resolver: Resolver = system_resolver,
        inner: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._allow_local = allow_local
        self._preset_hosts = preset_hosts
        self._resolver = resolver
        self._inner = inner or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        port = request.url.port or (443 if request.url.scheme == "https" else 80)
        try:
            addresses = await check_host(
                host,
                port,
                allow_local=self._allow_local,
                preset_hosts=self._preset_hosts,
                resolver=self._resolver,
            )
        except UnsafeURL as exc:
            raise httpx.ConnectError(str(exc), request=request) from None
        last: httpx.ConnectError | httpx.ConnectTimeout | None = None
        for address in addresses[:MAX_ADDRESSES]:  # every one of them was checked above
            pinned = httpx.Request(
                request.method,
                request.url.copy_with(host=address),
                headers=request.headers,
                stream=request.stream,
                extensions={**request.extensions, "sni_hostname": host},
            )
            pinned.headers["Host"] = request.headers.get("Host", host)
            try:
                return await self._inner.handle_async_request(pinned)
            except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                last = exc  # e.g. an IPv6 address this network cannot route: try the next one
        raise last or httpx.ConnectError(
            "The provider host has no usable address.", request=request
        )

    async def aclose(self) -> None:
        await self._inner.aclose()


def guarded_client(
    *,
    allow_local: bool,
    preset_hosts: frozenset[str] = frozenset(),
    resolver: Resolver = system_resolver,
    inner: httpx.AsyncBaseTransport | None = None,
    timeout: float = 110.0,
) -> httpx.AsyncClient:
    """An httpx client that cannot reach a disallowed address; redirects are followed (at most
    MAX_REDIRECTS) and each hop goes through the guard again."""
    return httpx.AsyncClient(
        transport=GuardedTransport(
            allow_local=allow_local, preset_hosts=preset_hosts, resolver=resolver, inner=inner
        ),
        follow_redirects=True,
        max_redirects=MAX_REDIRECTS,
        timeout=timeout,
    )
