# Coedit: 90-second two-browser demo

Status of this script: written from the seed data, the UI labels in the source and the README. The data
arithmetic below is exact. The whole sequence has **not** been rehearsed by a person in two real browsers
(see README "Verification status"). Treat the first run as the rehearsal and fix any step that differs.

## 0. Repeatable setup (do once, ~2 min, before the audience arrives)

```bash
cp .env.example .env     # fill APP_SECRET, WS_TICKET_SECRET, KEY_ENCRYPTION_KEY (README "Setup")
# Council without any key (all seats are demo seats, no network, no cost): add this line to .env
#   COUNCIL_FAKE=1
docker compose up -d --build
make seed SEED_PASSWORD='demo-password-1'    # idempotent: running it again changes nothing
```

`make seed` creates `owner@example.com`, `editor@example.com`, `viewer@example.com` (all with that password),
workspace **Demo** with doc **Welcome**, sheet **Budget** and folder **Handoff**. Check it any time with
`docker compose exec -e SEED_PASSWORD='demo-password-1' -e API_ORIGIN=http://api:8000 -e SYNC_URL=ws://localhost:1234 sync node --import tsx scripts/seed.ts --verify` (prints PASS/FAIL).

**Live seat (optional).** Remove `COUNCIL_FAKE=1` from `.env`, run `docker compose up -d api`, and as owner
open **AI Council** and save one provider key. That provider then runs live, and the other two providers
join as labelled demo seats. No provider has been run against its real API yet, so treat a live seat as
the first real test and use a small cap (for example 20k tokens, $0.25). Skip it if you have no key.

**Reset between runs.** Seeded data comes back by re-running `make seed`. Files you create during the demo
stay; delete them in the tree or ignore them. Never use `docker compose down -v` to reset: it deletes the
volume with real accounts.

**Browsers.** A = `http://localhost:5173`, B = `http://127.0.0.1:5173` (separate cookie jars, so one machine
can be two users), or two real browsers. Sign A in as `owner@example.com`, B as `editor@example.com`.
Both open workspace **Demo**. Tile the windows side by side.

## 1. The 90 seconds

| t | Do (exact clicks) | Expected result |
|---|---|---|
| 0:00 | A and B: click **Welcome** in the file tree. A: click at the end of the first paragraph and type `Hello from Olivia`. B: click on the next line and type `Hello from the editor`. | Each browser shows the other's text within about a second, with a **named, coloured caret** for the other user. |
| 0:20 | A: select some text, click **Bold** in the toolbar. | Bold appears in B too. |
| 0:25 | A and B: click **Budget** in the tree. A: click cell **B2** (Laptops qty, `3`), type `4`, Enter. | In both browsers D2 = 4800, D5 = 6795, D6 = 2265. Before the edit they were 3600, 5595, 1865. |
| 0:40 | B: click cell **C3** (Monitors price `250`), type `300`, Enter. | In A: D3 = 1800, D5 = 7095, D6 = 2465 (it is the same sheet, so these stack on the previous edit). A's view also shows B's selected cell marker. |
| 0:50 | B: click **Export .csv**. | A `.csv` download with computed values (the totals, not the formulas). |
| 0:55 | Sign **B** out and sign in as `viewer@example.com`. Open **Budget** and **Welcome**. | No toolbar and no create/upload buttons. Typing or clicking into cells changes nothing. |
| 1:05 | A: in the sheet, change B2 back to `3`. | The viewer's B window updates live (D2 = 3600) although the viewer cannot edit. |
| 1:10 | A: in the tree click **+**, then **Upload a file**, choose any small file. Open it, click **Upload new version**, choose a different file. | The versions table lists v2 and v1 with download links. Download v1: its bytes are the first file. |
| 1:25 | A: open **AI Council** (page title "Ask the Council"). Brief: `A handoff pack for a small invoice tool`. Folder: **Handoff**. Leave the caps. Click **Run the Council**. | The run walks through drafting, critiquing, synthesizing; steps show provider, tokens and spend (demo seats are labelled "demo" and cost 0). On `done`, **AGENTS.md** and the other files appear in **Handoff**. |
| 1:30 | Open **AGENTS.md** in the tree. | Shown as plain text with a download link. Demo seats produce canned text; a live seat produces a real model's text (unverified). |

The council run takes longer than 5 seconds. For a strict 90 seconds, start the run first (t = 0:00), let it
run while you do the rest, and open the result last.

## 2. What to say, and what not to say

- Say: live co-editing with carets, formulas recalculating in every browser, the viewer role enforced on the
  server, versioned uploads, a budget-capped multi-seat run that writes files.
- Do not say: that any real provider's output was evaluated, that the council gives better answers than a
  single model, or that the canvas and admin pages are real (they are labelled **Preview** and use sample data).

## 3. If something is off

| Symptom | Likely cause |
|---|---|
| Council run answers 409 | No `COUNCIL_FAKE=1` and no saved key. Set one, `docker compose up -d api`. |
| No carets, edits not syncing | Sync WebSocket on port 1234 not reachable from the browser; check `docker compose ps` and that `:1234` is open. |
| `127.0.0.1` browser shows the other user | Cookie jars are per hostname; sign out in that window first. |
