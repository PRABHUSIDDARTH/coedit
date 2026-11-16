# Hardening branch — handoff

Branch `hardening` (10 commits on top of `main` e337935). Nothing pushed. The stack from this branch
(db, api, sync, web) was started with `docker compose up -d` to check healthchecks; it is still running.

## Verified by automated tests
- **Rate limiting** (item 3): `backend/tests/test_ratelimit.py`, 8 tests (window maths, 429 + Retry-After, case-insensitive email,
  check happens before the password check, per-IP across emails, register separate from login, X-Forwarded-For ignored unless trusted).
  Also run live through the :5173 proxy: 8×401 then 429 with `Retry-After: 900`.
- **Session lifetime** (5b): `test_auth.py::test_session_lifetime_is_configurable_default_24h` (JWT exp and cookie Max-Age).
- **Sync limits** (6): `sync/test/sync.test.ts` — connection cap per document (and slot freed on close), a 200 KiB frame against a
  64 KiB cap closes with 1009, env parsing.
- **Role re-check** (5a): same file — DB role beats the ticket's role, non-member with a valid ticket is refused, demoted editor / removed
  member stop being able to edit while connected (mutation-checked: fails with re-validation off).
- **Hocuspocus versions** (1): `sync/scripts/compat-check.ts` (not part of `make test`; run manually): 4.x↔4.x, 4.x↔3.x, 4.x viewer
  read-only, 4.x bad ticket. All pass.
- **Security headers** (4): `frontend/src/lib/security-headers.test.ts` (5 tests).
- Gate: `make secrets-check` OK, `make lint` exit 0, `make test` exit 0 (backend 308, sync 18, frontend 58). Run with a `pnpm` shim
  (`npx pnpm@12.21.0`) because pnpm is not installed on this host.

## Verified only by reading or by curl/docker (no browser, no test)
- Headers on the production build, via `curl -D -` against `.next/standalone` on :3999: CSP, X-Frame-Options, nosniff, Referrer-Policy and
  Permissions-Policy present on `/login` and `/app`, absent on `/api/*`. The page HTML contains inline `<script>` tags (hence `'unsafe-inline'`).
- Compose: ports published on 127.0.0.1 (db, api, sync) via `ss -ltn` and `docker compose config`; an empty `POSTGRES_PASSWORD` makes compose
  refuse to start; four services reach `healthy`; sync and web run as user `node`.
- `make env` generator: run in a scratch directory only (mode 600, 32-byte base64 key, hex DB password, refuses to overwrite).
  **Not run in this repo**: your existing `.env` was left untouched on purpose (the Postgres volume holds its password).
- Excalidraw fonts: read from `node_modules` that it fetches fonts from esm.sh by default; the CSP allows `https://esm.sh` in `font-src`. Not checked live.
- Not implemented: API → sync push disconnect on role change (the 30 s re-check covers it with a delay); total document size cap (Hocuspocus has
  no option); non-root api container (its `blobs` volume is root-owned on existing installs; `docker compose run --rm --user root api chown -R <uid> /data/blobs` first);
  server-side logout/revocation list. Dev-server CSP (the `'unsafe-eval'` branch) was unit-tested but the dev server was not started.
- `npm audit` (sync): 0 vulnerabilities. `pnpm audit` (frontend): 13 (2 low, 4 moderate, 7 high); 11 are in production deps (nanoid ×8, lodash-es ×2, katex ×1,
  per the advisory list). Not upgraded. Backend not audited (no pip-audit available offline).

## Check in a browser (http://localhost:5173, then http://127.0.0.1:5173 as a second user)
Open DevTools → Console on each page and look for `Refused to ...` (CSP) messages. Rebuild first if you changed anything: `docker compose up -d --build web`.
1. `/signup`, `/login`, sign out/in: pages render, styles intact (inline styles), no CSP errors.
2. `/app` → open a **doc**: type, bold, a second user (127.0.0.1 profile) sees the caret live. The status bar must say connected (WebSocket to `:1234` allowed by `connect-src`).
3. Open a **sheet**: edit `A1`, formulas evaluate (HyperFormula), second user sees it.
4. Open the **canvas preview** (Excalidraw): it draws; note whether hand-drawn fonts load (esm.sh) or fall back; any `Refused to load` for fonts/workers/images.
5. Council panel and Members panel load; file upload and a download still work.
6. **Frame test**: save `<iframe src="http://localhost:5173/login">` in a local .html file and open it: the frame must be blocked.
7. **Role change**: owner opens Members, demotes the second user (editor → viewer) while that user has a doc open. Within ~30 s the second user's editor
   reconnects read-only (toolbar gone / typing does nothing). Then remove them: they lose access to the workspace.
8. **Rate limit**: at `/login` submit a wrong password 9 times for one email → the 9th shows the error without crashing; `curl -i` shows 429 + `Retry-After`.
   The bucket (shared IP of the web container) clears after 15 minutes or `docker compose restart api`.
9. DevTools → Application → Cookies → `coedit_session`: lifetime about 24 hours.
10. `docker compose ps`: db, api, sync, web all `healthy`.

## Push and open a PR
```bash
cd /home/psTech/psTech/coedit
git status --short                      # expect only docs/doclm/SCORING.md and scripts/doclm/data/heldout.draft.jsonl (your uncommitted docLM edits, untouched)
git log --oneline main..hardening       # review the 10 commits
git push -u origin hardening
gh pr create --base main --head hardening --title "Hardening: network exposure, rate limits, headers, role re-check, limits" \
  --body-file docs/HARDENING_HANDOFF.md
```
(`origin` is https://github.com/PRABHUSIDDARTH/coedit.git.)
