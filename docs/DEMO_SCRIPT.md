# Coedit demo script (60 to 90 seconds)

A shot-by-shot script for one screen recording. It covers only what the repo documents as working:
`README.md` ("What works", "Demo script", "Known limitations", "What is cut"),
`docs/BROWSER_CHECK.md` and `docs/CANVAS_BROWSER_CHECK.md`. Anything those files do not support is
on the **Do NOT claim** list at the end. This file contains no keys or passwords: every secret is a
`<PLACEHOLDER>` that you type yourself, off camera or into a masked field.

Total: about 85 s of finished video. The council wait is cut (see shot 5), so the live run is longer.

## Shots

| # | Time | On screen | Say (one line, adapt freely) | Source |
|---|---|---|---|---|
| 1 | 0:00-0:05 (5 s) | Landing page or the **Demo** workspace, both browser windows tiled side by side | "Coedit is a small-team workspace: live docs and sheets, and an AI council that writes a handoff pack." | README intro |
| 2 | 0:05-0:19 (14 s) | Left window: owner. Right window: editor. Both on the **Welcome** doc. Type a sentence in each; the other's text appears with a named, coloured caret. Bold one word | "Two people, two browsers, same doc, live." | README demo step 2 |
| 3 | 0:19-0:31 (12 s) | Both windows on the **Budget** sheet. Change a quantity in one; the totals (`=SUM(...)`) update in both | "Sheets calculate with formulas, and the other browser sees the result." | README demo step 3 |
| 4 | 0:31-0:39 (8 s) | Third window, already signed in as the **viewer**, on **Welcome**. Owner types; text arrives in the viewer window. Viewer has no toolbar and typing does nothing | "A viewer sees the owner's edits arrive, but cannot change anything." | README demo step 6; see "Verification gaps" |
| 5 | 0:39-1:07 (28 s, cut from a longer take) | Owner on **AI Council**. Brief already typed, **Handoff** folder chosen, caps small. Show the Groq seat and the Gemini key, press **Run the Council**. Show the stages and spend, jump-cut the wait, end on status **Done**, then open the generated **AGENTS.md** (plain text) in the Handoff folder, with **ARCHITECTURE.md** and **PRD.md** next to it | "I give it a brief. Three models draft, critique each other, and one writes the final: a handoff pack." | README demo step 7, Architecture ("Council"), "What is cut" |
| 6 | 1:07-1:21 (14 s) | In the file tree: **+** then **New canvas**, name it. Draw a rectangle, an arrow and some text. Wait for the status to read **Saved**. Reload the page; the drawing is still there | "Canvas is a file you create in Files. It saves automatically and survives a reload. It is single-user." | README "Verified: Canvas"; `docs/CANVAS_BROWSER_CHECK.md` checks 1 to 3 |
| 7 | 1:21-1:25 (4 s) | Back to the doc, both carets visible | "Coedit. Demo slice, honest limits in the README." | README intro |

Cut shot 5 to fit, not shots 2 to 4. If the video runs long, shorten shot 5's stage view first, then shot 7.
Say "sped up" on screen or in the voice-over where the council wait is cut. The wait is not measured in the
repo; do not state a run time.

## Verification gaps (read before recording)

The three source files do not record every shot as checked in a browser. Rehearse each once, and cut a shot
that does not behave as described instead of improvising a claim.

| Shot | What the docs say | Gap |
|---|---|---|
| 2, 3 two browsers, doc and sheet | README: docs and sheets were "checked by hand in Chrome"; second-user sync "was checked with a scripted peer". `docs/BROWSER_CHECK.md` checks 4 to 6 (two windows) are listed as not run. | A two-window browser run is not recorded as done. Rehearse. |
| 4 viewer | Viewer read-only is enforced on the server (README Architecture; viewer tickets are read-only) and covered by tests. README "What is cut": the viewer view "was not exercised in a browser". Canvas viewer read-only **was** checked in a browser. | The doc viewer view in a browser is not recorded as checked. Rehearse; if the viewer can type or sees editing controls, cut shot 4. |
| 5 council | README: only **Gemini and Groq** have been run live against real APIs; the Council UI was checked by hand in Chrome. | A single run with a Groq seat plus Gemini reaching **Done** is the owner's confirmation, not a line in the README. Rehearse it; if it does not reach Done, do not present it. |
| 6 canvas | README and `docs/CANVAS_BROWSER_CHECK.md`: created inside Files, persists after reload, viewer read-only, PNG/SVG export, clean console/CSP, stale-save conflict. | Checked. |

## Pre-recording checklist

### 1. Stack healthy
```bash
cd /home/psTech/psTech/coedit
docker compose up -d --build            # api applies migration 0009 (canvas) on start
docker compose ps                       # db, api, sync, web: all healthy
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173    # expect 200
```
- `.env` must **not** set `COUNCIL_FAKE=1` (that gives canned text and would make shot 5 false). `COUNCIL_ALLOW_LOCAL_PROVIDERS` stays unset: Groq is a preset host and needs no local-provider flag.
- Do not use `-f docker-compose.lan.yml`. The LAN setup is not part of this demo.

### 2. Accounts and workspace
Use the seed script instead of creating by hand (it is idempotent and reuses an existing **Demo** workspace):
```bash
make seed SEED_PASSWORD='<SEED_PASSWORD>'      # in a second terminal; choose the password yourself, do not commit it
```
It creates `owner@example.com`, `editor@example.com`, `viewer@example.com` (all with the password you chose) and a
**Demo** workspace owned by the owner, with the **Welcome** doc and the **Budget** sheet (README "Demo script").
If you prefer to create them by hand: register three accounts, create **Demo** as the owner, add the other two as editor and viewer, and create a doc named Welcome and a sheet named Budget.

### 3. Browser profiles (separate cookie jars)
| Window | Profile / URL | Signed in as | Has open |
|---|---|---|---|
| A (left) | Chrome profile 1, `http://localhost:5173` | owner | **Welcome**, **Budget** tabs, then **AI Council** |
| B (right) | Chrome profile 2 (or another browser), `http://127.0.0.1:5173` | editor | **Welcome**, **Budget** tabs |
| C (viewer) | A private window, `http://localhost:5173` | viewer | **Welcome** |

`localhost` and `127.0.0.1` keep separate sessions (README); a private window is a separate jar again.
Sign each in **before** you start recording so no password is typed on camera. Close DevTools, bookmarks bar
and other tabs; turn off notifications; set browser zoom to 110 to 125 percent so text is legible.

### 4. Council setup (placeholders only)
- **Gemini:** in the Council panel's provider keys section, paste `<GEMINI_API_KEY>` and save it (the field is masked; only the last 4 characters are ever shown back). The default Gemini model `gemini-3.8-flash` has a price in `backend/app/council/prices.py`, so the run will start.
- **Groq:** **Add seat**, choose the **Groq** preset, paste `<GROQ_API_KEY>` into the masked field, press **Test & load models**, pick `<GROQ_MODEL_ID>`, and set its price to `<GROQ_PRICE_IN_USD_PER_MTOK>` in and `<GROQ_PRICE_OUT_USD_PER_MTOK>` out (take them from Groq's own pricing page; a seat without a price is refused) plus a small seat token cap `<SEAT_TOKEN_CAP>`.
- The Groq key is **typed per run and held in memory only; it is not stored** (README). Enter it again for each take, before you press record or into the masked field.
- Set small run caps (`<TOKEN_CAP>` tokens, `<COST_CAP_USD>` dollars). The server maximum is 200k tokens / $5 per run.
- Pick an **empty Handoff folder** (or note which one) so the new `AGENTS.md` is unambiguous.
- Write the brief in a text file beforehand and paste it; keep it short and generic (a small app you invent). Do not paste real company or customer text.
- Rehearse the whole council run once and note the real duration. If a take fails with `capped`, raise the caps slightly.

### 5. Before every take
- Empty Handoff folder, a fresh canvas name (delete the old test canvas), the Welcome doc and Budget sheet reset to their seeded text if you changed them.
- Nothing with a key visible: no `.env` open, no terminal history on screen, no password-manager pop-ups, masked fields only.
- If a key was ever pasted somewhere visible, revoke it at the provider and make a new one.

## Do NOT claim

Say none of these, in narration, captions or the video description:

- **Council runs on NVIDIA NIM, OpenAI, Anthropic or Ollama.** They are adapter code tested against local stubs only and were never run against the real services (README "What is cut"). Only **Gemini and Groq** were run live.
- **Realtime Canvas.** Canvas is single-user, saved automatically, with no live co-editing. Also no canvas images, no canvas version history.
- **Consent-before-send.** The README documents no step that asks for consent before a brief or file goes to a provider. Briefs are sent to the models you configured, inside `<untrusted_source>` blocks. Do not say anything about asking permission first.
- **Role-change speed or guarantees.** A removed or demoted member can keep an open editing session for up to about 30 seconds (`REVALIDATE_SECONDS`), and role changes on an open canvas were **not tested**. Do not demonstrate or promise instant revocation.
- **That the council beats a single model.** README: "The council is a hypothesis"; it was not measured. Also no claims about quality, speed or cost of a run.
- **That the model text streams.** The panel shows stages, provider steps, tokens and spend, not the models' text as it streams.
- **That the Groq seat's key is saved.** It is held in memory for the run only. Saved, encrypted keys are for the three built-in providers.
- **The Admin console is real.** It is labelled **Preview** and uses sample data. Do not show it as a feature.
- **Anything outside the README:** cloud deploy, Google sign-in, share links, slides, PDF/docx/xlsx, cancelling a council run, council research from URLs, NexusCloud storage (stub-tested only), end-to-end Playwright tests, server-side logout/session revocation, two-device (LAN) co-editing.
- **Production readiness.** README: "a demo slice, not a finished product".
