#!/usr/bin/env python3
"""Create .env from .env.example with freshly generated secrets. Prints no secret.

Refuses to touch an existing .env: the Postgres volume was initialised with the password in it,
so replacing it would lock the stack out of its own data.
"""

import base64
import os
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / ".env"
EXAMPLE = ROOT / ".env.example"


def generated() -> dict[str, str]:
    return {
        # Hex only: the password is embedded in the DATABASE_URLs that docker-compose.yml builds.
        "POSTGRES_PASSWORD": secrets.token_hex(24),
        "APP_SECRET": secrets.token_urlsafe(48),
        "WS_TICKET_SECRET": secrets.token_urlsafe(48),
        # base64 of exactly 32 bytes (AES-256-GCM key)
        "KEY_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
    }


def build(example: str, values: dict[str, str]) -> str:
    out, seen = [], set()
    for line in example.splitlines():
        key = line.split("=", 1)[0]
        if "=" in line and not line.startswith("#") and key in values:
            line = f"{key}={values[key]}"
            seen.add(key)
        out.append(line)
    missing = set(values) - seen
    if missing:
        raise SystemExit(f"make_env: .env.example has no line for {sorted(missing)}")
    user = next(
        (ln.split("=", 1)[1] for ln in out if ln.startswith("POSTGRES_USER=")), "coedit"
    )
    db = next((ln.split("=", 1)[1] for ln in out if ln.startswith("POSTGRES_DB=")), "coedit")
    port = next((ln.split("=", 1)[1] for ln in out if ln.startswith("DB_PORT=")), "5433")
    out += [
        "",
        "# Host-side development and tests (make dev, make test). Compose overrides this for api/sync.",
        f"DATABASE_URL=postgresql+asyncpg://{user}:{values['POSTGRES_PASSWORD']}@localhost:{port}/{db}",
    ]
    return "\n".join(out) + "\n"


def main() -> int:
    if TARGET.exists():
        print(".env already exists; not touching it. Delete it first if you really want new secrets")
        print("(that also means a new Postgres volume: `docker compose down -v` on a stack you can lose).")
        return 1
    text = build(EXAMPLE.read_text(), generated())
    fd = os.open(TARGET, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(text)
    print("Wrote .env (mode 600, gitignored) with generated secrets; none are shown.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
