"""Backstop against API keys reaching logs.

Keys are never logged on purpose; this scrubs anything key-shaped from every log record at
creation, so it also covers third-party and child loggers and every handler.
"""

import logging
import re

# sk-… (OpenAI, Anthropic), AIza… (Google), gsk_… (Groq), nvapi-… (NVIDIA), nct_… (NexusCloud
# service tokens). Keys of other
# OpenAI-compatible providers have no known shape: they are protected by never being logged.
_KEY_SHAPED = re.compile(
    r"sk-[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z_\-]{10,}|gsk_[A-Za-z0-9]{16,}|nvapi-[A-Za-z0-9_\-]{16,}|nct_[A-Za-z0-9_\-]{16,}"
)
REDACTED = "[redacted]"
_installed = False


def scrub(text: str) -> str:
    return _KEY_SHAPED.sub(REDACTED, text)


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    previous = logging.getLogRecordFactory()

    def factory(*args: object, **kwargs: object) -> logging.LogRecord:
        record = previous(*args, **kwargs)
        try:
            message = record.getMessage()
        except Exception:  # noqa: BLE001  (a malformed format string must not break logging)
            return record
        if _KEY_SHAPED.search(message):
            record.msg = scrub(message)
            record.args = None
        return record

    logging.setLogRecordFactory(factory)
