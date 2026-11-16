"""In-memory sliding-window limiter for login and registration.

State lives in this process only: it resets on restart and is not shared between API replicas
(run more than one and each enforces its own count). Good enough for a single-container
deployment; use a shared store (Redis) before scaling out.

Every attempt counts, successful or not, per client IP and per (scope, email). Limits come from
`RATE_LIMIT_*` settings; a max of 0 turns that limit off.
"""

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


def client_ip(request: Request) -> str:
    """The peer address, or with RATE_LIMIT_TRUST_FORWARDED the last X-Forwarded-For entry.

    The last entry is the one appended by the reverse proxy closest to the API; earlier entries can
    be forged by the client. Only enable the setting behind a proxy that sets the header, otherwise
    anyone can pick their own bucket. Behind the bundled Next proxy alone the API sees the web
    container's address for every user, so the per-IP limit is then shared by all users.
    """
    if get_settings().rate_limit_trust_forwarded:
        forwarded = request.headers.get("x-forwarded-for", "")
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"


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
