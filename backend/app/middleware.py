"""ASGI middleware."""

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import get_settings

# Room for multipart boundaries and the other form fields around a maximum-size file.
_OVERHEAD = 1024 * 1024


class _BodyTooLarge(Exception):
    pass


class BodySizeLimitMiddleware:
    """Reject request bodies larger than the upload limit before they are buffered.

    FastAPI spools a multipart body to disk before the endpoint runs, so the limit has to be
    enforced here: by Content-Length when present, and by counting bytes as they arrive.
    The exact per-file limit is checked again in `services/storage.py`.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = get_settings().max_upload_bytes + _OVERHEAD
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._discard(receive, cap=4 * limit)
            await self._reject(send)
            return

        received = 0
        started = False

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _BodyTooLarge:
            if not started:
                await self._reject(send)

    @staticmethod
    async def _discard(receive: Receive, cap: int) -> None:
        """Read and drop the body (nothing is stored) so a proxy in front can still deliver
        the 413 instead of reporting a broken connection. Gives up after `cap` bytes."""
        dropped = 0
        while dropped <= cap:
            message = await receive()
            if message["type"] != "http.request":
                return
            dropped += len(message.get("body", b""))
            if not message.get("more_body"):
                return

    @staticmethod
    async def _reject(send: Send) -> None:
        mb = get_settings().max_upload_bytes // (1024 * 1024)
        body = json.dumps({"detail": f"File is too large (limit {mb} MB)"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
