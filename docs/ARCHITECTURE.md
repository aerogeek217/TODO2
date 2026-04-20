# Architecture Overview

This file is the always-loaded orientation. For per-abstraction detail, load the relevant reference file listed under [Detail References](#detail-references).

## Tech Stack
- **Frontend**: React 19 + TypeScript, built with Vite
- **State**: Zustand stores
- **Database**: Dexie.js over IndexedDB (local-first)
- **Spatial Canvas**: React Flow
- **Drag-and-Drop**: dnd-kit
- **Routing**: React Router v7

## Dependency Graph

```
main.tsx (entry point)
├── App.tsx                → Router, layout shell
├── styles/tokens.css      → CSS custom properties (design system: dark/light themes via [data-theme], tint scale, shadows, radii, z-index, spacing, typography)
├── views/                 → Route-level pages
│   ├── CanvasPage         → components/canvas/, stores
│   ├── DashboardView      → `HorizonRibbon` (5 slots via `settings.horizonSlots`; `role=tablist`, arrow-key roving focus, "Edit horizons…" opens `DashboardListsEditor` filtered to slot-mapped defs) → two-column `.topRow` (Taskboard + hero horizon card) drag-swappable via `@dnd-kit/sortable`, order persisted through `settings.dashboardTopOrder`; hero card (`role=tabpanel`, inline "+ Add task to {horizon}" → `useTaskEditCallbacks.onCreate`) → "Your lists" grid driven by `settings.dashboardUserLists: number[]` (explicit ordered ids; seeded from legacy pinned-minus-horizons derivation on first post-P6 render; may include horizon-mapped defs alongside the ribbon), drag-reorderable via `@dnd-kit/sortable` writing back through the same setting, each card header carries a `⋯` overflow menu (Edit via `DashboardListsEditor.initialSelectedId` / Unpin — horizon-mapped removes id from the array only, non-horizon also clears `pinnedToDashboard` / Delete with confirm + undo-snackbar); per-horizon collapse persists via `settings.horizonCollapsed`, non-horizon cards use local collapse; "Add list" tile → `ListDefinitionPickerPopup` with `excludeIds={currentGrid}` + `onPin` that appends to `dashboardUserLists` (→ "Create new" auto-pins a blank def and opens the editor on it; includes "Notes" pseudo-entry when `settings.notesPinnedToDashboard === false`); Notes tile (shared `NotesBody`, CM6 Markdown inbox, Alt-T → task) rendered as a sortable card in the grid when `settings.notesPinnedToDashboard` (tracked by a `-1` sentinel inside `dashboardUserLists` so it drags/reorders alongside list cards), unpin via same ⋯ menu (with undo); shares `showCompleted` / `showHiddenStatuses`
│   ├── ListView           → Unified list with sort-by grouping (Date/Scheduled/Deadline/People/Project/Status/Org), saved views, "Save to Dashboard" → ListDefinition, plain text export
│   ├── CalendarView       → Month/week calendar grid, drag-to-reschedule, overdue highlights, recurring virtual instances
│   └── SettingsPage       → Theme toggle, manage buttons, task defaults, database location, import/export
├── components/
│   ├── layout/            → Sidebar, TopBar (filter bar + grouped search dropdown — `role=listbox` per-field `role=group` groups for Title/Notes/Project/Person/Org/Status, driven by `utils/filter.matchTodoText`; arrow-key roving; inline "Show all {n}"), FileSyncBanner, BottomTabBar (mobile)
│   ├── task/              → TaskRow (notes-icon button opens `TaskNotePopover` via shared `NotesBody`), TaskList, TaskEditPopup (notes field uses shared `NotesBody`), MobileTaskRow, TaskNotePopover
│   ├── canvas/            → CanvasView, ProjectNode, ListInsetNode, ListDefinitionBody (shared filter→buildDashboardLists body for inset + rail lens), FloatingNoteNode (placement-only canvas widget — renders the single global note via `NotesBody` with no content/color of its own), FloatingCalendarNode (canvas calendar widget — drag/resize chrome wrapping `TwoWeekCalendarStrip`; backs slot→canvas pop-outs), SortableTaskList, ProjectNavigator, alignment; rails/ (RailsFrame, RailContainer, Slot, SlotHeader, LensSlotContent, CalendarSlotContent + TwoWeekCalendarStrip, NotesSlotContent, TaskboardSlotContent, DraggableSlot — consumes `Slot.flex` via `--slot-flex` CSS var, SlotDivider (pointer-drag between sibling slots; snapshots every slot's measured px on pointer-down, writes pixel-valued weights via `canvas-rails-store.setSlotFlexBatch` so non-adjacent slots keep their size; min 80 px per slot, rAF-throttled), DockOverlay, SlotMenu — post-P3 "Split …" + "Pop out" only; kind switching moved to `WidgetKindMenu`, rail-dnd — Phase 4A scaffolding + 4B lens wiring + 4C slot drag-dock + 4D 2-week calendar strip + 4E notes slot + 4F persistence through `settings.canvasRails` (extended with `widths`/`heights` bags for per-side rail sizes, clamped to [200, 600], persisted through the same settings pipeline); RailContainer renders a pointer-driven `ResizeHandle` on the canvas-facing edge — rAF-throttled via `scheduledRef`, invokes `useCanvasRailsStore.setRailSize`; `SlotMenu` "Pop out to canvas" invokes `RailsFrame.popSlotToCanvas(slot)` which dispatches per kind into floating-note/list-inset/floating-calendar stores and closes the source slot — spawn position reads `settings.canvasViewport` upper-left + jitter)
│   ├── taskboard/         → TaskboardPanel (dashboard/rail card; accepts optional `taskboardId` prop, falls back to `useTaskboardStore.defaultBoardId`), TaskboardNode (canvas floating node, keyed by `{floatingId, taskboardId}` — one per `FloatingTaskboard` row, replaces the pre-P1 singleton)
│   ├── dashboard/         → HorizonRibbon + HorizonCell (5-cell horizon chart; reads settings `horizonSlots` + `listDefinitions`)
│   ├── overlays/          → CommandPalette, ReassignDialog, BulkConfirmDialog, UndoSnackbar, FilterSheet (mobile), ListDefinitionPickerPopup, TaskboardPickerPopup (taskboard kind/instance picker used by WidgetKindMenu's secondary row on taskboard slots + floats)
│   ├── settings/          → PeopleEditor, OrgEditor, StatusEditor, ThemeColorsEditor, KeyboardShortcutsModal, DashboardListsEditor
│   └── shared/            → Chip, SectionHeader, ChipSelector, ColorInput, StatusIcon, AvatarStack, WidgetHeader (unified slot/widget chrome: kind icon via `utils/slot-kind.KIND_ICON`, drag handle, collapse, title, meta, pop-out ⇱ / dock ↙ / more ⋯ / close ×; `floating` prop switches to hover-revealed buttons with `nopan nodrag`; `onTitleClick` renders title as a ▾-caret button that fires anchor coords — carrier for the P3 kind selector; consumed by rails `SlotHeader` + `FloatingNoteNode` + `FloatingCalendarNode` + `ListInsetNode` + `TaskboardNode`), WidgetKindMenu (shared title-click popover — four kind radios + optional "Change list…"/"Change taskboard…" secondary; opens `ListDefinitionPickerPopup` or `TaskboardPickerPopup`; rails use `canvas-rails-store.setSlotKind`; floats use `utils/float-kind-switch.convertFloatingKind` to delete the source float + create a new kind at the same rect), notes/NotesEditor (CM6 wrapper + HTML→Markdown paste via `htmlToMarkdown`) + notes/NotesBody (shared editor + Alt-T-to-task via CM keymap + `→ ✓` toolbar button; no footer chrome; platform-aware shortcut labels via `utils/platform.formatShortcut`) + notes/NotesToolbar (Bold/Italic/H1/H2/Bullet/Checkbox + ⧉ copy-rich; dispatches CM commands via viewRef; parent owns copy handler that flushes note-store first), selection.module.css, dropdown.module.css
├── stores/                → Zustand (canvas, canvas-rails, todo, project, person, org, status, list-inset, floating-note, floating-calendar, floating-taskboard, taskboard, ui, filter, undo, saved-view, list-definition, settings, file-storage, note — note-store owns only the single global "outside-tasks" note; floating-note-store + floating-calendar-store + floating-taskboard-store own per-canvas placement widgets that view their respective global content (note / shared calendar filter / referenced `Taskboard` row); taskboard-store is instance-indexed (`boards: Map<number, Taskboard>` + `defaultBoardId`; entry ops scoped by `taskboardId`))
├── data/                  → Dexie repositories + migrations + restore + audit
├── models/                → TypeScript interfaces
├── hooks/                 → Custom React hooks
├── utils/                 → Shared pure utilities (hierarchy, dates, effective-date, filter — `toggleItem` + `matchTodoText(todo, query, ctx)`/`TextMatchField` for multi-field text search used by TopBar + `filter-store.matchesFilter`, platform — `isMacLike()` + `formatShortcut('Mod-…'/'Alt-…')` for ⌘/Ctrl/⌥/Alt-aware shortcut labels, slot-kind — `KIND_ICON` / `KIND_LABEL` maps, float-kind-switch — `convertFloatingKind` deletes a float row and recreates it at the target kind+rect, used by all four floating nodes on title-menu kind change)
└── services/              → NLP, command registry, file storage, undoable, backup scheduler, dashboard-lists interpreter, horizons (ribbon bin geometry), notes-export (Markdown ⇄ HTML clipboard helpers: `mdToHtml`, `htmlToMarkdown`, `copyNotesRich`)
```

## Data Flow

1. **App startup**: Dexie opens IndexedDB → `useCanvasStore.ensureDefault()` → `fileStorageService.initialize()` reconnects to saved file handle and loads file data into IndexedDB. Settings store loads theme mode and applies `data-theme` to `<html>`; only user-customized color overrides are set as inline styles. Expired completed tasks purged if `completedRetentionDays` configured. `backupScheduler.start()` begins periodic auto-snapshots.
2. **Normal use**: User acts in UI → Zustand stores call repository methods → Dexie persists to IndexedDB. If file storage is connected, Dexie hooks debounce-save all changes to the JSON file on disk.
3. **Canvas**: Single canvas only; `useCanvasStore.ensureDefault()` creates/selects it at startup.
4. **View switching**: Sidebar icons navigate between Canvas, Dashboard, List, Calendar, Settings via React Router. Dashboard renders a HorizonRibbon (5 horizon slots mapped via `settings.horizonSlots` to seeded custom-predicate `listDefinitions`: This week / Next week / Rest of month / Later / Someday), a hero card for the selected horizon, secondary grids for the other horizons and for user-pinned non-horizon list-defs. List view groups all todos by a user-selected sort-by attribute.
5. **Person assignment**: Many-to-many via `todoPeople` join; `usePersonStore` maintains an `assignedPeopleMap` cache.
6. **Person-org membership**: Many-to-many via `personOrgs` join; a person can belong to multiple orgs.

## Detail References

Load the relevant file when you need per-abstraction detail. Each is a table of `Abstraction | Location | Purpose` rows.

| File | Covers |
|------|--------|
| [architecture/models-and-data.md](architecture/models-and-data.md) | Models (`src/models/`), repositories, migrations, validation, restore (`src/data/`) |
| [architecture/state.md](architecture/state.md) | Zustand stores, filter semantics, store helpers (`src/stores/`) |
| [architecture/components.md](architecture/components.md) | Views, task/canvas/overlay/shared/layout/settings/taskboard components, ListView bucket builders |
| [architecture/services-and-utils.md](architecture/services-and-utils.md) | Services (dashboard-lists interpreter, NLP, recurrence, file storage, exports), hooks, pure utils |

---

**Update this file (and the matching reference) whenever you add new modules or change the dependency graph.**
