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
│   ├── DashboardView      → `HorizonRibbon` (5 slots via `settings.horizonSlots`; `role=tablist`, arrow-key roving focus, "Edit horizons…" opens `DashboardListsEditor` filtered to slot-mapped defs) → two-column `.topRow` (Taskboard + hero horizon card) drag-swappable via `@dnd-kit/sortable`, order persisted through `settings.dashboardTopOrder`; hero card (`role=tabpanel`, inline "+ Add task to {horizon}" → `useTaskEditCallbacks.onCreate`) → "Your lists" grid of non-horizon pinned `listDefinitions`, drag-reorderable via `useListDefinitionStore.reorder` (persists through `ListDefinition.sortOrder`), each card header carries a `⋯` overflow menu (Edit via `DashboardListsEditor.initialSelectedId` / Unpin with undo-snackbar / Delete with confirm + undo-snackbar); per-horizon collapse persists via `settings.horizonCollapsed`, non-horizon cards use local collapse; "Add list" tile → `ListDefinitionPickerPopup` (→ "Create new" auto-pins a blank def and opens the editor on it; includes "Notes" pseudo-entry when `settings.notesPinnedToDashboard === false`); Notes tile (shared `NotesBody`, CM6 Markdown inbox, ⌘T → task) rendered inline in the grid when `settings.notesPinnedToDashboard`, unpin via same ⋯ menu (with undo); shares `showCompleted` / `showHiddenStatuses`
│   ├── ListView           → Unified list with sort-by grouping (Date/Scheduled/Deadline/People/Tag/Project/Status/Org), saved views, "Save to Dashboard" → ListDefinition, plain text export
│   ├── CalendarView       → Month/week calendar grid, drag-to-reschedule, overdue highlights, recurring virtual instances
│   └── SettingsPage       → Theme toggle, manage buttons, task defaults, database location, import/export
├── components/
│   ├── layout/            → Sidebar, TopBar (filter bar + search + storage status), FileSyncBanner, BottomTabBar (mobile)
│   ├── task/              → TaskRow (notes-icon button opens `TaskNotePopover` via shared `NotesBody`), TaskList, TaskEditPopup (notes field uses shared `NotesBody`), MobileTaskRow, TaskNotePopover
│   ├── canvas/            → CanvasView, ProjectNode, ListInsetNode, ListDefinitionBody (shared filter→buildDashboardLists body for inset + rail lens), FloatingNoteNode (canvas note widget — drag/resize chrome wrapping shared `NotesBody`), SortableTaskList, ProjectNavigator, alignment; rails/ (RailsFrame, RailContainer, Slot, SlotHeader, LensSlotContent, LensTitleButton, CalendarSlotContent + TwoWeekCalendarStrip, NotesSlotContent, DraggableSlot, DockOverlay, SlotMenu, rail-dnd — Phase 4A scaffolding + 4B lens wiring + 4C slot drag-dock + 4D 2-week calendar strip + 4E notes slot + 4F persistence through `settings.canvasRails`)
│   ├── taskboard/         → TaskboardPanel (dashboard card), TaskboardNode (canvas node)
│   ├── dashboard/         → HorizonRibbon + HorizonCell (5-cell horizon chart; reads settings `horizonSlots` + `listDefinitions`)
│   ├── overlays/          → CommandPalette, ReassignDialog, BulkConfirmDialog, UndoSnackbar, FilterSheet (mobile)
│   ├── settings/          → PeopleEditor, OrgEditor, TagEditor, StatusEditor, ThemeColorsEditor, KeyboardShortcutsModal, DashboardListsEditor
│   └── shared/            → Chip, SectionHeader, ChipSelector, ColorInput, StatusIcon, AvatarStack, notes/NotesEditor (CM6 wrapper + HTML→Markdown paste via `htmlToMarkdown`) + notes/NotesBody (shared editor + ⌘T-to-task + platform-aware shortcut labels via `utils/platform.formatShortcut`) + notes/NotesToolbar (Bold/Italic/H1/H2/Bullet/Checkbox + ⧉ copy-rich; dispatches CM commands via viewRef; parent owns copy handler that flushes note-store first), selection.module.css, dropdown.module.css
├── stores/                → Zustand (canvas, canvas-rails, todo, project, person, tag, org, status, list-inset, taskboard, ui, filter, undo, saved-view, list-definition, settings, file-storage, note — note-store owns both the global dashboard/rail note and per-canvas floating notes)
├── data/                  → Dexie repositories + migrations + restore + audit
├── models/                → TypeScript interfaces
├── hooks/                 → Custom React hooks
├── utils/                 → Shared pure utilities (hierarchy, dates, effective-date, filter, platform — `isMacLike()` + `formatShortcut('Mod-t')` for ⌘/Ctrl-aware shortcut labels)
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
