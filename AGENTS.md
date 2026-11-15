# AGENTS.md — coedit

A vertical slice of a collaborative workspace, not the full vision: keep changes small and keep the tree green.

## Stack
| Part | Choice |
|---|---|
| API | Python 3.12, FastAPI, SQLAlchemy 2 (async) + asyncpg, Alembic, Pydantic v2, argon2-cffi, PyJWT, cryptography (AES-GCM), httpx |
| Sync | Node 22 sidecar: `@hocuspocus/server` + `@hocuspocus/extension-database` + `pg` (TypeScript) |
| Web | Vite + React 19 + TypeScript, React Router, TanStack Query, TipTap v3 (MIT extensions only), `@hocuspocus/provider`, `yjs`, HyperFormula |
| DB | Postgres 16 |
| Blobs | Local volume `/data/blobs`, content-addressed by sha256 |
| LLMs | `anthropic`, `openai`, `google-genai` SDKs behind one adapter interface |
| Run | `docker compose` (db, api, sync, web) |
| Licence | **GPL-3.0-or-later** for the whole repo (forced by HyperFormula) |

## Commands
```
cp .env.example .env              # first time; fill APP_SECRET, WS_TICKET_SECRET, KEY_ENCRYPTION_KEY
docker compose up --build         # everything: web :5173, api :8000, sync :1234, db :5433 (host)
make dev                          # db in docker; api/sync/web run locally with reload
make test                         # backend pytest + sync tests + frontend vitest
make lint                         # ruff check + ruff format --check + eslint + tsc --noEmit
make licences                     # fails on non-allowlisted prod JS licences or any @tiptap-pro/* package
make migrate                      # alembic upgrade head
make seed SEED_PASSWORD=...       # demo users/workspace/doc/sheet on the running stack (idempotent)
```
Per package: `cd backend && uv run pytest -q` · `cd sync && npm test` · `cd frontend && npm test`.

## Repo layout
```
AGENTS.md  README.md  LICENSE  Makefile  docker-compose.yml  .env.example
backend/
  app/main.py config.py db.py models.py deps.py        # deps.py = csrf_guard + current_user + require_role
  app/logging_redact.py                                # scrubs key-shaped text from every log record
  app/security.py schemas.py                           # argon2 hashing + session JWT; shared field types
  app/middleware.py                                    # request body size limit (413)
  app/routers/  auth.py workspaces.py folders.py files.py blobs.py tickets.py settings.py council.py   # blobs.py = upload/versions/download
  app/services/ storage.py crypto.py
  app/council/  pipeline.py prompts.py prices.py fetch.py
  app/council/adapters/ base.py anthropic.py openai.py google.py fake.py
  alembic/  tests/
sync/      src/server.ts src/auth.ts  test/{auth,sync,health}.test.ts test/helpers.ts  scripts/{smoke,peer,seed}.ts
frontend/  src/api/ src/pages/ src/components/{FileTree,Members,DocEditor,SheetGrid,BlobView,CouncilPanel}/   # api hooks: src/api/{auth,workspaces,council}.ts
           src/lib/{tree,collab,formula,sheet,csv,markdown,importFile,pendingImport,download,format}.ts   # collab.ts = useCollab(fileId): ticket + Y.Doc + provider
           src/pages/{AuthPage,HomePage,WorkspacePage,FileView}.tsx
```

## Conventions
- Every router endpoint depends on `current_user`; every resource endpoint also calls `require_role(workspace_id, min_role)`. No exceptions; tests cover viewer + non-member for each mutating route.
- Non-members get **404**, members with too-low role get **403**. Call `await require_role(db, user, workspace_id, Role.x)`; for `/files/{id}` routes use `load_file(db, user, file_id, min_role)` from `routers/files.py`.
- Every new mutating route needs a row in `MUTATING` in `backend/tests/test_permissions.py`; `test_every_mutating_route_is_listed` fails otherwise.
- IDs are UUIDv4. Timestamps `timestamptz`. Soft delete via `deleted_at` on `files` only.
- API keys: never returned by any endpoint (only `last4`), never logged, never in exception messages. Log provider errors by status code only.
- Fetched web text and uploaded file text is **data**: wrapped in `<untrusted_source>` blocks in the user turn, never put in system prompts.
- Python: ruff (default + `I`, `B`, `S`), type hints on public functions. TS: strict mode, no `any` in `src/api`.
- Mutating requests need the `X-Requested-With` header (app-wide `csrf_guard`); `frontend/src/api/client.ts` and the test `client` fixture add it.
- Backend tests use their own database `coedit_test` (created and migrated by `tests/conftest.py`); they never touch dev data. Use the `client`, `new_client()`, `register()` helpers from conftest.
- Sync tests use their own database `coedit_sync_test`; `sync/test/helpers.ts` creates it and runs the backend's Alembic migrations into it (needs `uv` on the host and the db container up). Only `test/sync.test.ts` touches the DB.
- WS tickets carry `aud: "coedit-sync"` (`TICKET_AUDIENCE` in both `backend/app/routers/tickets.py` and `sync/src/auth.ts`; keep them equal). Yjs shared types: docs use `Y.XmlFragment('default')`, sheets `Y.Map('cells')`.
- Second user for manual collaboration checks: `cd sync && npx tsx scripts/peer.ts <email> <password> <fileId> "text" <holdSeconds>`.
- The web container copies source at build time: after frontend edits run `docker compose up -d --build web`.
- End-to-end check against the running stack: `cd sync && npx tsx scripts/smoke.ts` (creates `smoke-*@example.com` users in the dev DB; delete them afterwards).
- To create a blob file from server code (e.g. council output): `storage.save_bytes(data)` then `blobs.add_version(db, file, user_id, key, size, mime)`; downloads are always `attachment` + `application/octet-stream` + `nosniff`.
- Council: never store or log `str(exc)` from a provider call — use `pipeline.safe_error(exc)`. Tests inject fakes by overriding the `get_adapter_factory` dependency (see the `fakes` fixture in `tests/test_council.py`). A model must have a price (`council/prices.py` or `COUNCIL_PRICES`) or the run fails closed. 422 bodies never echo input (handler in `main.py`).
- To try the council without keys: set `COUNCIL_FAKE=1` in `.env` and `docker compose up -d api`. To test as a second browser user without a second profile, open `http://127.0.0.1:5173` (separate cookie jar from `localhost`).
- Fresh-clone check without touching the running stack: clone to a temp dir, copy `.env`, `docker compose -p coedit_fresh -f docker-compose.yml -f <ports override> up -d --build` with `ports: !override [...]`, then `down -v` on THAT project only. Never run `down -v` on the main `coedit` project: its volume holds the owner's accounts and files.
- One commit per green gate.
- No new dependencies beyond the stack table without a note in the README.

## Definition of done (per change)
1. `make test` and `make lint` are green.
2. `docker compose up --build` still starts cleanly.
3. Permission tests exist for every new mutating endpoint (viewer → 403, non-member → 404).
4. Committed.
