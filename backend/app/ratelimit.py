"""In-memory sliding-window limiter for login and registration.

State lives in this process only: it resets on restart and is not shared between API replicas
(run more than one and each enforces its own count). Good enough for a single-container
deployment; use a shared store (Redis) before scaling out.

Every attempt counts, successful or not, per client IP and per (scope, email). Limits come from
`RATE_LIMIT_*` settings; a max of 0 turns that limit off.
"""

import ipaddress
import math
import time
from collections import deque

from fastapi import HTTPException, Request, status

from app.config import get_settings

_MAX_KEYS = 50_000  # hard cap on tracked keys; expired ones are swept first


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def clear(self) -> None:
        self._hits.clear()

    def _sweep(self, now: float, window: float) -> None:
        for key in [k for k, q in self._hits.items() if not q or q[-1] <= now - window]:
            del self._hits[key]

    def hit(self, key: str, limit: int, window: float, now: float | None = None) -> int:
        """Record an attempt. Returns 0 if allowed, else the seconds until it would be allowed."""
        if limit <= 0:
            return 0
        now = time.monotonic() if now is None else now
        queue = self._hits.get(key)
        if queue is None:
            if len(self._hits) >= _MAX_KEYS:
                self._sweep(now, window)
            queue = self._hits[key] = deque()
        while queue and queue[0] <= now - window:
            queue.popleft()
        if len(queue) >= limit:
            return max(1, math.ceil(queue[0] + window - now))
        queue.append(now)
        return 0


limiter = SlidingWindowLimiter()


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value.strip())
    except ValueError:
        return None


def client_ip(request: Request) -> str:
    """The socket peer, unless that peer is a configured trusted proxy (RATE_LIMIT_TRUSTED_PROXIES):
    then the last X-Forwarded-For entry (the address that proxy saw), if it is a valid IP.

    From any other peer the header is ignored, so a client cannot choose its own bucket. Caveat for the
    bundled web proxy: Next sets X-Forwarded-For to the client's address only when the client sent none
    and passes a client-supplied value through unchanged, so with :5173 exposed directly a client can
    still pick its bucket. The per-email limit is unaffected. Put a reverse proxy that overwrites the
    header in front of the web port if the per-IP limit has to hold against a determined client.
    """
    peer = request.client.host if request.client else "unknown"
    networks = get_settings().trusted_proxy_networks
    peer_ip = _parse_ip(peer)
    if networks and peer_ip is not None and any(peer_ip in net for net in networks):
        last = request.headers.get("x-forwarded-for", "").split(",")[-1]
        forwarded = _parse_ip(last)
        if forwarded is not None:
            return str(forwarded)
    return peer


def enforce(request: Request, scope: str, email: str) -> None:
    """Raise 429 with Retry-After if this IP or this email is over its limit. Call before hashing."""
    s = get_settings()
    window = float(s.rate_limit_window_seconds)
    waits = (
        limiter.hit(f"{scope}:ip:{client_ip(request)}", s.rate_limit_ip_max, window),
        limiter.hit(f"{scope}:email:{email.strip().lower()}", s.rate_limit_email_max, window),
    )
    if any(waits):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many attempts. Try again later.",
            headers={"Retry-After": str(max(waits))},
        )
