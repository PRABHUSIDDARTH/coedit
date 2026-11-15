# PRD — coedit (6-hour demo slice)

> Status: the acceptance criteria below are the targets, not a record of results. What was actually verified, and how, is in README.md ("Verification status") and PROGRESS.md. In particular no council provider has run against a real API and canvas/admin are sample-data previews.

## Problem
A small team wants one place to co-edit docs and sheets live, keep other files like a drive, and optionally ask several AI models to research, draft, cross-critique and produce a Handoff Pack for a coding harness, using the team's own API keys.

## Users
- **Owner**: creates the workspace, invites members, stores provider keys, runs the council.
- **Editor**: creates and edits files and folders.
- **Viewer**: reads and downloads only; enforced on the server.

## Acceptance criteria (priority order; cut from the bottom)
1. **Auth & drive structure**
   - Register/login with email + password; session is an httpOnly cookie; logout works.
   - Create a workspace; add a member by email with role owner/editor/viewer.
   - Create, rename, nest, delete folders; create Doc, Sheet, or upload file inside them.
   - Every API call and WS join is authenticated and role-checked; viewers get 403 on any write.
2. **Docs**
   - Rich text (headings, bold/italic, lists, code, links) via TipTap.
   - Two browsers editing the same doc see each other's edits within ~1 s, with named, coloured carets.
   - Content survives a full `docker compose restart`.
   - A viewer can open the doc and see live updates, but their edits are rejected by the server.
3. **Sheets**
   - Grid of at least 26 columns × 100 rows; cells store raw input.
   - Live multi-user editing; formulas `=SUM`, `=AVERAGE`, `+ - * /` and cell refs evaluate and update when inputs change.
   - No formatting.
4. **Files**
   - Upload any file (≤ 50 MB); re-uploading to the same file creates version n+1; list versions; download any version.
   - Import `.md` → new Doc, `.csv` → new Sheet.
   - Export Doc → `.md`, Sheet → `.csv` (computed values).
5. **AI council (thin mode)**
   - Settings page stores Anthropic/OpenAI/Google keys; encrypted at rest; only last 4 chars ever shown; never sent to the browser or logged.
   - Owner enters a brief, picks an output folder and a token/cost cap, and starts a run.
   - 3 providers draft in parallel → each critiques the other two (one round) → one model synthesizes.
   - Output saved as `AGENTS.md`, `ARCHITECTURE.md` and (optional) `PRD.md` files in the chosen folder.
   - Run stops with status `capped` if the cap would be exceeded; progress and spend are visible.
   - Fake adapter makes the full pipeline testable without keys or network.
6. **Local run**: `docker compose up --build` from a clean clone (plus `.env`) runs the whole demo.

## Non-goals
Slides, whiteboard, Google sign-in, link expiry, PDF export, docx/xlsx import, per-file sharing, comments, offline mode, Cloud Run deploy (stretch only).

## Demo script (what “working” means)
Two browsers, two users → shared workspace → co-edit a doc and a sheet with formulas → upload a file twice and download v1 → export the sheet as CSV → viewer tries to type and is blocked → run the council with keys (or fake mode) → open the generated AGENTS.md.
