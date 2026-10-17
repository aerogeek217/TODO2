# TODO2

A todo web app with a workspace of widgets (lists, calendars, notes) in columns, saved layouts, and local-first storage.

## Architecture
@docs/ARCHITECTURE.md

## Build & Test Commands
- Node: ≥ 22.13 (`engines` in package.json — the floor jsdom and Vite set on Node 22). The GitHub Pages deploy (`.github/workflows/deploy.yml`) runs on Node 22 / ubuntu-latest (UTC): `npm ci` → `npm test` (a failing vitest run blocks the deploy; Playwright is not run there) → `npm run build`.
- Install: `npm install`
- Dev: `npm run dev` → http://localhost:5180
- Build (both): `npm run build` → runs `npm run lint` first (hard gate — any lint error or warning fails the build, incl. the GitHub Pages deploy), then `dist/index.html` (online, CDN fonts) + `dist/todo2.html` (offline, single file). Verify with this, not `tsc --noEmit`.
- Build online only: `npm run build:online` (also lint-gated)
- Build offline only: `npm run build:offline` (also lint-gated)
- Test: `npm test` (vitest + JSDOM). Two projects: `isolated` (files that call `vi.mock`/`vi.doMock`, detected automatically — fresh worker per file) and `shared` (everything else, `isolate: false`; `src/test/setup-shared.ts` resets db / DOM / storage / timers / stubs / spies at each file boundary). In both, `src/test/setup.ts` resets every store and all registered module state before each test — a module with state outside its store calls `registerModuleReset` (`utils/module-reset`).
- Test affected only: `npx vitest related <changed src files> --run` — use while iterating; run the full `npm test` once before committing
- Test watch: `npm run test:watch`
- E2E: `npm run test:e2e` (Playwright, `fullyParallel`; starts its own dev server on port 5173 — separate from the 5180 dev server). Single spec: `npx playwright test e2e/<name>.spec.ts`
- Lint: `npm run lint` (`eslint . --max-warnings 0`). No per-file ignores — don't add any to dodge fixes.
- Dev seed: `npm run seed:dev` → `dev-data/seed-v49.json` (gitignored; realistic v49 export for manual testing via Settings → Import / Export → Import JSON — runs the full upgrade pipeline; dates relative to today, re-run when stale). Needs Node ≥ 22.6.

## Tech Stack
- React 19 + TypeScript + Vite
- Zustand (state management)
- Dexie.js (IndexedDB, local-first persistence)
- dnd-kit (drag-and-drop)
- React Router v7 (data router: `createHashRouter` + `RouterProvider`)

## Working Principles
- **Verify before acting.** Never assume how code works — read the actual implementation before making changes. Trace the real call chain, check actual types, confirm actual behavior. If you're not sure, read the code; don't guess.
- If a fix touches logic you haven't read, read it first. Wrong assumptions produce slop.
- **No shortcuts dressed as architecture.** When a task feels hard, don't rationalize skipping it as "too brittle" or "architecturally complex" unless you have actually tried it and hit a concrete wall. Spike for ~15 minutes before deferring. If you're skipping for time, say so explicitly ("~N more minutes for the full version") — don't rebrand it as an architectural constraint. Plan-doc hedges ("this is brittle") are prompts to try, not licenses to skip.

## Code Conventions
- Components in `src/components/`, route pages in `src/views/`
- Data layer: repository pattern in `src/data/`, Zustand stores in `src/stores/` — except `services/file-storage-store`, the React adapter over the `fileStorageService` singleton (the service imports stores, so the adapter in `stores/` would make a folder cycle)
- Layers, lowest first: `models` / `utils` → `data` → `stores` → `services` → `hooks` → `components` → `views`. A module imports only from its own layer or lower — services orchestrate stores, never the reverse. `src/test/architecture/folder-cycles.test.ts` fails on any folder cycle
- Models as TypeScript interfaces in `src/models/`
- CSS custom properties for design tokens in `src/styles/tokens.css`
- No class components — functional components with hooks only
- **TypeScript strictness**: `noUncheckedIndexedAccess` is on for production code. Prefer `array.at(idx)` or explicit `?? fallback` over `!`. Index access on tuples / known-shape Records is type-safe; runtime arrays return `T | undefined`.
- **ESLint**: typed parsing on (`parserOptions.project: ['./tsconfig.app.json', './tsconfig.node.json', './tsconfig.test.json', './tsconfig.e2e.json']` — `tsconfig.test.json` covers `src/test/**` and is referenced by `tsc -b`, so the build type-checks the tests; `tsconfig.e2e.json` covers `e2e/**` + `playwright.config.ts` and is lint-only, not referenced by `tsc -b`); `@typescript-eslint/no-explicit-any: 'error'` outside `src/test/**`. Hand-edit casts route through typed helpers (`utils/file-picker.ts`, `restore.ts`'s `LegacyTodoRow`).

## Constraints
- Local-first, offline — all data in IndexedDB, no backend
- Minimal dependencies — prefer built-in browser APIs
- Dark theme as primary (design tokens in tokens.css)

## Tools — Chrome DevTools MCP
- A Chrome DevTools MCP server is wired up — tools appear as `mcp__chrome-devtools__*` (deferred; load schemas via `ToolSearch select:<name>` before first call). It drives a real Chromium instance: page nav, click/fill/drag, `take_snapshot`, `take_screenshot`, `evaluate_script`, `list_console_messages`, `list_network_requests`, performance + lighthouse + memory.
- **Reach for it when JSDOM is not authoritative**: focus handoffs, drag-and-drop hit-testing (workspace tab drags, list widget rows, calendar day drops), popover anchor placement and viewport flips, ResizeObserver-driven layout, async-store-driven re-render timing, and any visual check vs. a design handoff.
- **Workflow**: prototype the interaction in MCP against `npm run dev` (port 5180) to see what actually happens, then codify the regression in vitest (logic) or Playwright (real-browser flows — specs in `e2e/`, fixtures in `e2e/fixtures/` — seeding + trusted-mouse `drag` in `workspace.ts`, stored rows in `db.ts`, geometry in `geometry.ts`). MCP is a diagnosis + spike tool, not the regression layer.
- **Don't use it for**: pure logic / model / store / Dexie work — read the source. Don't substitute MCP for unit tests.

## Git Workflow
- Default branch: `main` — the stable, deployed version (pushes to `main` deploy to GitHub Pages). No PR flow.
- **Active effort: `feature/canvas-replacement`** (canvas replacement + enhancements + bug fixes). All work for it commits here, not to `main`. Baseline tag: `pre-canvas-replacement-2026-10-10`.
- Only urgent hotfixes go to `main`; merge `main` into the feature branch afterwards. The effort lands on `main` via `git merge --no-ff` when done.
- Push the feature branch regularly — `origin` is the only off-machine backup.
- Commit messages: imperative mood, under 72 chars
- One logical change per commit

## Planning
- Active tasks are tracked in `docs/plans/TODO.md` — check it at session start
- Before starting a multi-step feature, create a plan in `docs/plans/features/`
- Update TODO.md when completing tasks
- Run `/closeout` at end of session to verify and update docs
- `docs/plans/`, `docs/reviews/`, and `.claude/` are local-only by design (gitignored) — git holds only the application. Never `git add -f` them.
