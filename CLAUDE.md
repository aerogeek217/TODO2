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

## Code Conventions
- Components in `src/components/`, route pages in `src/views/`
- Data layer: repository pattern in `src/data/`, Zustand stores in `src/stores/`
- Models as TypeScript interfaces in `src/models/`
- CSS custom properties for design tokens in `src/styles/tokens.css`
- No class components — functional components with hooks only

## Constraints
- Local-first, offline — all data in IndexedDB, no backend
- Minimal dependencies — prefer built-in browser APIs
- Dark theme as primary (design tokens in tokens.css)

## Git Workflow
- Branch naming: `feature/description`, `fix/description`, `refactor/description`
- Commit messages: imperative mood, under 72 chars
- One logical change per commit

## Planning
- Active tasks are tracked in `docs/plans/TODO.md` — check it at session start
- Before starting a multi-step feature, create a plan in `docs/plans/features/`
- Update TODO.md when completing tasks
- Run `/closeout` at end of session to verify and update docs
