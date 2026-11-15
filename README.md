# coedit

A small-team workspace: co-edit docs and sheets live, keep other files with versions, and
ask an "AI council" to turn a brief into a Handoff Pack (`AGENTS.md`, `ARCHITECTURE.md`,
`PRD.md`) using your own API keys.

This is a demo slice, not a finished product. What works, what was cut and what was
never verified is listed honestly at the bottom. Licence: GPL-3.0-or-later (required by
HyperFormula).

## Setup

Needs Docker with Compose. Nothing else for running; Node 22 and `uv` only for development.

```bash
cp .env.example .env
# Fill the three secrets. Each line below prints one value:
python3 -c "import secrets,base64;print(base64.b64encode(secrets.token_bytes(32)).decode())"
#   APP_SECRET=...          (session cookies)
#   WS_TICKET_SECRET=...    (API -> sync tickets)
#   KEY_ENCRYPTION_KEY=...  (must be base64 of exactly 32 bytes)

docker compose up --build        # web :5173 · api :8000 · sync :1234 · db :5433 on the host
make seed SEED_PASSWORD='choose-a-password'   # optional demo data, in a second terminal
```

Open http://localhost:5173. Register, or after `make seed` sign in as `owner@example.com`,
`editor@example.com` or `viewer@example.com` with the password you chose.

Useful switches in `.env`:

| Variable | Meaning |
|---|---|
| `COUNCIL_FAKE=1` | The council uses canned text for all three providers: no keys, no network, no cost. |
| `COUNCIL_MODEL_ANTHROPIC` / `_OPENAI` / `_GOOGLE` | Model per live provider (defaults `claude-sonnet-5-5`, `gpt-6.1-terra`, `gemini-3.8-flash`). Each must have a price in `backend/app/council/prices.py` or in `COUNCIL_PRICES`, or the run refuses to start. |
| `COUNCIL_PRICES` | JSON `{"model-id": [input_usd_per_mtok, output_usd_per_mtok]}` to add or override prices. |
| `DB_PORT` | Host port for Postgres (default 5433, because 5432 is often taken). |

Two users in one browser: `http://localhost:5173` and `http://127.0.0.1:5173` keep separate
sessions, so you can sign in as a different user in each. Two browsers also work.

## Architecture

```
 browser  (Next.js app on :5173; its server proxies /api, the browser opens /sync itself)
   │
   ├── REST + httpOnly cookie ───────►  api   FastAPI :8000
   │                                     │  auth, workspaces, roles, folders, files,
   │                                     │  uploads, WS tickets, key storage, council runs
   │                                     ├──► Postgres 16   (everything except blob bytes)
   │                                     ├──► /data/blobs   (volume, files named by sha256)
   │                                     └──► LLM provider  (council only, server-side)
   │
   └── WebSocket :1234 + 60 s ticket ►  sync  Hocuspocus (Node) :1234
                                         │  verifies the ticket, viewers are read-only,
                                         └──► Postgres      (doc_states table only)
```

- **Roles** live on the workspace: owner, editor, viewer. Every API route checks the caller's
  role (`require_role`): non-members get 404, too-low roles get 403.
- **Live editing**: the browser asks the API for a ticket (`POST /api/files/{id}/ws-ticket`).
  The API checks membership and signs a 60-second ticket bound to that one file. The sync
  server only verifies it. A viewer's ticket makes the connection read-only *on the server*.
- **Docs** are TipTap on a Yjs `XmlFragment`; **sheets** are a Yjs map of raw cell strings,
  evaluated in each browser by HyperFormula. Import/export run in the browser.
- **Uploads** are streamed to disk under the hash of their bytes, limited to 50 MB, versioned,
  and only ever served as downloads (`attachment`, `application/octet-stream`, `nosniff`).
- **Council**: three drafts in parallel → each critiques the other two → one synthesis →
  files. Before each stage the whole stage's worst case is checked against the token and cost
  caps; a run that would exceed them stops as `capped`. Server maximum per run: 200k tokens / $5.
  Briefs and model outputs are passed to models only inside `<untrusted_source>` blocks.
- **Keys** are per user, AES-256-GCM encrypted, never returned (only the last 4 characters),
  never logged, and never included in error messages.

## Demo script

Preparation: `docker compose up --build`, `make seed SEED_PASSWORD=...`, and either put an
provider key in the council panel (one key is enough; the others take part as demo seats) or set `COUNCIL_FAKE=1` in `.env` (then `docker compose up -d api`).

1. **Two users.** Browser A: `http://localhost:5173`, sign in as `owner@example.com`. Browser B
   (or `http://127.0.0.1:5173`): sign in as `editor@example.com`. Both open workspace **Demo**.
2. **Doc.** Both open **Welcome**. Type in each: the other's text appears with a named,
   coloured caret. Try H1, bold, a list, a table, and `/` for the block menu.
3. **Sheet.** Both open **Budget**. Change a quantity in one browser: the totals
   (`=B2*C2`, `=SUM(...)`, `=AVERAGE(...)`) update in both. Type `=D5/0` somewhere to show an error value.
4. **Files.** In the sidebar click **+** then **Upload a file**; open it and **Upload new version**;
   download v1 and v2 from the versions table.
5. **Export.** In the sheet click **Export .csv** (computed values). In the doc, **Export .md**.
   Optionally **+ → Import .md or .csv** to create a new doc or sheet.
6. **Viewer.** Sign browser B in as `viewer@example.com`: no toolbar, no create buttons, typing
   does nothing, but the owner's edits still arrive live.
7. **Council.** As owner open **AI Council**, write a brief, choose the **Handoff** folder,
   keep the caps, **Run the Council**. Watch the stages, each provider's steps and the spend;
   when it is done, open the generated **AGENTS.md** (shown as plain text, downloadable).
8. **Restart.** `docker compose restart`, reload: documents, sheets and files are still there.

## Development

```bash
make dev        # db in Docker; api, sync and web on the host with reload
make test       # backend pytest + sync node tests + frontend vitest
make lint       # ruff, eslint, tsc
make licences   # fails on non-allowlisted production JS licences or any @tiptap-pro package
```

Backend tests use their own database (`coedit_test`), sync tests another (`coedit_sync_test`);
neither touches your data. `cd sync && npx tsx scripts/smoke.ts` runs an end-to-end check
against the running stack (it creates `smoke-*@example.com` users).

## What is cut, and why

| Cut or limited | Why |
|---|---|
| **No council provider has been run against its real API.** Anthropic, OpenAI and Google adapters all use the official SDKs and are tested against local stubs of each API (same contract suite for all three), never the real services. Model ids and prices were read from the vendors' pricing pages on 2026-11-15 and not otherwise verified; reasoning-effort/thinking parameters in particular may need adjusting for a given model. | The builder had no keys, and automated tests never call real APIs. First live run: use a small cap. |
| A provider without a key takes part as a **demo seat** (canned text, labelled "demo" in the panel). | Lets one key be enough to try the flow. |
| **Canvas and the admin console are previews.** They run on sample data (and simulated collaborators) and carry a "Preview" label. | No backend exists for either yet. Docs, sheets, files, members, keys and the Council use the real API. |
| The Council shows each provider's steps, tokens and spend, but not the models' text as it streams. | The API reports run steps and writes the result to files; the text of each draft is not exposed. |
| Council research from URLs (server-side fetch with SSRF guard) | Not built. |
| Playwright end-to-end tests | Stretch. UI was checked by hand in Chrome; logic is covered by unit and API tests. |
| Live revocation of open editing sessions | Role is checked when a ticket is issued. A removed member keeps an already-open socket until it reconnects (tickets last 60 s). |
| Server-side logout | Logout clears the cookie; the 7-day session token is not revoked on the server. |
| Cloud deploy, Google sign-in, share links, slides, PDF/docx/xlsx | Out of scope. |
| Sheet niceties (formatting, copy/paste ranges, more than 26×100) | Out of scope for the slice. |
| Drag-and-drop moves, workspace rename/delete, profile editing, upload progress, cancelling a council run | Not built; the API supports moving files and folders. |
| Garbage collection of blobs from deleted files | Not built; deleted files are soft-deleted and their bytes stay on the volume. |

Known rough edges: the whole sheet re-renders per keystroke (fine at this size); exported CSV does
not neutralise cells beginning with `+`, `-` or `@` for spreadsheet programs; doc comments live in
the same Yjs document as the text, so they have no separate permissions or notifications.
