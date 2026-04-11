# TODO2

A spatial todo app with an infinite canvas, multiple views, and local-first storage. All data stays in your browser — no accounts, no servers.

## Features

- **Canvas view** — arrange projects, sticky notes, and filtered list widgets on an infinite spatial canvas with snap-to-edge alignment
- **List view** — flat task list grouped by priority, due date, people, tag, org, or project with saved views and plain text export
- **Calendar view** — month/week grid with drag-to-reschedule and recurring task support
- **Natural language input** — type `@person`, `#tag`, `/project`, `p1`–`p3`, and date keywords inline when creating tasks
- **Keyboard-driven** — full shortcut set for navigation, editing, bulk actions, and chord-based view switching
- **Command palette** — quick access to actions and navigation
- **Local-first** — all data in IndexedDB, works fully offline
- **File sync** — optional save/load to a JSON file on disk via the File System Access API
- **Dark and light themes** with customizable accent colors
- **Two build targets** — an online build for hosting (CDN fonts) and a single-file offline build you can run from anywhere

## Use it

**Online:** hosted via GitHub Pages (enable in repo Settings > Pages > GitHub Actions)

**Local:** download `todo2.html` from the latest build and open it in your browser — no server needed.

## Development

```
npm install
npm run dev
```

Runs on `http://localhost:5180`.

### Other commands

| Command | Description |
|---------|-------------|
| `npm run build` | Production build — both outputs to `dist/` |
| `npm run build:online` | Online build only (`dist/index.html` + assets, CDN fonts) |
| `npm run build:offline` | Offline build only (`dist/todo2.html`, single self-contained file) |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with ESLint |

### Build outputs

`npm run build` produces two files in `dist/`:

| File | Description |
|------|-------------|
| `index.html` | **Online** — standard build with split assets. Fonts loaded from Google Fonts CDN. Served by GitHub Pages. |
| `todo2.html` | **Offline** — everything inlined into one file (JS, CSS, fonts). Works from `file://` with no server or internet. |

## Tech stack

- React 19 + TypeScript + Vite
- Zustand (state management)
- Dexie.js (IndexedDB wrapper)
- React Flow (spatial canvas)
- dnd-kit (drag-and-drop)
- React Router v7

## License

MIT
