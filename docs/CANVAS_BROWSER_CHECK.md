# Canvas: browser check and handoff

Branch `canvas`. **Nothing in this file has been run in a browser** (no browser could reach the app from the build host; see `docs/BROWSER_CHECK.md`).
Backend behaviour is covered by tests; the editor behaviour below is only checked by reading, typechecking and unit tests of its pure parts.

## What is built
Persisted, **single-user** canvases (no realtime, no images, no history). Details: README "Known limitations" and `docs/ARCHITECTURE.md` "Canvas".

## Setup
```bash
cd /home/psTech/psTech/coedit
git checkout canvas
docker compose up -d --build api web      # api applies migration 0009 on start (adds the `canvas` kind and `canvas_scenes`; additive)
docker compose ps                         # api, web healthy
```
Open http://localhost:5173 (and, for a second user, http://127.0.0.1:5173 in another profile or a private window: a separate cookie jar). Open DevTools
(F12): **Console** for `Refused to ...` / `Content Security Policy` messages and **Network** for failed (red) requests. Use throwaway accounts.

## Checks (mark PASS/FAIL, paste any console error)
| # | Steps | Expect |
|---|---|---|
| 1 | Sign in as an owner. Sidebar "+" (or a folder's menu) → **New canvas** → name it | Lands on `/app/canvas/<id>`. No "Preview" note. The status bar says "Changes save automatically". The sidebar has **no** "Canvas Preview" link; the new file shows with the pen icon in the tree |
| 2 | Draw a rectangle, an arrow, some text and a freehand line. Wait 2 to 3 seconds | Status shows "Saving…" then "Saved". Network: one `PUT /api/files/<id>/scene` → 200 |
| 3 | Reload the page | Everything you drew is back |
| 4 | Change the background colour and turn the grid on. Wait for "Saved", reload | Background and grid are restored |
| 5 | Look at the toolbar | **No image tool.** (Shortcut `9` does nothing) |
| 6 | Copy an image to the clipboard and paste it into the canvas (or drag an image file in) | The status turns to "Not saved: Images and embeds aren't supported in canvases yet. Remove them to save." with a Retry button. Delete the image, click Retry → "Saved" |
| 7 | Select a shape, press Ctrl+K, set the link to `javascript:alert(1)`; wait for "Saved"; reload | The link is gone, and the bar said "1 unsafe link was removed". Then set `https://example.com`: it survives a reload |
| 8 | Click **PNG** and **SVG** in the status bar | Both download and open. The background is included. Text uses the hand-drawn font, not a fallback (open Network: font requests to `esm.sh` should be 200 and Console should show no CSP "Refused to load the font") |
| 9 | Console filter `Content Security Policy\|Refused\|violates` on the canvas page | No violations. If there is one, note the directive and blocked URL (likely `font-src`/`connect-src`/`worker-src`); do not widen the CSP without checking `docs/BROWSER_CHECK.md` |
| 10 | **Conflict:** open the same canvas in two tabs (A and B). Edit in A, wait for "Saved". Then edit in B | B shows "Someone else saved this canvas after you opened it." with **Load their version** and **Overwrite with mine**. Autosave in B stops. "Load their version" shows A's drawing; repeat and "Overwrite with mine" → "Saved" and A's tab (after reload) shows B's drawing |
| 11 | **Viewer:** as the owner add a second user as **viewer**. Open the canvas as that user | "View only". Drawing tools are unavailable (pan and zoom work). Nothing saves. In that user's console run the snippet below: **403** |
| 12 | **Demotion while open:** as the owner change an editor with the canvas open to viewer | Within about 30 seconds that user's canvas switches to view-only; if they made an edit first, the bar shows "You no longer have edit access to this canvas." |
| 13 | **Removal while open:** remove a member who has the canvas open | Within about 30 seconds or at their next save the page shows "This file isn't available" / the bar shows "deleted, or you were removed" |
| 14 | **Delete:** delete the canvas from the tree, then open its old URL | "This file isn't available" |
| 15 | **Size cap:** in the console run the second snippet below | **413** |
| 16 | Open `/admin` | Still labelled **Preview** (the Admin console was not changed) |
| 17 | Open a doc and a sheet | They still work (the sidebar, file tree and file page were touched) |

Console snippets (replace `<id>` with the canvas id from the URL):
```js
// check 11: viewer write must be 403
fetch('/api/files/<id>/scene', {method:'PUT', headers:{'X-Requested-With':'coedit','Content-Type':'application/json'},
  body: JSON.stringify({base_revision: 1, scene: {elements: []}})}).then(r => r.status)
// check 15: over the 5 MiB cap must be 413 (as an editor or owner)
fetch('/api/files/<id>/scene', {method:'PUT', headers:{'X-Requested-With':'coedit','Content-Type':'application/json'},
  body: JSON.stringify({base_revision: 0, pad: 'x'.repeat(6*1024*1024)})}).then(r => r.status)
```

## Verification status
**By automated tests (backend, `backend/tests/test_canvas.py`):** create/open/save/read/rename/delete; stale revision 409; permission matrix (viewer 403, non-member 404, anonymous 401,
removed member 404, demoted editor 403 on write and 200 on read); non-canvas file 409; no realtime ticket for canvases; invalid JSON, wrong shapes, bad colour/grid 422 without echoing input;
image/embeddable/iframe/magicframe/selection rejected; size cap 413 by `Content-Length` and by streaming; `appState` reduced to background and grid; deleted elements dropped; link sanitising
(javascript, mixed case, tab/newline tricks, data, vbscript, file, ftp, blob, scheme-relative, empty host, over-length) and counted; permission table row; migration 0009 up/down/up on a scratch database.
**By automated tests (frontend, `lib/canvas.test.ts`, `lib/autosave.test.ts`):** link sanitiser, scene builder (tombstones, links, appState), unsupported-type detection, load-time sanitising,
change signature, view-only mode rule, safe export file names; autosave debounce, failure + retry, change during a save, conflict handling, flush/dispose.
**By reading/typecheck/build only:** the Excalidraw component (`canvas-editor.tsx`), FilePage wiring, file-tree changes; `tsc`, `eslint` and `pnpm build` pass.
**Not verified (needs a browser):** everything in the table above, especially: that `viewModeEnabled` really blocks editing, that `tools.image: false` hides the tool, how pasted/dropped images behave,
that restoring a saved scene round-trips, whether the first `onChange` after load can cause one spurious save, PNG/SVG export output, fonts under the CSP, the 30 s role refresh, and the conflict UI.

## Push and open the PR (not done; run when you are satisfied)
```bash
cd /home/psTech/psTech/coedit
git status --short                      # only your docLM edits and the two untracked plan docs should remain
git log --oneline main..canvas
make secrets-check
git push -u origin canvas
gh pr create --base main --head canvas --title "Canvas: persisted single-user canvases (no realtime, no images)" \
  --body "Real canvas file kind with autosave, revisions, size cap, link sanitising, view-only for viewers, PNG/SVG export. Single-user: no realtime, no images, no history. Browser checks are listed in docs/CANVAS_BROWSER_CHECK.md and have NOT been run; please do not merge until they have."
```
