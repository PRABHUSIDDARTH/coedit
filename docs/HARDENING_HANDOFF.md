# Hardening plus docLM scaffolding and parse_files fix

Branch `hardening`. Not pushed. **Do not merge until the manual checklist in `docs/BROWSER_CHECK.md` has been run in a real browser** (see "Unverified").

## What this PR includes
1. **Hardening commits** (this branch's own work):
   - db/api/sync published on 127.0.0.1 only; no default DB password (compose refuses an empty one); `make env` generates secrets (mode 600, never printed, refuses to overwrite).
   - Login/register rate limit (per IP and per email, in memory, 429 + `Retry-After`); `X-Forwarded-For` believed only from peers in `RATE_LIMIT_TRUSTED_PROXIES`
     (compose default: Docker bridge ranges = the bundled web proxy); session lifetime `SESSION_TTL_HOURS`, default 24.
   - Sync: membership looked up in Postgres on connect and every 30 s (removed/demoted members disconnected); per-message cap (8 MiB) and per-document connection cap (50).
   - Web: CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy; `CSP_MODE` = `enforce` (default) | `report-only` | `off`; HSTS opt-in (`ENABLE_HSTS=1`).
   - Ops: healthchecks; sync and web containers non-root; shadcn CLI to devDependencies; optional `docker-compose.lan.yml` for a two-device demo (README, with warning).
   - Docs: README Known limitations, ARCHITECTURE security notes, `docs/BROWSER_CHECK.md`; `scripts/doclm/.ruff_cache` untracked.
2. **Council `parse_files` change with tests** (inherited, commit 9f7bfa8): `backend/app/council/prompts.py` strips one outer code fence and a stray closing fence in the
   last file; `backend/tests/test_parse_files.py` (10 tests). Not hardening.
3. **docLM scripts and docs** (inherited, 22 commits, offline scaffolding; no training, no real API calls): `scripts/doclm/**`, `docs/doclm/**`, including the
   **draft** held-out file `scripts/doclm/data/heldout.draft.jsonl` (50 tasks, Claude-written, unreviewed). **No frozen set**: no frozen/v1 held-out file or hash file is tracked,
   and `freeze_heldout.py` has not been run on the real set. Uncommitted local edits to the draft and to `docs/doclm/SCORING.md` are not part of the branch.

Checked: no `.env` (only `.env.example` files), keys, `node_modules`, `.venv` or cache files tracked; `make secrets-check` OK.
The branch is built from local `main` (e337935), which is 22 commits ahead of `origin/main`; items 2 and 3 are those commits.

## Findings worth knowing
- Hocuspocus server 3.4.4 vs browser provider 4.8.0: majors differ, but `sync/scripts/compat-check.ts` syncs 4.x↔4.x and 4.x↔3.x; versions left as they are.
- The bundled Next proxy forwards the client IP but **does not sanitise it** (measured): it sets `X-Forwarded-For` only when the client sent none and passes a client-supplied
  value through unchanged. With `:5173` exposed directly a client can choose its per-IP bucket; the per-email limit still holds. A reverse proxy that overwrites the header fixes that.
- The frontend sync URL is the page's hostname plus `:1234`, so the LAN demo needs no env change; the CSP allows `ws://*:1234`.
- Frontend audit: 13 advisories (7 high); 11 (all the high ones) come through `@excalidraw/excalidraw`, 2 are dev tooling. Not upgraded. Python backend not audited.
- Known limits stated in the README: 8 MiB is per message, not per document; role changes lag up to about 30 s; the api container runs as root; logout does not revoke tokens.

## Verification status
**By automated tests**: see the gate counts in `PROGRESS.md` (`make secrets-check`, `make lint`, `make test`). Covered: rate limiter incl. spoofed header from an untrusted
peer; session lifetime; sync caps; DB role beating the ticket role and demotion/removal while connected (mutation-checked); CSP header builder incl. all three `CSP_MODE`s;
sync URL for a LAN hostname. `sync/scripts/compat-check.ts` (manual) passes.

**By curl/docker/reading only**: response headers on the production build; port bindings; healthchecks and non-root users in the running stack; the proxy's
`X-Forwarded-For` behaviour (local echo server); `docker-compose.lan.yml` merged ports.

**Unverified**:
- **The CSP in a real browser**: that the editor, sheet, Excalidraw (including fonts from esm.sh), uploads/downloads and the sync WebSocket all work under it.
  The Chrome extension could not reach the app (`ERR_CONNECTION_REFUSED`; the browser is likely on another machine). If something breaks, set `CSP_MODE=report-only`
  and open the browser console.
- **The LAN demo between two real devices.**
- **Per-user IP buckets behind the proxy** after the trusted-proxy change (unit-tested, not exercised live).
- Not built: API-to-sync push on role change, non-root api container, backend dependency audit.

**Manual checklist: `docs/BROWSER_CHECK.md` (14 checks). Merging should wait for it.**

## Push and open the PR
```bash
cd /home/psTech/psTech/coedit
git status --short                 # expect only docs/doclm/SCORING.md and scripts/doclm/data/heldout.draft.jsonl (your uncommitted docLM edits)
git log --oneline origin/main..hardening
git push -u origin hardening
gh pr create --base main --head hardening --title "Hardening plus docLM scaffolding and parse_files fix" --body-file docs/HARDENING_HANDOFF.md
```
(`origin` is https://github.com/PRABHUSIDDARTH/coedit.git.)
