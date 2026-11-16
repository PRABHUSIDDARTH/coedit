# Hardening branch — PR description

Branch `hardening`. Not pushed. Built from local `main` (e337935), which is **22 commits ahead of `origin/main`**
(docLM scaffolding and one council fix), so a PR against `origin/main` shows 37 commits: 15 hardening ones and those 22.

## What this changes
- **Network**: db/api/sync published on 127.0.0.1 only; no default DB password (compose refuses an empty one); `make env` generates
  secrets (mode 600, never printed, refuses to overwrite). Optional `docker-compose.lan.yml` publishes sync for a two-device demo (README, with warning).
- **Auth**: login/register rate limit (per IP and per email, in memory, 429 + `Retry-After`); `X-Forwarded-For` is believed only from peers in
  `RATE_LIMIT_TRUSTED_PROXIES` (compose default: Docker bridge ranges = the bundled web proxy); session lifetime `SESSION_TTL_HOURS`, default 24.
- **Sync**: membership looked up in Postgres on connect and every 30 s (removed/demoted members are disconnected); per-message size cap (8 MiB) and
  per-document connection cap (50).
- **Web**: CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (HSTS opt-in `ENABLE_HSTS=1`).
- **Ops**: healthchecks; sync and web containers non-root; shadcn CLI to devDependencies.
- **Docs**: README Known limitations, ARCHITECTURE security notes, `docs/BROWSER_CHECK.md`.

## Findings worth knowing
- Hocuspocus server 3.4.4 vs browser provider 4.8.0: majors differ but `sync/scripts/compat-check.ts` syncs 4.x↔4.x and 4.x↔3.x; versions left as they are.
- **The bundled Next proxy forwards the client IP but does not sanitise it** (measured): it sets `X-Forwarded-For` to the client address when the client sent
  none and passes a client-supplied value through unchanged. So trusting the header from the web container makes honest users get their own bucket,
  but with `:5173` exposed directly a client can choose its bucket; the per-email limit still holds. A reverse proxy that overwrites the header fixes that.
  Without trust, every user would share one bucket (one client could lock everyone out), which is why compose trusts the bundled proxy.
- The frontend sync URL is the page's hostname plus `:1234` (not hardcoded localhost), so the LAN demo needs no env change; the CSP allows `ws://*:1234`.
- Frontend audit: 13 advisories (7 high); 11 (all high ones) come through `@excalidraw/excalidraw`, 2 are dev tooling. Not upgraded.

## Not in this PR but in its diff against origin/main (decide before merging)
- `backend/app/council/prompts.py` + `backend/tests/test_parse_files.py`: council `parse_files` fence handling (commit 9f7bfa8). Not hardening.
- docLM scaffolding under `scripts/doclm/` and `docs/doclm/` (22 commits).
- **Tracked cache files** `scripts/doclm/.ruff_cache/**` (committed in 6c848ca; root `.gitignore` lists `.ruff_cache/` but they were added anyway).
  Suggested follow-up: `git rm -r --cached scripts/doclm/.ruff_cache`. Not done here (docLM files were off limits).
- **Held-out data**: `scripts/doclm/data/heldout.draft.jsonl` (50 draft tasks) is tracked and would be published. No frozen/v1 held-out file or hash file is tracked.
  Your uncommitted edits to it and to `docs/doclm/SCORING.md` are not part of the branch.
- Checked and clean: no `.env` (only `.env.example`, `frontend/.env.example`), keys, `node_modules` or `.venv` tracked; `make secrets-check` OK.

## Verification status
**In a browser: nothing.** The Chrome extension got `ERR_CONNECTION_REFUSED` for localhost/127.0.0.1 (likely a different machine from the stack), and the LAN
address did not load. The manual checklist, with 14 checks, is `docs/BROWSER_CHECK.md`.

**By automated tests** (`make test`: backend 311, sync 18, frontend 59; `make lint` and `make secrets-check` pass):
rate limiter incl. spoofed header from an untrusted peer, trusted peer, garbage header, invalid CIDR (`test_ratelimit.py`); session lifetime; sync size and
connection caps; DB role beats ticket role, demotion/removal while connected (mutation-checked); CSP/header builder; sync URL for a LAN hostname.
`sync/scripts/compat-check.ts` (manual) passes. Frontend `pnpm test` was run twice, 1.3 s each: the earlier hang did not recur (it happened while a Docker build
and the backend suite were also running; cause unknown).

**By curl/docker/reading only**: response headers on the production build (CSP etc. present on pages, absent on `/api`); ports (`ss -ltn`, `compose config`);
healthchecks and non-root users in the running stack; the Next proxy's `X-Forwarded-For` behaviour (local echo server); a 10-request login burst through :5173
(8×401 then 429, `Retry-After: 900`, run before the trusted-proxy change); `docker-compose.lan.yml` merged ports.

**Unverified**: that the CSP lets the editor, sheet, Excalidraw (including fonts from esm.sh) and WebSocket work in a real browser; the LAN demo between two real
devices; that per-user IP buckets actually work end to end behind the proxy after the trusted-proxy change (unit-tested, not exercised live); api container
non-root (not done); API-to-sync push on role change (not built); backend dependency audit (not run).

## Push and open the PR
```bash
cd /home/psTech/psTech/coedit
git status --short                 # expect only docs/doclm/SCORING.md and scripts/doclm/data/heldout.draft.jsonl (your uncommitted docLM edits)
git log --oneline origin/main..hardening
git push -u origin hardening
gh pr create --base main --head hardening --title "Hardening: network exposure, rate limits, headers, role re-check, limits" --body-file docs/HARDENING_HANDOFF.md
```
(`origin` is https://github.com/PRABHUSIDDARTH/coedit.git. To keep the PR to hardening only, first decide on the items under "Not in this PR".)
