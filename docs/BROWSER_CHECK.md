# Browser check (manual)

Why this is a checklist and not a result: the Claude in Chrome extension answered `ERR_CONNECTION_REFUSED` for
`http://localhost:5173` and `http://127.0.0.1:5173` while the stack was healthy on the build host
(`curl` returned 200), and loading the LAN address did not complete either. The browser is most likely on a
different machine than the stack. Nothing below has been run in a browser.

## Setup
```bash
docker compose up -d --build            # or add -f docker-compose.lan.yml for the two-device parts
docker compose ps                       # db, api, sync, web: healthy
```
Open DevTools (F12) before loading each page: **Console** (look for `Refused to ...`, `Content Security Policy`)
and **Network** (look for red/blocked requests). Use a private window for user B, or `127.0.0.1` vs `localhost`
(separate cookie jars). Use throwaway test accounts (e.g. `a@example.com`, `b@example.com`).

## Checks (mark PASS/FAIL, paste any console error)
| # | URL / action | Expect |
|---|---|---|
| 1 | `/signup` → register user A | lands in `/app`; no console errors; styles intact |
| 2 | Sign out, `/login` → sign in as A | works; cookie `coedit_session` Max-Age about 86400 (Application → Cookies) |
| 3 | Create a workspace, add user B (register B first, in the other window) as editor | B appears in Members |
| 4 | New **doc**, type text, bold a word | status bar "connected"; Network shows WebSocket to `ws://<host>:1234` with status 101; no CSP errors |
| 5 | As B open the same doc in the second window | B sees A's text live; A sees B's caret; edits flow both ways |
| 6 | New **sheet**: `A1=2`, `A2=3`, `A3=SUM(A1:A2)` | A3 shows 5; B sees it |
| 7 | **Canvas** (`/app` → canvas preview) | Excalidraw draws; check Network for `esm.sh` font requests: allowed by `font-src`. If the hand-drawn font falls back and the console says `Refused to load the font`, widen `font-src` only as far as the blocked URL needs |
| 8 | Upload a small file (tree → upload), then download it | file listed with a version; download saves; no CSP errors |
| 9 | Doc → Export .md; sheet → Export .csv | files download with the content |
| 10 | **Council** page (`/app/council`) | page renders; models list loads; no console errors (do not run with real keys) |
| 11 | Frame test: a local `.html` containing `<iframe src="http://localhost:5173/login">` | frame is blocked (`frame-ancestors 'none'`) |
| 12 | Role change: as A demote B to viewer while B has the doc open | within about 30 s B's editor reconnects read-only; typing does nothing |
| 13 | LAN (`-f docker-compose.lan.yml`): open `http://<LAN IP>:5173` on both devices | WebSocket goes to `ws://<LAN IP>:1234` (101); CSP allows it; edits sync |
| 14 | 9 wrong passwords for one email at `/login` | 9th attempt answers 429; response header `Retry-After` present |

## If a CSP violation shows up
Fix it with the smallest change in `frontend/src/lib/security-headers.ts` (add only the blocked origin to the
one directive named in the message), update `security-headers.test.ts`, rebuild web
(`docker compose up -d --build web`), and re-check the page.
