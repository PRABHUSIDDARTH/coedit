# Coedit

Realtime collaborative docs, spreadsheets and drawings, with an optional bring-your-own-key AI council that turns a rough idea into an engineering handoff pack (`AGENTS.md`, `ARCHITECTURE.md`, `PRD.md`).

**Stack:** Next.js · TipTap · Yjs · Hocuspocus · FastAPI · PostgreSQL · Docker Compose

Built solo as a full-stack project to learn how realtime systems, access control and safe LLM calls fit together.

---

## What you can do

- **Edit together, live.** Documents and spreadsheets sync over a CRDT, so several people can type at once with shared cursors and no conflicts. Spreadsheet formulas recalculate in every open window.
- **Draw.** Excalidraw canvases live next to your docs as files, with PNG and SVG export. Viewers get a read-only canvas.
- **Convene an AI council.** Bring your own API key, pick several model seats, and let them write drafts, critique each other with scored reviews, and synthesise one handoff pack for a project.
- **Share safely.** Workspaces have owner, member and viewer roles that are enforced on the API and re-checked by the sync server while you are connected.

## How it works

```
 Browser (Next.js, TipTap, Excalidraw, Yjs)
     |  REST                         |  WebSocket (Yjs updates)
     v                               v
 FastAPI backend  <--- auth --->  Hocuspocus sync server
     |                                |
     +----------- PostgreSQL 16 ------+
```

| Layer | Tools |
|---|---|
| Frontend | Next.js, TipTap, Excalidraw |
| Realtime | Yjs CRDT, Hocuspocus |
| Spreadsheet engine | HyperFormula |
| Backend | FastAPI, Alembic migrations |
| Data | PostgreSQL 16 |
| Packaging | Docker Compose, healthchecks on all four services |

## Engineering decisions worth a look

- **Two services, one permission model.** The API and the sync server share one source of truth for roles. The sync server re-checks every connection's role every 30 seconds, so demoting someone cuts off writes without waiting for a reconnect.
- **LLM calls with someone else's key.** Keys are typed per run and never stored. Each run has token and cost caps, and provider URLs pass an SSRF guard before any request leaves the server. Local providers such as Ollama are off unless explicitly enabled.
- **Conflict-safe saves.** Canvas saves carry a revision number; a stale save from a second tab gets a conflict response instead of silently overwriting.
- **Hardening by default.** Rate limiting with trusted-proxy handling, security headers and CSP, non-root containers for the sync and web services, a database password with no default, and secret scanning on every pull request.
- **An evaluation harness before any fine-tuning.** `scripts/doclm/` holds a frozen 50-task held-out set (sha256 recorded), a scorer, and a reproducible baseline for a small open model. The goal is to measure a local model on Coedit-style tasks before training anything.

## Run it locally

```bash
make env                         # generates .env with fresh secrets
docker compose up -d --build
docker compose ps                # wait for all four services to be healthy
```

Open **http://localhost:5173**. `make seed` creates demo accounts and a workspace; `make test`, `make lint` and `make secrets-check` run the checks. The full guide and a demo outline are in `PROJECT_STATUS.md` and `docs/DEMO_SCRIPT.md`.

## Website

`website/` is the static product page, deployed separately from the app. It uses two extra dependencies that are not part of the app stack: three.js (bundled into `website/assets/hero.js` for the 3D logo) and esbuild (to build that bundle). See `website/README.md`.

## Honest status

- **Verified in a browser:** Canvas (persists after reload, read-only for viewers, exports open, no console or CSP errors, stale-save conflicts). Docs and sheets were checked by hand in Chrome and with a scripted second user.
- **AI council:** one real end-to-end run on Gemini and Groq. NVIDIA NIM, OpenAI, Anthropic and Ollama adapters exist but have **not** been run live. It has not been compared against a single model.
- **Canvas** is single-user: no realtime co-editing, images or version history.
- **Not deployed:** it runs locally with Docker Compose.
- **docLM:** the evaluation harness and baseline exist; **no model has been trained**. The held-out tasks were drafted and reviewed by AI agents only, with no human review.

Everything that has and hasn't been tested, plus known limitations, is in [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Author

Prabhu Siddarth A V · [GitHub](https://github.com/PRABHUSIDDARTH) · [Portfolio](https://prabhusiddarth.dev)
