# Architecture Overview

This file is the always-loaded map: the stack, the layers, what lives in each folder, how data moves, and where the detail is. It stays under 3,000 words.

- **How a feature behaves** is in its file under [Features](#features). Read that file before changing the feature.
- **What a module does** is in the layer tables under [Detail references](#detail-references).

## Tech Stack
- **Frontend**: React 19 + TypeScript, built with Vite
- **State**: Zustand stores
- **Database**: Dexie.js over IndexedDB (local-first, no backend)
- **Drag-and-Drop**: dnd-kit
- **Routing**: React Router v7 data router (`createHashRouter` + `RouterProvider`; one splat route renders the shell's `<Routes>`, so `useBlocker` is available)
- **Builds**: `npm run build` makes the online build (`vite.config.ts` → `dist/index.html`: scripts from `./assets`, CDN fonts) and the offline single file (`vite.config.offline.ts` → `dist/todo2.html`), which **makes no network request**. Each has its own content security policy. The offline build ends with an egress check that fails it on anything that loads, and ESLint bans the network APIs, navigating away and the HTML-parsing sinks in `src/`. Detail: [build-and-csp](architecture/features/build-and-csp.md)

## Layers

Lowest first: `models` / `utils` → `data` → `stores` → `services` → `hooks` → `components` → `views`.

- A module imports only from its own layer or lower.
- Services orchestrate stores; no store imports a service. `services/file-storage-store` is the one store outside `stores/`: it is the React adapter over the `fileStorageService` singleton, and the service imports stores.
- `src/test/architecture/folder-cycles.test.ts` fails on any folder cycle.

## What lives where

```
main.tsx                → mounts App
App.tsx                 → the hash router (`/` the workspace, `/settings` the phone's Settings page) and the shell:
                          top bar, launch, the Settings modal, the command palette, keyboard shortcuts, global dialogs
styles/tokens.css       → design tokens (dark / light via `[data-theme]`, the only place a rule forks per theme),
                          the one focus ring, the view transitions, the one reduced-motion rule
views/                  → WorkspacePage (`/`), SettingsPage (phone)
components/
├── layout/             → the top bar and its screen-filter tray, the layout edit bar, the storage pill,
│                         the phone's sync button and bottom tab bar
├── workspace/          → the layout's table of cells, cell chrome, the layout edit mode, the widget popup, and the
│                         widgets: list/, calendar/, glance/, neglect/, clusters/, listwall/, planner/, review/, NotesWidget
├── task/               → task rows (desktop and phone), Quick Add, the task menu, the task editor,
│                         status-updates/, subtasks/, notes/, dnd/
├── overlays/           → the command palette, the task dialog, the filtered-tasks panel, dialogs,
│                         hosts for row popovers and pickers, the undo snackbar, the phone's filter sheet
├── review/             → the review's parts (rail, card, footer), shared by the Review widget's faces
├── checkin/            → the check-in dialog and the reply import
├── ambience/           → the top bar's sky and the workspace's light
├── settings/           → the Settings modal, its sections, the entity editors, the shortcut editor
└── shared/             → one tooltip, one remove button, the dialog frame, menus, the popover root, pickers,
                          filters/, followup/, icons, the icon picker
hooks/                  → React hooks over stores and services: built lists, glance data, widget faces,
                          popover placement, keyboard shortcuts, the ambience scene
services/               → orchestration over stores: startup, data replaces, file storage, the palette's commands,
                          NLP, build-list, stats/, review, check-ins, the Planner's writes, exports and imports
stores/                 → Zustand stores, one per kind of data or UI state, plus `editor-leave`, `replace-hold`,
                          `safety-snapshot` and `store-helpers`
data/                   → the Dexie database, repositories, the table registry, the import pipeline,
                          the schema-upgrade registry, restore, export, audit, the backup scheduler
models/                 → TypeScript interfaces
utils/                  → pure helpers: dates, filters and expressions, grouping and sort, the layout's table and
                          its ops, the Planner's rules, the sky
```

## Data Flow

1. **Startup.** `App.tsx` first checks the database's version: too old or too new shows a dialog and nothing is read or written. Then `services/app-startup.runAppStartup` loads settings, reconnects the sync file and loads the stores. When the file's handle needs permission, launch waits for the launch question; a browser that does not answer within 5 s is not waited on. The load decision changes nothing on either side until the user resolves a disagreement between the file and the browser. Completed tasks past the retention are never purged silently: the storage pill shows a notice. Detail: [startup-and-data-replaces](architecture/features/startup-and-data-replaces.md)
2. **Normal use.** UI → Zustand stores → repositories → Dexie. While a sync file is syncing, Dexie hooks debounce-save to it. Every task write stamps the task's `modifiedAt`; an undo puts back the stamp from before the step and a redo the step's own. One write stamps nothing: a task's plan state (its planned day), wherever it is set. Destructive operations back up first (`takeSafetySnapshot`). Detail: [tasks](architecture/features/tasks.md), [planner](architecture/features/planner.md)
3. **Data replaces.** A Settings import, a backup restore, the audit's cleanup, the sync file's load and the append import all go through `services/replace-data.replaceData`: note saves held → safety snapshot → layout writes in flight settled → the write → the stores reload → `onDataReplaced` listeners. A file is read through the import pipeline first, and one below the schema floor (`OLDEST_SUPPORTED_DB_VERSION`) is refused. Detail: [startup-and-data-replaces](architecture/features/startup-and-data-replaces.md), [import-and-export](architecture/features/import-and-export.md)
4. **Workspace.** A layout is one table: grid tracks across and down, and cells that each cover a rectangle of tracks and hold a strip of widget tabs. Edit mode changes the grid; what is inside a cell changes in place. Outside the mode every layout edit is written at once as one undo step, so a layout has no Save. The layout edit mode holds a draft that only Done writes. Detail: [workspace-layout](architecture/features/workspace-layout.md), [layout-autosave](architecture/features/layout-autosave.md), [layout-edit-mode](architecture/features/layout-edit-mode.md), [widget-chrome](architecture/features/widget-chrome.md)
5. **The screen filter.** The top bar's chips and the expression typed beside them. It is one filter for every layout, it is never saved, and every widget reads it through `stores/screen-filter`. Detail: [screen-filter](architecture/features/screen-filter.md), [filters](architecture/features/filters.md)
6. **Lists.** A list tab runs its definition through `useBuiltList` with the screen filter composed in. Every list belongs to one layout. Edit list edits a draft that Save writes as one undo step. Detail: [lists](architecture/features/lists.md)
7. **Navigation.** Desktop is one page: the workspace under one top bar. Settings is a modal over it (gear, `G S`, the palette, the storage pill, `#/settings`), so it never changes the route. It reopens on the section last shown, across reloads (a `localStorage` key; Appearance the first time), unless it is opened on a section or part. On a phone the bottom tab bar routes between `/` and `/settings`; nothing is unsaved, so leaving the workspace asks nothing.
8. **Leaving an editor.** A popover saves what was typed however it closes. Edit list, the widget editors and the layout edit mode hold a copy until their Save, and nothing leaves one that holds changes without asking Save / Discard / Keep editing (`stores/editor-leave`). Detail: [popovers-and-editors](architecture/features/popovers-and-editors.md)

## Features

One file per feature, at most 4,000 words each. Each says how the feature behaves and names the code that does it.

| Feature | File | Covers |
|---------|------|--------|
| Builds and CSP | [build-and-csp](architecture/features/build-and-csp.md) | the online and offline builds, their policies, the egress check, what ESLint bans |
| Startup and data replaces | [startup-and-data-replaces](architecture/features/startup-and-data-replaces.md) | launch, the sync file's reconnect, the start screen, the purge notice; `replaceData`, the replace hold, the note's save and its hold |
| Import and export | [import-and-export](architecture/features/import-and-export.md) | what an import refuses, repairs and reports, the audit and its checks, lists given a layout |
| Settings | [settings](architecture/features/settings.md) | the settings table, the settings store, the Settings modal's state |
| Tasks | [tasks](architecture/features/tasks.md) | the task row, the task store's writes, `modifiedAt`, undo and redo, safety snapshots, the new-task flight, people and tags |
| Status updates and subtasks | [status-updates-and-subtasks](architecture/features/status-updates-and-subtasks.md) | dated status updates and following up by entering one, the checklist, notes → tasks |
| Workspace layout | [workspace-layout](architecture/features/workspace-layout.md) | the table and its tabs, rendering, dividers, adding a widget, hue and icon, the Calendar, the phone |
| Layout autosave | [layout-autosave](architecture/features/layout-autosave.md) | how a layout is written, what is one undo step, lists following an edit, view state, failed writes; opening, creating, duplicating and deleting layouts |
| Layout ops | [layout-ops](architecture/features/layout-ops.md) | split and insert, removing and merging tracks, cells, collapsing a row |
| Layout edit mode | [layout-edit-mode](architecture/features/layout-edit-mode.md) | the draft, rulers, cards and slots, the tray, drops and the ghost |
| Move / Copy to layout | [cross-layout-moves](architecture/features/cross-layout-moves.md) | the menu entries, placing the widgets, Done and Cancel, the two-layout write and its undo, what goes with a tab |
| Widget chrome | [widget-chrome](architecture/features/widget-chrome.md) | cell menus, tabs on demand, the strip of Numbers, fit rows, faces, Open larger |
| Screen filter | [screen-filter](architecture/features/screen-filter.md) | the top bar's chips and typed filter, the pause, the counter |
| Filters | [filters](architecture/features/filters.md) | date clauses, Graphical or Expression, the expression grammar, a filter read back in words |
| Lists | [lists](architecture/features/lists.md) | built lists, grouping, rows, zoom, badges, Edit list |
| Glance widgets | [glance-widgets](architecture/features/glance-widgets.md) | what glance widgets share, the Number and its shapes, the widget editors, the history log |
| Charts | [charts](architecture/features/charts.md) | Breakdown, Pivot, Created vs completed |
| Task maps | [task-maps](architecture/features/task-maps.md) | the Neglect map, Work clusters, the List wall |
| Review | [review](architecture/features/review.md) | Review jumps, the rail and the card, the task layout the editor shares, the Review widget |
| Check-ins | [check-ins](architecture/features/check-ins.md) | the message, the check-in dialog, Copy, the reply import |
| Planner | [planner](architecture/features/planner.md) | a task's plan state, placement, the window, drops, Snooze and Unplan, Reset plan |
| Planner widget | [planner-widget](architecture/features/planner-widget.md) | the Planner's faces, its rows, drag feedback, menus |
| Ambience | [ambience](architecture/features/ambience.md) | the sky, the seasons, the settings |
| Popovers and editors | [popovers-and-editors](architecture/features/popovers-and-editors.md) | what a dismissal keeps, the editor-leave rule and everything that asks it |

## Testing

Two layers, picked by what's being verified (setup, fixtures and helpers: [architecture/testing.md](architecture/testing.md)):

- **vitest (`npm test`)** — unit + JSDOM under `src/test/**`: pure logic, models, repositories, stores, services, utilities, and rendering / event dispatch that doesn't depend on real layout, focus or async DOM timing. Two projects (`isolated` for files that mock modules, `shared` for the rest); every store and every registered module state is reset before each test.
- **Playwright (`npm run test:e2e`)** — Chromium-only real-browser flows under `e2e/**`, on its own dev server (port 5173, or `PW_PORT`). Specs wait on app state, never on timers. CI (the deploy workflow) runs only vitest.

**JSDOM is not authoritative** for focus handoffs, `ResizeObserver`-driven layout, drag-and-drop hit-testing, popover placement and viewport flips, and async-store-driven re-render timing — those need a Playwright spec.

**Diagnosis vs. regression.** The Chrome DevTools MCP server (`mcp__chrome-devtools__*`) is a *spike* tool — drive an interaction live in real Chromium, then codify the regression in Playwright. See CLAUDE.md "Tools — Chrome DevTools MCP".

**Manual-testing seed.** `npm run seed:dev` writes a realistic export in the current schema to `dev-data/seed-v87.json` (gitignored) for Settings → Import / Export → Import JSON.

## Detail References

The layer tables. Each is a table of `Abstraction | Location | Purpose` rows: what a module is, where it is, what it is for.

| File | Covers |
|------|--------|
| [architecture/models-and-data.md](architecture/models-and-data.md) | Models (`src/models/`), repositories, the schema floor and the upgrade registry, validation, restore (`src/data/`) |
| [architecture/state.md](architecture/state.md) | Zustand stores, filter semantics, store helpers (`src/stores/`) |
| [architecture/components.md](architecture/components.md) | Views, workspace / task / overlay / shared / layout / settings components, design tokens |
| [architecture/services-and-utils.md](architecture/services-and-utils.md) | Services (data replaces, file storage, build-list, NLP, stats, check-ins, exports), hooks, pure utils |
| [architecture/testing.md](architecture/testing.md) | vitest projects and resets, Playwright config and fixtures, the architecture and style checks |

## Keeping the docs short

`src/test/architecture/doc-budgets.test.ts` fails `npm test`, and so the deploy, when this file is over 3,000 words, when a feature file is over 4,000 or is not listed under [Features](#features), or when a layer-table row is over 300. `services-and-utils.md` and `components.md` still have rows over 300: a baseline beside the test lists them, and they may not grow or multiply.

- **A new module** gets one row in its layer table: what it is, where it is and what it is for.
- **How it behaves** goes in its feature file. A feature file that outgrows its budget is split in two, and both are listed above.
- **This file changes** only when a folder, a layer, a feature file or the outline of the data flow changes.
- **Describe the app as it is.** No plan names, dates or notes about what was removed: history is in git and `CHANGELOG.md`. What a schema upgrade does is in [architecture/models-and-data.md](architecture/models-and-data.md).
