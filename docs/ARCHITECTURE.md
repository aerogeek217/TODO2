# Architecture Overview

This file is the always-loaded orientation: what lives where and how data moves. Every module's detail — its functions, rules and edge cases — is in the reference files under [Detail References](#detail-references); load the one you need.

## Tech Stack
- **Frontend**: React 19 + TypeScript, built with Vite
- **State**: Zustand stores
- **Database**: Dexie.js over IndexedDB (local-first, no backend)
- **Drag-and-Drop**: dnd-kit
- **Routing**: React Router v7 data router (`createHashRouter` + `RouterProvider`; one splat route renders the shell's `<Routes>`, so `useBlocker` is available)
- **Builds + CSP** (a `<meta>` in `index.html`, `base-uri 'none'; form-action 'none'` everywhere): the online build (`vite.config.ts`; `dist/index.html`) loads scripts from `./assets` only, so its `cdnFonts` plugin drops `script-src 'unsafe-inline'` (and adds Google Fonts) and `noInlineScripts` fails the build on any inline script; the offline single file (`vite.config.offline.ts`; `dist/todo2.html`) keeps `'unsafe-inline'` for its one inline script and allows its embedded `data:` fonts (`offlineCsp`); its icons are `data:` URLs too (SVG, the .ico's 16–64 px bitmaps, the 192 px PNG — `offlineIcons`) and it has no manifest link, so the file works alone from disk. Dev keeps `'unsafe-inline'` for the React refresh preamble

## Dependency Graph

Layers, lowest first — a module imports only from its own layer or lower, and `src/test/architecture/folder-cycles.test.ts` fails on any folder cycle: `models` / `utils` → `data` → `stores` → `services` → `hooks` → `components` → `views`. Services orchestrate stores; no store imports a service.

```
main.tsx                  → mounts App
├── App.tsx               → hash data router (`/` workspace, `/settings` the phone Settings page — a deep link to the Settings modal on desktop; old page routes redirect to `/`); the shell: top bar, launch (`services/app-startup`), the Settings modal, the command palette (`AppCommandPalette`), keyboard shortcuts, global dialogs
├── styles/tokens.css     → design tokens (dark / light via `[data-theme]` — the only place a rule forks per theme) + global base rules, incl. the one reduced-motion rule
├── views/                → WorkspacePage (`/`: opens the workspace store, loads the tasks and entities, owns the workspace DndContext, guards unsaved changes) · SettingsPage (phone)
├── components/
│   ├── layout/           → TopBar (New task, layout tabs, screen filters, search, Show N tasks — the filtered-tasks panel's toggle —, StoragePill, gear; the measured fold), StoragePill + sync-status (every sync / backup warning), the phone's SyncStatusButton and BottomTabBar
│   ├── workspace/        → WorkspaceView (top band · columns of cells · bottom band, dividers, tab / panel drags), WorkspaceCell + CellTabStrip, LayoutControls, UnsavedPrompt, MobileWorkspaceView; the widgets: list/ (ListWidget, Edit list), calendar/, eisenhower/, dashboard/, NotesWidget
│   ├── task/             → TaskRow (desktop grid row) / MobileTaskRow, TaskMenu, TaskEditPopup, TaskNotePopover, notes/ (CodeMirror notes editor, notes → tasks), dnd/
│   ├── overlays/         → CommandPalette, QuickAddBar, TaskDialog + TaskDialogContent (+ the phone's screen-filter bar for its filtered tasks), FilteredTasksPanel (desktop: the screen filter's tasks dropped from the top bar's tray — expanded in place over the bar when the filters are folded — over a blurring scrim), dialogs (sync conflict / upgrade / launch permission, purge, append import, bulk confirm, confirm prompts), UndoSnackbar, FilterSheet (phone)
│   ├── checkin/          → CheckinDialog (email check-ins), CheckinImportDialog (paste a reply)
│   ├── settings/         → SettingsModal + sections/, the entity editors (people / statuses / tags / theme colours), shortcut list / editor
│   └── shared/           → DialogFrame, MenuPopover, Tooltip, pickers (ChipSelector, AnchoredPicker), filters/ (filter chips and panels), followup/, EntityMenu, icons
├── hooks/                → use-popover-anchor (every popover's placement), use-keyboard-shortcuts, use-built-list, use-widget-selection, use-dashboard-data, use-eisenhower-source, use-picker-order (the checklist pickers' selected-on-top order), small DOM / media / time hooks
├── services/             → replace-data (every data replace) + refresh-all, app-startup, file-storage (+ file-storage-store, the one store outside `stores/`), command-registry + keyboard-shortcuts, NLP (parser, resolver, autocomplete, create on pick), build-list + list-sections, stats/, checkin-email/ + checkin-reply/, create-task / task-draft, exports and imports (data-files, markdown, task-archive, purge-completed, append-import), eisenhower-drop, remove-entities (Settings' unused people & tags removal), migration-check
├── stores/               → Zustand: todo, person, status, tag, note, settings, workspace (layouts + working copy), list-definition / list-draft / list-order / list-widget, filter, ui, undo, trend-events, file-ops (backups / audit state); safety-snapshot (the backup gate) and store-helpers
├── data/                 → Dexie database + repositories, the table registry, import pipeline (size caps → version check → schema upgrades → validation), schema-upgrades + upgrades/v50…v68, restore, export, audit, backup-scheduler, draft-storage (unsaved edits kept for a reload)
├── models/               → TypeScript interfaces: todo item, list definition (+ owner), filter predicate, workspace layout + widget kinds, dashboard config, Eisenhower settings, keyboard shortcuts, theme colours
└── utils/                → pure helpers: dates, recurrence, filters (criteria, matching, negation, chips), urgency / hot / markers / Eisenhower panes, grouping and sort, layout ops + drop hit-testing, row columns, shortcut chords, dom-contract (the data attributes non-components read), module-reset
```

## Data Flow

1. **Startup** (`services/app-startup.runAppStartup`): `App.tsx` first checks the database's version (below the floor → `MigrationDialog`; saved by a newer build → only `DatabaseTooNewDialog`, nothing read or written). Then settings load (theme, colour overrides) → the sync file reconnects (`fileStorageService.initialize()`). When its handle needs permission again, launch **waits for the launch question** (Grant access… / Continue without the file) before anything else runs. The load decision changes nothing on either side until the user resolves a disagreement (conflict / older file / unreadable → a dialog or a pause); a browser merely ahead of an unchanged file is written to it after a backup of the file's text. Then the stores load. Completed tasks past the retention are **never purged silently**: the purge prompt asks (Export & delete / Delete / Not now), at most once every N days, also after a later sync-file load. `backupScheduler.start()` takes a daily automatic backup; each backup kind keeps its newest few within a byte budget.
2. **Normal use**: UI → Zustand stores → repositories → Dexie. While a sync file is syncing, Dexie hooks debounce-save to it; while paused or waiting for permission they only mark the browser dirty, which the next load resolves (written to an unchanged file, else asked about). Destructive operations — a data replace, a purge, a bulk delete of more than five tasks, removing unused people and tags — back up first (`takeSafetySnapshot`; a failed backup asks before going on). New tasks come through `QuickAddBar` (its Details hands off to `TaskEditPopup`'s create mode).
3. **Data replaces** (`services/replace-data.replaceData`) — Settings import and backup restore, the audit's cleanup, the sync file's load, the append import: note saves held → safety snapshot → the write → the stores reload (`refresh-all`; an append import reloads the task stores only and keeps the undo history) → `onDataReplaced` listeners.
4. **Workspace**: a layout is columns of cells plus an optional full-width band above and below (a band is a cell spanning the workspace). Stored layouts are read through the layout repair (a part this build can't use is dropped; the layout opens unsaved). Layout edits make the working copy unsaved until Save (kept in the browser across a reload, never in the database); the layouts' order and view state (pane sizes from the dividers, active tab, collapse, calendar view, row details width) save at once — a size among parts an unsaved edit added stays with that edit until Save. On a phone one column or band shows at a time.
5. **Navigation**: desktop is one page — the workspace under one top bar; Settings is a modal over it (gear, `G S`, the palette, the storage pill, `#/settings`), so it never changes the route. On a phone the bottom tab bar routes between `/` and `/settings`, and the workspace's `useBlocker` asks before unsaved work is left.
6. **Lists**: a list tab runs its definition through `useBuiltList` with the top-bar (screen) filter composed in (narrowing clauses AND, Show completed ORs). Edits from a widget go to `list-draft-store` — every widget showing the list shows the draft unsaved until Save or Revert; kept across a reload. Manual order is per list and saves at once. **Every list belongs to one layout** (`owner: { layoutId }`) and is offered only there: a layout's Save deletes its lists no saved tab shows, Save as copies the ones it shows, Delete takes them with it. The Eisenhower has its own hidden list (`owner: { eisenhower: true }`), shown by every Eisenhower tab and the dashboard's Eisenhower section, under the app-wide panes (Settings › Tasks › Eisenhower).
7. **People / tags**: many-to-many via `todoPeople` / `todoTags`, cached in the person / tag stores' assignment maps. A person's optional email is where check-ins go. `Org: <name>` people and `Project: <name>` tags (from the old org / project migrations) are naming conventions only. Settings › People, statuses & tags › Find unused… (Unused people & tags, a dialog) lists the ones no task has (optionally ignoring completed tasks, noting the filters that name them) and removes the ticked ones with their assignments as one undo step; filters naming them keep the ids and stop matching, as after a single delete.
8. **Dashboard**: every number comes from the pure `services/stats/*` functions over the screen-filtered tasks and over all tasks (`shown of total`); the trend reads `todoEvents` through `trend-events-store`. What shows is the tab's `config`, saved with the layout.
9. **Email check-ins** (no mail API): `services/checkin-email` builds each person's email from their open tasks under the saved check-in filter (a `Ref` per task), hands it to the mail app (clipboard + `mailto:`, or an `.eml` draft) and marks the tasks followed up as one undo entry. A reply comes back by paste: `checkin-reply` parses it, diffs it against the tasks, and applies the ticked changes as one undo group.

## Testing

Two layers, picked by what's being verified (setup, fixtures and helpers: [architecture/testing.md](architecture/testing.md)):

- **vitest (`npm test`)** — unit + JSDOM under `src/test/**`: pure logic, models, repositories, stores, services, utilities, and rendering / event dispatch that doesn't depend on real layout, focus or async DOM timing. Two projects (`isolated` for files that mock modules, `shared` for the rest); every store and every registered module state is reset before each test.
- **Playwright (`npm run test:e2e`)** — Chromium-only real-browser flows under `e2e/**`, on its own dev server (port 5173, or `PW_PORT`). Specs wait on app state, never on timers. CI (the deploy workflow) runs only vitest.

**JSDOM is not authoritative** for focus handoffs, `ResizeObserver`-driven layout, drag-and-drop hit-testing, popover placement and viewport flips, and async-store-driven re-render timing — those need a Playwright spec.

**Diagnosis vs. regression.** The Chrome DevTools MCP server (`mcp__chrome-devtools__*`) is a *spike* tool — drive an interaction live in real Chromium, then codify the regression in Playwright. See CLAUDE.md "Tools — Chrome DevTools MCP".

**Manual-testing seed.** `npm run seed:dev` writes a realistic v49 export to `dev-data/seed-v49.json` (gitignored) for Settings → Import / Export → Import JSON, which runs the full upgrade.

## Detail References

Each is a table of `Abstraction | Location | Purpose` rows.

| File | Covers |
|------|--------|
| [architecture/models-and-data.md](architecture/models-and-data.md) | Models (`src/models/`), repositories, migrations and the v50–v68 upgrade transforms, validation, restore (`src/data/`) |
| [architecture/state.md](architecture/state.md) | Zustand stores, filter semantics, store helpers (`src/stores/`) |
| [architecture/components.md](architecture/components.md) | Views, workspace / task / overlay / shared / layout / settings components, design tokens |
| [architecture/services-and-utils.md](architecture/services-and-utils.md) | Services (data replaces, file storage, build-list, NLP, stats, check-ins, exports), hooks, pure utils |
| [architecture/testing.md](architecture/testing.md) | vitest projects and resets, Playwright config and fixtures, the architecture and style checks |

---

**Update this file (and the matching reference) whenever you add new modules or change the dependency graph.**
