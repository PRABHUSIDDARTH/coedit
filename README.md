# coedit

A small-team workspace: co-edit docs and sheets live, keep other files with versions, and
ask an "AI council" to turn a brief into a Handoff Pack (`AGENTS.md`, `ARCHITECTURE.md`,
`PRD.md`) using your own API keys.

This is a demo slice, not a finished product. What works, what was cut and what was
never verified is listed honestly at the bottom. Licence: GPL-3.0-or-later (required by
HyperFormula).

## Stack

| Part | Choice |
|---|---|
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, next-themes, TanStack Query, Zustand, TipTap v3 (MIT extensions only), Yjs + `@hocuspocus/provider`, HyperFormula, Excalidraw, pnpm |
| API | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2 |
| Sync | Node 22, Hocuspocus server, Postgres persistence |
| Data | Postgres 16; uploaded files on a local volume, addressed by sha256 |
| AI | Official `anthropic`, `openai` and `google-genai` SDKs behind one adapter interface |

## What works against the real backend

Sign-up and login, workspaces with owner/editor/viewer roles, the file tree (folders, rename,
delete, import, upload), live-collaborative docs and sheets with cursors and presence, file
uploads with versions and download, members, per-user provider keys, and the AI Council.
Canvas and the admin console are labelled **Preview** and use sample data (see the table at the bottom).

## Setup

Needs Docker with Compose. Nothing else for running; Node 22 and `uv` only for development.

```bash
make env                          # writes .env with random secrets (mode 600, gitignored, nothing printed)
                                  # refuses to overwrite an existing .env
docker compose up --build        # web :5173 · api :8000 · sync :1234 · db :5433, the last three on 127.0.0.1 only
make seed SEED_PASSWORD='choose-a-password'   # optional demo data, in a second terminal
```

**Network exposure.** Postgres, the API and the sync server are published on `127.0.0.1` only; only the
web port (:5173) listens on all interfaces. The browser opens the sync WebSocket on port 1234 of the page's
host, so a second machine opening `http://<your-ip>:5173` can use the app but cannot co-edit until you
publish `:1234` yourself (or route `/sync` through a reverse proxy and set `NEXT_PUBLIC_SYNC_URL`).
`.env.example` ships empty secrets on purpose, and `docker compose` refuses an empty `POSTGRES_PASSWORD`.
An existing `.env` keeps working unchanged (the Postgres volume was initialised with its password).

Open http://localhost:5173. Register, or after `make seed` sign in as `owner@example.com`,
`editor@example.com` or `viewer@example.com` with the password you chose.

Useful switches in `.env`:

| Variable | Meaning |
|---|---|
| `COUNCIL_FAKE=1` | The council uses canned text for all three providers: no keys, no network, no cost. |
| `COUNCIL_MODEL_ANTHROPIC` / `_OPENAI` / `_GOOGLE` | Model per live provider (defaults `claude-sonnet-5-5`, `gpt-6.1-terra`, `gemini-3.8-flash`). Each must have a price in `backend/app/council/prices.py` or in `COUNCIL_PRICES`, or the run refuses to start. |
| `COUNCIL_ALLOW_LOCAL_PROVIDERS=1` | Lets OpenAI-compatible seats use private / loopback / link-local addresses and hosts that are not presets (Ollama on this machine, a LAN server). **Off by default. Must stay off in any hosted or multi-user deployment** (see "OpenAI-compatible seats"). |
| `COUNCIL_PROVIDER_PRESETS` | JSON `{"id": {"label": "...", "base_url": "https://.../v1", "needs_key": true}}`: extra OpenAI-compatible presets. Their hosts are allowed like Groq's. |
| `COUNCIL_PRICES` | JSON `{"model-id": [input_usd_per_mtok, output_usd_per_mtok]}` to add or override prices. |
| `STORAGE_BACKEND` | `local` (default: the `/data/blobs` volume) or `nexuscloud`. See "Optional: NexusCloud storage". |
| `DB_PORT` | Host port for Postgres (default 5433, because 5432 is often taken). |
| `API_TARGET` | Where the Next server proxies `/api` (read at runtime; Compose sets `http://api:8000`; default for local dev `http://localhost:8000`). |
| `NEXT_PUBLIC_SYNC_URL` | Overrides the sync WebSocket address. Baked in at build time; empty means unset. By default the browser connects to port 1234 on the page's own host. |

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
   │                                     │    or NexusCloud (optional, STORAGE_BACKEND=nexuscloud)
   │                                     └──► LLM provider  (council only, server-side)
   │
   └── WebSocket :1234 + 60 s ticket ►  sync  Hocuspocus (Node) :1234
                                         │  verifies the ticket, viewers are read-only,
                                         └──► Postgres      (doc_states table only)
```

- **Frontend routes**: `/` landing, `/login`, `/signup`, `/app/*` (doc, sheet, file, council, settings, canvas preview) and `/admin/*` (preview). `/api/*` is a streaming proxy route in the Next server; it forwards cookies and the CSRF header and streams 50 MB uploads. Next cannot proxy WebSockets, so the browser reaches the sync server directly on `:1234`: if you deploy behind a reverse proxy, expose that port or route `/sync` yourself and set `NEXT_PUBLIC_SYNC_URL`.
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

## OpenAI-compatible seats (Groq, NVIDIA NIM, Ollama, any `/v1` server)

In the Council panel, **Add seat** adds a seat that talks to any OpenAI-style Chat Completions
endpoint. Pick a preset (Groq, NVIDIA NIM, Ollama) or enter a base URL, paste a key if the
provider needs one, press **Test & load models** (calls `GET {base}/models`, or Ollama's
`/api/tags` if `/models` is unavailable; if neither works you type the model id by hand), then set
the model's price (USD per million tokens in and out; `0` = free or local) and the seat's own
token cap. A seat without a price is refused with a message: the cost cap would be meaningless.

- No model ids or prices are hardcoded for these providers: you choose the model and the price per seat.
- The per-run cost cap and token cap still apply to the whole council; the seat token cap
  additionally limits one seat (its output allowance is clamped to what is left, and a seat with
  almost nothing left sits the stage out; the run continues without it).
- Each critique ends with a `SCORES: {...}` line. Parsing is tolerant (code fences, single quotes,
  `7/10`, lists instead of JSON). If a seat's critique cannot be parsed it is marked failed for that
  round, shown under **Run report**, and the run carries on with the other seats.
- **The key for these seats is typed per run and held in memory only.** It is not stored (the
  encrypted key store only knows the three built-in providers) and is never logged or returned.
  Keys of other providers have no recognisable shape for the log scrubber; they are protected by never being logged.
- With seats added, the council is the seats plus any built-in provider you saved a key for (no demo seats alongside).
  Any seat, including a custom one, can write the final.

### Running Ollama locally

1. Install and start Ollama on the host (`ollama serve`; `ollama pull <model>`).
2. Make it reachable from the api container. Ollama listens on `127.0.0.1` by default, which the
   container cannot reach: start it with `OLLAMA_HOST=0.0.0.0` (or the host's docker bridge address).
   Anything that can reach that port can use your Ollama, so firewall it.
3. In `.env` set `COUNCIL_ALLOW_LOCAL_PROVIDERS=1`, then `docker compose up -d api`.
   `docker-compose.yml` maps `host.docker.internal` to the host (`extra_hosts: host-gateway`), so the
   Ollama preset (`http://host.docker.internal:11434/v1`) works on Linux too.
4. Add an Ollama seat, load models, set both prices to `0`, set a token cap.

### Optional: NexusCloud storage (experimental)

New file versions (uploads, new versions, council output) can be stored through a NexusCloud
service token instead of the local volume. The API calls NexusCloud's REST API to get presigned
URLs and moves the bytes to and from the user's own bucket; the returned key is stored with the
version. Server-side only: nothing in the browser changes.

```
STORAGE_BACKEND=nexuscloud
NEXUSCLOUD_BASE_URL=https://nexus.example.com
NEXUSCLOUD_TOKEN=nct_...          # created in NexusCloud: POST /api/v1/auth/service-tokens
```

- **Status: tested only against a stub** (`backend/tests/test_nexuscloud_backend.py`). It has never
  been run against a real NexusCloud deployment or a real cloud bucket, and needs the NexusCloud
  `service-tokens` branch, which is not in a released version.
- Default is `local`; with no NexusCloud settings Coedit behaves exactly as before. Each version
  records which backend holds it, so switching the setting leaves older versions readable.
- The token is sent only to `NEXUSCLOUD_BASE_URL`, never to the presigned URL, and is scrubbed from
  logs. Errors from the backend are reduced to an HTTP status.
- SSRF: the base URL and every presigned URL must be https with no credentials and resolve only to
  public addresses; redirects are never followed. `NEXUSCLOUD_ALLOW_PRIVATE=1` relaxes this (http,
  private/loopback) for a compose network or a stub. **Keep it off in any hosted deployment.**
- Limits: each upload is held in memory/temp disk (max 50 MB) while its size and hash are taken,
  because NexusCloud needs the size up front. Delete is implemented but Coedit never deletes
  stored versions (as today); it is used only to clean up an upload whose database write failed.
  Downloads are streamed through the API (no Range/ETag, unlike local files).
  Exports are generated in the browser and large Yjs snapshots live in Postgres (`doc_states`);
  neither goes through the storage backend.

### The SSRF flag, `COUNCIL_ALLOW_LOCAL_PROVIDERS`

Seat base URLs are user input, and the api server makes the request. Default policy: the host
must be a preset host (Groq, NVIDIA NIM, the Ollama name, plus `COUNCIL_PROVIDER_PRESETS`), and
**every address it resolves to must be public**; otherwise the seat is rejected. The name is
resolved and re-checked at connect time and the connection goes to the checked address (so DNS
rebinding between check and use does not work); redirects are followed at most 3 hops and every hop
is re-checked, so a provider cannot bounce the server to `169.254.169.254` or an internal host.
Because the Ollama preset points at a private address, it needs the flag too.

`COUNCIL_ALLOW_LOCAL_PROVIDERS=1` switches those checks off: any host, any address. That is right on
your own machine and **wrong in any hosted deployment**, where a user could make the server call
your internal network, cloud metadata service or other containers. Keep it `0` there.

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
make dev        # db in Docker; api, sync and web (next dev) on the host with reload
make test       # backend pytest + sync node tests + frontend vitest
make lint       # ruff, eslint, tsc
make licences   # fails on non-allowlisted production JS licences or any @tiptap-pro package
```

The web app lives in `frontend/` and uses pnpm. `pnpm dev` and `pnpm build` run Next with
webpack, because Turbopack cannot resolve packages on an NTFS checkout. After frontend edits,
the Docker `web` service needs `docker compose up -d --build web`.

Backend tests use their own database (`coedit_test`), sync tests another (`coedit_sync_test`);
neither touches your data. `cd sync && npx tsx scripts/smoke.ts` runs an end-to-end check
against the running stack (it creates `smoke-*@example.com` users).

## What is cut, and why

| Cut or limited | Why |
|---|---|
| **No council provider has been run against its real API, including Groq, NVIDIA NIM and Ollama.** The Anthropic, OpenAI and Google adapters use the official SDKs and the OpenAI-compatible adapter uses the OpenAI SDK; all are tested against local stubs of each API (one contract suite; the Groq, NIM and Ollama stubs mimic those servers' reply shapes from their documented behaviour, not from recorded traffic), never the real services. For the compatible providers the model list, `max_tokens` spelling, usage fields and Ollama's `/api/tags` fallback are the likeliest to differ from the stubs. Model ids and prices were read from the vendors' pricing pages on 2026-11-15 and not otherwise verified; reasoning-effort/thinking parameters in particular may need adjusting for a given model. | The builder had no keys, and automated tests never call real APIs. First live run: use a small cap. |
| A provider without a key takes part as a **demo seat** (canned text, labelled "demo" in the panel). | Lets one key be enough to try the flow. |
| **Canvas and the admin console are previews.** They run on sample data (and simulated collaborators) and carry a "Preview" label. | No backend exists for either yet. Docs, sheets, files, members, keys and the Council use the real API. |
| The Council shows each provider's steps, tokens and spend, but not the models' text as it streams. | The API reports run steps and writes the result to files; the text of each draft is not exposed. |
| Council research from URLs (server-side fetch with SSRF guard) | Not built. |
| Playwright end-to-end tests | Stretch. Logic is covered by unit and API tests. The UI was checked by hand in Chrome for sign-up, docs, sheets, upload and the Council; sync with a second user was checked with a scripted peer, and the viewer view, share/members dialogs, rename/delete dialogs and import were not exercised in a browser. |
| Live revocation of open editing sessions | Role is checked when a ticket is issued. A removed member keeps an already-open socket until it reconnects (tickets last 60 s). |
| Server-side logout | Logout clears the cookie; the 7-day session token is not revoked on the server. |
| Cloud deploy, Google sign-in, share links, slides, PDF/docx/xlsx | Out of scope. |
| Sheet niceties (formatting, copy/paste ranges, more than 26×100) | Out of scope for the slice. |
| Drag-and-drop moves, workspace rename/delete, profile editing, upload progress, cancelling a council run | Not built; the API supports moving files and folders. |
| Garbage collection of blobs from deleted files | Not built; deleted files are soft-deleted and their bytes stay on the volume. |

Known rough edges: the whole sheet re-renders per keystroke (fine at this size); exported CSV does
not neutralise cells beginning with `+`, `-` or `@` for spreadsheet programs; doc comments live in
the same Yjs document as the text, so they have no separate permissions or notifications.
