# Coedit web (mock-first)

The Coedit interface: marketing site, sign-in, workspace shell, docs, sheets, canvas, the AI Council
and an admin console. There is no backend yet, so everything runs on mock data behind three small
interfaces. The real services can replace the mocks without touching any UI code.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # production build
pnpm lint         # eslint (React Compiler rules on)
```

`pnpm dev` and `pnpm build` use webpack (`next dev --webpack`). The scaffold's default Turbopack could
not resolve packages on an NTFS checkout. If your checkout is on a normal filesystem you can drop the
flag and swap `@tailwindcss/postcss` for the Turbopack loader, but nothing requires it.

`NEXT_PUBLIC_USE_MOCKS=true` (the default when unset) selects the mock implementations. See
`.env.example`.

## Routes

| Route | What it is |
|---|---|
| `/` | Marketing site: hero, product tour, pricing |
| `/login`, `/signup` | Sign-in and sign-up (UI only; any valid-looking details continue) |
| `/app` | Workspace home: recent files and quick actions |
| `/app/doc/[id]` | Doc editor (TipTap): slash menu, tables, code, comments, live carets, Ask Council |
| `/app/sheet/[id]` | Sheet editor: typed columns, HyperFormula formulas, formula bar, collaborator selections |
| `/app/canvas/[id]` | Canvas (Excalidraw): single-user, persisted |
| `/app/council` | AI Council: choose 3 to 6 seats, watch the discussion stream, insert the answer into a doc |
| `/app/settings` | Profile, workspace, appearance, members |
| `/admin`, `/admin/routing`, `/admin/audit`, `/admin/keys` | Admin console: health, usage, model routing, audit log, API keys |

⌘K (Ctrl+K) opens the command palette anywhere under `/app`.

## How the mocks are wired

Everything the UI needs comes through three interfaces. **Components never import from `src/mocks`.**
The only module that does is `src/lib/data/index.ts`, which picks an implementation.

| Interface | File | Mock | Used by |
|---|---|---|---|
| `CollabProvider` | `src/lib/collab/types.ts` | `src/mocks/MockCollabProvider.ts` | `useCollab(docId, kind)` in every editor |
| `CouncilClient` | `src/lib/council/types.ts` | `src/mocks/MockCouncilClient.ts` | `useCouncil()` on `/app/council` |
| `Repo` | `src/lib/data/types.ts` | `src/mocks/MockRepo.ts` | `useRepo(key, repo => ...)` for lists, docs, sheets, admin data |

### Swapping in the real thing

1. **Realtime.** Implement `CollabProvider` over Yjs and a WebSocket (`connect(docId, kind)`,
   `onPresence`, `onUpdate`, `onState`, `sendUpdate`, `disconnect`, `peers`). Return it from
   `createCollabProvider()` in `src/lib/data/index.ts` when `USE_MOCKS` is false. Presence positions are
   in the coordinates of each editor (ProseMirror position for docs, row and column for sheets; canvases are
   single-user and have no presence), so a Yjs awareness adapter maps straight onto them. The editors currently apply
   remote edits through `onUpdate` payloads; with Yjs you would bind TipTap's Collaboration extension
   and a `Y.Map` for cells instead, and keep `onPresence` for carets and selections.
2. **Council.** Implement `CouncilClient.runCouncil({ prompt, seats, signal })` as an async stream of
   events (`seat-start`, `delta`, `seat-done`, `synthesis-start`, `synthesis-delta`, `done`) from your
   LLM gateway, and `listSeats()`. Honour `signal` for the Stop button.
3. **Data.** Implement `Repo` over your API. Types are in `src/lib/data/types.ts`.
4. Set `NEXT_PUBLIC_USE_MOCKS=false`. The `getRepo`, `getCouncilClient` and `createCollabProvider`
   factories currently throw when mocks are off, so a missing implementation fails loudly.

To see error states, run `localStorage.setItem("coedit.mock.fail", "1")` in the browser console and
reload; every `Repo` call then fails. Remove the key to recover.

## Design system

Tokens come from the brand kit and are used unchanged: `src/app/coedit-theme.css` is a verbatim copy of
`coedit-theme.css`, and `src/app/globals.css` maps it onto shadcn/Tailwind v4.

- Structure is neutral (`bg-background`, `bg-panel`, `bg-raised`, `border-border`, `text-ink`,
  `text-ink-2`, `text-ink-3`). Colour carries meaning only.
- Brand is Azure; Orange is the warm pop. Status uses `success`, `warning`, `danger`, `info`.
- Collaborators and Council seats take `--seat-1` to `--seat-6` in order (`src/lib/seats.ts`). Text on a
  seat colour uses `--on-fill`.
- The one gradient is `--tidal`: the primary CTA, the Council "thinking" glow and the hero. Nowhere else.
- Light and dark are set by `next-themes` on `<html>` as both `class="dark"` and `data-theme`. The theme
  switch in `src/components/theme-toggle.tsx` flips between them in one click.
- No raw hex in components. The only places hex appears are the theme file itself, the `<meta
  name="theme-color">` constant in `src/lib/theme-colors.ts` (browser chrome cannot read CSS variables)
  and the vendored React Bits sources in `src/components/reactbits/`. Libraries that need real colours
  (Excalidraw, the dot-grid canvas) get them from `useTokens`, which reads the CSS variables at runtime.

Check it yourself:

```bash
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(' src --include=*.ts --include=*.tsx --include=*.css \
  | grep -vE 'reactbits/|theme-colors.ts|coedit-theme.css'
```

## Notes on dependencies

- **TipTap**: MIT extensions only. Comments are a small custom mark; there is no Pro dependency.
- **Excalidraw** (MIT) was chosen over tldraw, which needs a licence key for production use.
- **HyperFormula** is GPL-3.0; this repository is GPL-3.0-or-later.
- **React Bits** components are copied into `src/components/reactbits/` by the shadcn registry
  (`@react-bits`, configured in `components.json`). `BlurText` was rewired from `motion/react` to
  `framer-motion` to avoid shipping two animation libraries.
- **Fonts**: Inter (UI), JetBrains Mono (code and cells) and Sora, the logo's typeface, for large
  marketing headings only.

## Not built

Real authentication, persistence, file creation (the "New" buttons open a sample), sheet range
selection and copy and paste, Council history, and real-time conflict handling. These belong to the
backend work that replaces the mocks.
