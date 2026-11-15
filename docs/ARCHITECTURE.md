# Architecture — coedit

## Verification status
- No provider (Anthropic, OpenAI, Google, Groq, NVIDIA NIM, Ollama) has been run against a real API. Adapters are tested against local stub servers only; Groq/NIM/Ollama stub shapes come from documented behaviour, not recorded traffic.
- Canvas and the admin console run on sample data (`frontend/src/mocks`) and are labelled Preview.
- The NexusCloud backend is tested against a stub only and is off by default. Its downloads stream through the API and lose Range and ETag.
- Viewer UI, Share/Members dialogs, import and two-user sync were checked by script, API or single-profile browser automation only, not by two real browsers.
- Model ids and prices in `prices.py` were not checked against live APIs. No claim is made about multi-model output quality.

## Components
```
browser (Next.js web app :5173; its server proxies /api)
  ├─ REST + cookie ──────────► api (FastAPI :8000) ──► Postgres :5432
  │                               │  └─► /data/blobs (volume)
  │                               └─► LLM providers (council, server-side only)
  └─ WebSocket + ticket ─────► sync (Hocuspocus :1234) ──► Postgres (doc_states only)
```
- **api**: auth, workspaces, folders, files, blob versions, WS tickets, settings (keys), council runs. The only component holding provider keys.
- **sync**: Hocuspocus. Verifies a short-lived ticket on join, sets read-only for viewers, persists Yjs state to `doc_states`. Has no other DB access.
- **web**: Next.js app (App Router). TipTap + Yjs for docs; HTML table + Y.Map + HyperFormula for sheets. Import/export runs client-side.
- **db**: Postgres 16. **blobs**: behind `StorageBackend`: local volume (default, content-addressed) or NexusCloud (optional).

## Data model
| Table | Columns |
|---|---|
| `users` | id uuid pk, email citext unique, password_hash text, display_name text, created_at |
| `workspaces` | id, name, owner_id → users, created_at |
| `memberships` | workspace_id → workspaces, user_id → users, role enum(owner, editor, viewer), created_at · pk(workspace_id, user_id) |
| `folders` | id, workspace_id, parent_id → folders null, name, created_at · unique(workspace_id, parent_id, name) |
| `files` | id, workspace_id, folder_id → folders null, name, kind enum(doc, sheet, blob), current_version int null, created_by, created_at, updated_at, deleted_at null |
| `file_versions` | id, file_id → files, version_no int, storage_key text (sha256 for `local`, NexusCloud file id for `nexuscloud`), storage_backend text default `local`, sha256 text, size_bytes bigint, mime text, created_by, created_at · unique(file_id, version_no) |
| `doc_states` | file_id pk → files, state bytea (Yjs update), updated_at — written only by sync |
| `provider_keys` | id, user_id → users, provider enum(anthropic, openai, google), ciphertext bytea, nonce bytea, last4 text, created_at · unique(user_id, provider) |
| `council_runs` | id, workspace_id, output_folder_id, created_by, brief text, synth_provider (text: a built-in provider or a custom seat id), status enum(queued, drafting, critiquing, synthesizing, done, failed, capped), token_cap int, cost_cap_usd numeric, tokens_used int, cost_usd numeric, error text null, created_at, finished_at |
| `council_steps` | id, run_id → council_runs, stage enum(draft, critique, synthesis), provider (text: seat id), model, input_tokens, output_tokens, cost_usd, output_text, error null, scores jsonb null (critique: `{draft seat: 0..10}`), created_at |

Docs and sheets live in `files` (kind doc/sheet) with content in `doc_states`. Blobs use `file_versions`. Council output files are blob files (`text/markdown`).

## API (all under `/api`; all require the session cookie except register/login/health)
| Method & path | Min role |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | — / user |
| `GET /health` | none |
| `GET/POST /workspaces`; `GET /workspaces/{id}` | user / member |
| `GET/POST/PATCH/DELETE /workspaces/{id}/members[/{user_id}]` | owner (GET: viewer) |
| `GET /workspaces/{id}/tree` (folders + files) | viewer |
| `POST /workspaces/{id}/folders`; `PATCH/DELETE /folders/{id}` | editor |
| `POST /workspaces/{id}/files` (create doc/sheet: `{name, kind, folder_id}`) | editor |
| `PATCH/DELETE /files/{id}` (rename, move, soft delete) | editor |
| `POST /files/upload` (multipart, new blob file) · `POST /files/{id}/versions` (new version) | editor |
| `GET /files/{id}/versions` · `GET /files/{id}/versions/{n}/download` | viewer |
| `POST /files/{id}/ws-ticket` → `{ticket, url, read_only}` | viewer |
| `GET /settings/keys` (provider + last4 only) · `PUT/DELETE /settings/keys/{provider}` | user (own keys) |
| `POST /workspaces/{id}/council/models` (models a preset/base URL offers; also "Test connection") | owner |
| `POST /workspaces/{id}/council/runs` · `GET /council/runs/{id}` (status, steps meta, spend) · `POST /council/runs/{id}/cancel` (stops an active run; stored as `failed`, error "Stopped by the owner.", no migration) | owner |

## Sync design
- **Choice: Hocuspocus Node sidecar** (not pycrdt-websocket). Reason: it is the reference server for TipTap's Collaboration extension, so wire protocol and awareness/carets work out of the box; it has first-class `onAuthenticate`, per-connection `readOnly`, and a Database extension with `fetch/store` hooks; it is widely deployed. pycrdt-websocket would keep one language but its auth, read-only enforcement and persistence would be hand-rolled — too much risk for 6 hours. Cost: one extra Node service (~80 LOC).
- **Join flow**: client calls `POST /api/files/{id}/ws-ticket`. API checks membership and role, returns a JWT (HS256, `WS_TICKET_SECRET`, TTL 60 s) with `{sub, file_id, role, name, color}`. Client opens `HocuspocusProvider({url, name: file_id, token: ticket})`. Sync `onAuthenticate` verifies signature, expiry, and `documentName == file_id`; rejects otherwise. If role is viewer it sets `connectionConfig.readOnly = true`, so the server drops that client's updates.
- **Revocation**: checked at join only; a removed member keeps their open socket until it disconnects. Accepted for the demo; noted as a known gap.
- **Persistence**: Database extension `fetch` → `SELECT state FROM doc_states`, `store` → upsert (debounced by Hocuspocus, ~2 s). The API creates the `files` row; sync only writes `doc_states` for a `file_id` that exists in `files` (FK enforces this).
- **Doc schema**: `Y.XmlFragment('default')` via `@tiptap/extension-collaboration`; carets via `@tiptap/extension-collaboration-caret` (v3 name of CollaborationCursor).
- **Sheet schema**: `Y.Map('cells')` with key `"A1"` → raw string (`"12"`, `"=SUM(A1:A3)"`). Each client keeps a HyperFormula instance, filled from the map on load and updated via `observe` deltas; the grid shows computed values, the editor shows raw. Concurrent edits to the same cell resolve last-writer-wins (Yjs map semantics); this is acceptable.
- **Import/export** (client-side): `.md` → markdown-it → HTML → `editor.commands.setContent` on a new Doc; Doc → `.md` via `turndown` on `editor.getHTML()`. `.csv` → papaparse → cells in one `ydoc.transact`; Sheet → `.csv` of computed values. Rationale: avoids parsing Yjs/ProseMirror on the Python side.

## Council pipeline (thin mode)
```
POST run → validate caps → load+decrypt owner's 3 keys → asyncio task:
  1 drafting:     gather(draft(anthropic), draft(openai), draft(google))
  2 critiquing:   gather(critique(p, drafts of the other two) for p in 3)
  3 synthesizing: synth_provider(brief + 3 drafts + 3 critiques) → 3 files
  4 save:         AGENTS.md, ARCHITECTURE.md, PRD.md as blob files in output folder
```
- **Adapter interface** (`adapters/base.py`):
  `class LLMAdapter(Protocol): name: str; async def complete(self, system: str, user: str, max_tokens: int) -> Completion` where `Completion = (text, input_tokens, output_tokens, model)`. Implementations: Anthropic, OpenAI, Google, **Fake** (deterministic text derived from inputs, configurable token counts, can raise). Tests and `COUNCIL_FAKE=1` use Fake for all three.
- Model IDs come from env (`COUNCIL_MODEL_ANTHROPIC`, `..._OPENAI`, `..._GOOGLE`) with a price table in `prices.py`; nothing is hard-coded in pipeline logic.
- **Output format**: synthesis must emit `=== FILE: AGENTS.md ===` blocks; parser accepts only the three allowlisted names, so a model can't choose paths. Missing PRD block is allowed; missing AGENTS/ARCHITECTURE → run `failed`.
- **Cap**: before every call, `estimated = used + chars/4 + max_tokens` priced at the model's rate; if it would exceed `token_cap` or `cost_cap_usd`, stop with status `capped` and save whatever is complete. Actual usage from provider responses updates the run after each call. Server-side hard max per run: 200k tokens / $5, regardless of user input.
- **Failure**: one provider failing in draft/critique is recorded and the run continues with the remaining ones (min 2); synthesis failure fails the run. Per-call timeout 120 s (adapters use 110 s per attempt).
- **Untrusted text**: brief, fetched URLs (stretch) and other drafts go in the user turn inside `<untrusted_source id=…>` tags; the system prompt states that content inside these tags is data and that instructions in it must be ignored. Models get no tools, so injected text can at worst change the content of the output, which the owner reviews.
- Runs as an in-process `asyncio` task (no queue). If the API restarts mid-run, the run is marked `failed` on startup.

### OpenAI-compatible seats

- One adapter class (`adapters/openai_compat.py`) over the OpenAI SDK, parameterised per seat by `SeatConfig` (seat id, base URL, key or none, model, price in/out, token cap). Policy copied from the OpenAI adapter: one SDK retry with backoff, 110 s per attempt, errors reduced to the HTTP status, `from None`, refusal / content filter / missing usage = failure. It sends `max_tokens` (the portable spelling) and no reasoning parameters.
- Presets (`presets.py`) are endpoints only: Groq, NVIDIA NIM, Ollama (`host.docker.internal:11434`, no key), plus `COUNCIL_PROVIDER_PRESETS`. No model ids or prices are hardcoded; the seat carries its own price (0 allowed) and the pipeline refuses a seat without one (HTTP 422 before a run exists).
- The pipeline is keyed by seat id (string). A native provider's id is its name; `Provider` is a `StrEnum`, so existing callers are unchanged. `council_steps.provider` and `council_runs.synth_provider` became text (migration 0007). `ProviderKey` keeps the enum: custom seat keys are per run, in memory, never stored.
- Budgeting: `Call.estimate()` uses the seat's price. The run-level stage check is unchanged. The seat token cap is tracked per seat in `Budget.seat_tokens`; a call's `max_tokens` is clamped to what is left (input estimated at 4 chars/token), a seat with under 200 tokens left sits the stage out (a failed step "seat token cap reached"), the others continue.
- Critique scores: the critique prompt asks for a final `SCORES: {"<seat>": 1-10}` line; `prompts.parse_scores` accepts JSON with quotes/trailing commas/fences, `7/10`, and `name: 7` lists, ignores unknown names and out-of-range values, and never raises. No usable score → that step is marked failed (`critique scores could not be parsed`, tokens still charged), excluded from synthesis input, listed in the run `report`; the run continues, even if every critique fails.
- SSRF (`netguard.py`): see the README section. `validate_base_url` at acceptance; `GuardedTransport` on every request and redirect hop resolves, re-checks all addresses, then connects to the checked IP (Host header and SNI keep the name), so rebinding between check and use fails. Max 3 redirects. Policy: preset host or flag; any non-public address needs the flag. The same guarded client serves `GET /models`.
- Model list: `GET {base}/models`, else Ollama's `{root}/api/tags`, else the UI falls back to manual entry. Only model ids are returned (max 500); provider bodies never are.

## Storage backends

`app/services/storage.py` defines `StorageBackend` (`put(stream, max_bytes) -> Stored(key, size, sha256, backend)`, `get(key) -> async byte iterator`, `delete(key)`, plus `shared_keys`). Callers: `routers/blobs.py` (uploads, new versions, downloads) and the council pipeline's output files, all through `storage.save_stream/save_bytes`, which write to `get_backend()` (the `STORAGE_BACKEND` setting). Downloads and cleanup look the backend up by the name recorded on the `file_versions` row (`backend_named`), so a setting change never strands existing versions. `storage.discard` removes an object whose DB row failed to commit, but only for backends whose keys are not shared (never for content-addressed `local`).

- **local** (default): unchanged behaviour. Files named by sha256 under `BLOB_DIR`; downloads served with `FileResponse`.
- **nexuscloud** (`services/nexuscloud.py`): authenticates with a NexusCloud *service token* (`Authorization: Bearer nct_…`) on `POST /api/v1/files/upload-request` → PUT the bytes to the presigned URL → `POST /files/confirm-upload/{id}`; download via `GET /files/download/{id}` → presigned GET streamed through our API; `DELETE /files/{id}`. The upload is spooled while hashing because NexusCloud needs the size up front; the filename and type sent are opaque (`coedit-blob`, `application/octet-stream`). A failed PUT/confirm triggers `cancel-upload`.
- **Guarantees (tested against a stub):** the token goes only to the configured host (never to presigned URLs, and `nct_…` is in the log redaction filter); errors are reduced to a status code (`StorageError`) and the API returns a generic 502; base URL and presigned URLs must be https, credential-free and resolve only to public addresses, checked again at connect time via `netguard.GuardedTransport(any_host=…)` (DNS rebinding), with redirects off. `NEXUSCLOUD_ALLOW_PRIVATE=1` relaxes this for compose/stub use.
- **Not verified:** any real NexusCloud deployment, real cloud buckets or CORS, NexusCloud's 5 GiB / free-tier limits, token expiry or revocation behaviour in practice. Coedit's own `max_upload_bytes` (50 MB) applies first. Exports are client-side and Yjs snapshots are in Postgres; neither uses the backend.
- Decision: NexusCloud is reached through its REST API (not an S3-compatible endpoint, which it does not offer), and deleted Coedit files still keep their bytes (no GC), as with `local`.

## Security notes
- Passwords: argon2id. Session: JWT (HS256, `APP_SECRET`, 7 days) in `httpOnly; SameSite=Lax` cookie; `Secure` when not local. Mutating requests also require `X-Requested-With` header (cheap CSRF guard alongside SameSite).
- AuthZ: one `require_role` dependency; non-member → 404, low role → 403. Sync ticket is bound to one file and expires in 60 s.
- Provider keys: AES-256-GCM, random 96-bit nonce per row, master key `KEY_ENCRYPTION_KEY` from env (32 bytes base64); decrypted only inside the council task; logging filter redacts `sk-…`/`AIza…` patterns as a backstop; keys never in API responses or the browser.
- Uploads: size limit 50 MB, stored by sha256 outside any web root, served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; filenames are display-only.
- Fetching (stretch): http(s) only, resolve and block private/loopback/link-local IPs, 5 s timeout, 1 MB max, text-only extraction.
- CORS: only the web origin; credentials allowed.

## Key decisions (and rejected alternatives)
| Decision | Rejected | Why |
|---|---|---|
| FastAPI + Postgres | Node-only backend | Brief prefers Python; council logic is easier in Python. |
| Hocuspocus sidecar | pycrdt-websocket in FastAPI | See Sync design: auth/read-only/persistence are built in; lower integration risk. |
| WS ticket JWT minted by API | Sync service querying the DB for roles | Keeps all authZ logic in one place; sync stays stateless apart from doc_states. |
| HyperFormula, repo licensed GPL-3.0-or-later | Hand-written formula parser; buying a commercial licence | HyperFormula is dual GPLv3/commercial. Shipping it in the browser bundle means distributing it, so the whole repo must be GPLv3-compatible. Writing our own evaluator would cost ~1 h. Configure `licenseKey: 'gpl-v3'`. If the owner later needs a closed licence: buy a commercial licence or replace `lib/formula.ts`. |
| TipTap MIT packages only (`@tiptap/react`, `starter-kit`, `extension-collaboration`, `extension-collaboration-caret`, `extension-link`) | `@tiptap-pro/*`, Tiptap Cloud | The open-source editor is MIT; Pro extensions and Cloud need a paid licence. `make licences` fails on any `@tiptap-pro` package. |
| Client-side import/export | Server-side Yjs→markdown in Python | No ProseMirror schema on the server; client already has the editor. |
| Local volume for blobs, behind a `StorageBackend` interface with an optional NexusCloud backend | MinIO/S3 | One less service by default; the interface now carries the swap. |
| In-process asyncio council task | Celery/RQ + Redis | Two fewer services; runs are rare and short. |
| Workspace-level roles | Per-file ACLs/share links | Scope; link expiry is a non-goal. |
| Cookie JWT, no sessions table | Server sessions | Fewer tables; logout clears cookie (no server revoke — known gap). |
| `@tiptap/pm` and `@tiptap/y-tiptap` added to the web deps | — | Required peer dependencies of the TipTap packages above (both MIT); not optional. |
| Slice 9 finish: real Anthropic, OpenAI (Chat Completions) and Google (`google-genai`) adapters; a provider without a key runs as FakeAdapter ("demo"). One contract suite runs against all three using local HTTP stubs. Google prices were entered at what the build notes call the announced post-increase rates (not verified against billing); the google-genai SDK logger is silenced because it logs provider error bodies on retry | Stack table already lists `openai`, `google-genai` | The SDKs' own retry/backoff is used (1 retry, 110 s per attempt; pipeline deadline 120 s). Prices/model ids unverified against live APIs. |
| Adapter tests use a local stub HTTP server, not respx | respx | `anthropic` ≥ 1.0 is built on httpx2, which respx does not intercept. |
| No server-side model fallback on refusal for Claude calls | `fallbacks: "default"` | A fallback could answer from a differently priced model, which would break the per-run cost cap. A refusal is recorded as a failed step instead. |
