# TODO2

A spatial todo web app with infinite canvas, multiple views, and local-first storage.

## Architecture
@docs/ARCHITECTURE.md

## Build & Test Commands
- Install: `npm install`
- Dev: `npm run dev`
- Build (both): `npm run build` → `dist/index.html` (online, CDN fonts) + `dist/todo2.html` (offline, single file)
- Build online only: `npm run build:online`
- Build offline only: `npm run build:offline`
- Test: `npm test`
- Test watch: `npm run test:watch`

## Tech Stack
- React 19 + TypeScript + Vite
- Zustand (state management)
- Dexie.js (IndexedDB, local-first persistence)
- React Flow (spatial canvas, Phase 3)
- dnd-kit (drag-and-drop, Phase 4)

## Working Principles
- **Verify before acting.** Never assume how code works — read the actual implementation before making changes. Trace the real call chain, check actual types, confirm actual behavior. If you're not sure, read the code; don't guess.
- If a fix touches logic you haven't read, read it first. Wrong assumptions produce slop.
- **No shortcuts dressed as architecture.** When a task feels hard, don't rationalize skipping it as "too brittle" or "architecturally complex" unless you have actually tried it and hit a concrete wall. Spike for ~15 minutes before deferring. If you're skipping for time, say so explicitly ("~N more minutes for the full version") — don't rebrand it as an architectural constraint. Plan-doc hedges ("this is brittle") are prompts to try, not licenses to skip.

## Code Conventions
- Components in `src/components/`, route pages in `src/views/`
- Data layer: repository pattern in `src/data/`, Zustand stores in `src/stores/`
- Models as TypeScript interfaces in `src/models/`
- CSS custom properties for design tokens in `src/styles/tokens.css`
- No class components — functional components with hooks only
- **TypeScript strictness**: `noUncheckedIndexedAccess` is on for production code (post-code-review-2026-04-25 P10). Prefer `array.at(idx)` or explicit `?? fallback` over `!`. Index access on tuples / known-shape Records is type-safe; runtime arrays return `T | undefined`.
- **ESLint**: type-aware rules on (`parserOptions.project: './tsconfig.json'`); `@typescript-eslint/no-explicit-any: 'error'` outside `src/test/**`. Hand-edit casts route through typed helpers (`utils/file-picker.ts`, `restore.ts`'s `LegacyTodoRow`).

## Constraints
- Local-first, offline — all data in IndexedDB, no backend
- Minimal dependencies — prefer built-in browser APIs
- Dark theme as primary (design tokens in tokens.css)

## Tools — Chrome DevTools MCP
- A Chrome DevTools MCP server is wired up — tools appear as `mcp__chrome-devtools__*` (deferred; load schemas via `ToolSearch select:<name>` before first call). It drives a real Chromium instance: page nav, click/fill/drag, `take_snapshot`, `take_screenshot`, `evaluate_script`, `list_console_messages`, `list_network_requests`, performance + lighthouse + memory.
- **Reach for it when JSDOM is not authoritative**: focus handoffs, drag-and-drop hit-testing on rails / floats / taskboard, popover anchor placement and viewport flips, ResizeObserver-driven layout, `data-rails-drop-id` / `data-tbp-entry` geometry, async-store-driven re-render timing, and any visual check vs. a design handoff.
- **Workflow**: prototype the interaction in MCP against `npm run dev` (port 5173) to see what actually happens, then codify the regression in vitest (logic) or Playwright (real-browser flows — see `docs/plans/features/real-browser-testing/`). MCP is a diagnosis + spike tool, not the regression layer.
- **Don't use it for**: pure logic / model / store / Dexie work — read the source. Don't substitute MCP for unit tests.

## Git Workflow
- Default branch: `main` — commits land directly on main; no PR flow, no feature branches
- Commit messages: imperative mood, under 72 chars
- One logical change per commit

## Planning
- Active tasks are tracked in `docs/plans/TODO.md` — check it at session start
- Before starting a multi-step feature, create a plan in `docs/plans/features/`
- Update TODO.md when completing tasks
- Run `/closeout` at end of session to verify and update docs
