# Architecture Overview

This file is the always-loaded orientation. For per-abstraction detail, load the relevant reference file under [Detail References](#detail-references).

## Tech Stack
- **Frontend**: React 19 + TypeScript, built with Vite
- **State**: Zustand stores
- **Database**: Dexie.js over IndexedDB (local-first)
- **Spatial Canvas**: React Flow
- **Drag-and-Drop**: dnd-kit
- **Routing**: React Router v7 (HashRouter)

## Dependency Graph

```
main.tsx (entry point)
├── App.tsx                → Router, layout shell; clears `filter-store` on pathname change
├── styles/tokens.css      → Design tokens (dark/light themes via [data-theme], tints, shadows, radii, z-index, spacing, type)
├── views/                 → Route-level pages
│   ├── CanvasPage         → Hosts components/canvas/, owns global DndContext + collision rules
│   ├── ListView           → Unified list with sort-by grouping; Save/Load over `ListDefinition` (favorited→Favorites bar); rich-text export via `task-copy.copyTasksRich`
│   ├── CalendarView       → Month/week grid, drag-to-reschedule, overdue highlights, recurring virtual instances
│   └── SettingsPage       → Theme, manage entities, task defaults, file storage, import/export
│   (DashboardView retired — horizon ribbon is a canvas `horizons` widget; `/dashboard` redirects to `/`.)
├── components/
│   ├── layout/            → Sidebar (theme toggle + ⚙ in `bottomIcons`), TopBar (filter bar + grouped search dropdown driven by `filter.matchTodoText`; search rows are draggable into taskboards), FileSyncBanner, BottomTabBar (mobile)
│   ├── task/              → TaskRow + MobileTaskRow (mount the shared `TagChipSelector` before the pill bar so the row reads `# @ date status` — `#tag` chips inline + lookup-or-create popover); TaskList; TaskEditPopup; TaskNotePopover
│   ├── canvas/            → CanvasView (mounts CanvasToolbar; pop-out indicator follows pointer), CanvasToolbar (Fit-to-view + collapse/expand all rails), ProjectNode (sort + group-by + ⧉ copy), ListInsetNode, ListDefinitionBody (shared filter→buildDashboardLists body for inset + lens), RuntimeFilterPicker (multi-value chip picker, portaled), the five floating widgets — FloatingNoteNode / FloatingCalendarNode / FloatingHorizonsNode / TaskboardNode / ListInsetNode (all thin-wrap `useFloatingWidget`); SortableTaskList (flat or grouped via `partitionByGroup`; cross-group drops mutate the grouped field with replace semantics via `resolveCrossGroupMutation`); shared/DraggableTaskRow, shared/TaskGroup (header swatch via `getGroupColor`); rails/ — RailsFrame (3×3 CSS grid; corner ownership via `rails.corners` written by `DockOverlay` start/end sub-zones), RailContainer + RailEdgeStrip + RailEdgeHandle (drag to resize, click to collapse, persisted to `settings.canvasRails.collapsed`/`widths`/`heights`), Slot ({tabs[], activeTabId, …}), SlotHeader / TabStrip (multi-tab chrome with `↗` pop-out, right-click for kind change), per-kind SlotContent (Lens / Calendar / Notes / Taskboard / Horizons / Stats), DraggableSlot, SlotDivider (rAF-throttled per-slot weight via `setSlotFlexBatch`), DockOverlay (start/center/end drop sub-zones; corners claimed on start/end drop), CollapsedSlotStub (each stub is a drop zone; aside-level catch-all uses `nearestStubSlotId` for "nearest" hit-test + visual highlight); rail-dnd — bidirectional float ↔ rail dock. Float→rail rides React Flow + window pointer + `resolveFloatDockTarget` (`data-rails-drop-id` hit-test); rail tab pill→canvas rides `useRailsDragMonitor`'s `rails:canvas` zone via `pointerToFlowPosition` + `popTabAtPosition`. `<ReactFlow autoPanOnNodeDrag>` is gated on `floatDrag === null` to keep floats from auto-panning the canvas mid-dock. Stats widgets: `status` / `scoreboard` / `snoozeGraveyard` reading `selectStatusBreakdown` / `selectDisciplineMetrics` / `selectMostDeferred` (the latter two from the `todoEvents` history table)
│   ├── taskboard/         → TaskboardPanel (renders the singleton `Taskboard`; entries ride the surrounding canvas DndContext; drop outside any target → remove), TaskboardNode (canvas float keyed by `floatingId`)
│   ├── dashboard/         → HorizonRibbon (sortable rows + stacked bars from `classifyByDateSource`; right-click row → CanvasContextMenu)
│   ├── overlays/          → CommandPalette, ReassignDialog, BulkConfirmDialog, UndoSnackbar, FilterSheet (mobile), ListDefinitionPickerPopup, QuickAddBar (top-anchored capture surface; live `parseInput` → `resolveInput` chips; `Tab`/`Details` hands off to `TaskEditPopup` create-mode via `quickAddDraft`; submit calls `useTodoStore.add` + `applyNlpMetadata`; blank-canvas adds use `ensureDefaultProject` to auto-create an Inbox project)
│   ├── settings/          → PeopleEditor, OrgEditor, StatusEditor, TagEditor, ThemeColorsEditor (Light/Dark working-set toggle), KeyboardShortcutsModal, DashboardListsEditor (modal-on-modal: list rows in outer modal, per-row edit form in `ListEditorDialog`; dirty guard via `showBulkConfirmation`)
│   └── shared/            → Chip, SectionHeader, ChipSelector, ColorInput, StatusIcon, AvatarStack, TaskPillBar (people→dates→status pill, no tag prop; consumer pre-resolves entities), SortGroupToolbar (generic comfortable/compact densities; consumed by ListView + ProjectNode + ListEditorBody), WidgetHeader (unified slot/widget chrome; `floating` prop swaps to hover-revealed buttons), WidgetKindMenu (kind radios + lens-only "Edit list" / "Change list…"), ListEditorDialog + ListEditorBody, StandaloneListEditor (mounted on CanvasPage; subscribes to `ui-store.listEditorDialogId`), notes/NotesEditor + NotesBody + NotesToolbar (CodeMirror 6, HTML→Markdown paste, Alt-T-to-task)
├── stores/                → Zustand. canvas, canvas-rails, todo, project, person, org, status, tag, list-inset, floating-{note,calendar,taskboard,horizons,status,scoreboard,snoozeGraveyard}, todo-event, taskboard (singleton board), ui (incl. `floatDrag`, `quickAddDraft`, `listEditorDialogId`), filter, undo, list-definition (incl. `favorited`, optional `runtimeFilter`/`maxTasks`), settings (`themeMode`, `colors: {dark, light}`, `canvasRails`, `horizonSlots`, `selectedHorizonDefId`, `defaultProjectGroupBy`), file-storage, note (single global outside-tasks note)
├── data/                  → Dexie repositories + migrations + restore + audit. Notable: `todoEvents` (append-only history feeding stats); per-kind floating placement tables; v46 flattens `ListDefinition.sort`/`.grouping` to flat `TodoSortBy`/`TodoGroupBy` literals (legacy union still accepted by `import-validation` + normalised by `pickListDefinition`)
├── models/                → TypeScript interfaces. `todo-sort-group.ts` defines unified `TodoSortBy` / `TodoGroupBy` + per-surface subset constants; `ListSortBy` / `ListGroupBy` / `ProjectGroupBy` are aliases over the unified union
├── hooks/                 → `use-popover-anchor.ts` is the shared anchor + flip + clamp + scroll/resize/Esc/outside-click hook used by every popover; useFloatingWidget (header + dock/close/kind handlers + ResizeHandle); useThrottledResize (rAF); use-keyboard-shortcuts (skips elements with `data-shortcut-scope="none"`)
├── utils/                 → sort-order (`bySortOrder`), dates, effective-date, filter (`matchTodoText`/`TextMatchField`), platform (`isMacLike`/`formatShortcut`), debug-flags (`?debug-dnd=1` / `?debug-focus=1`), slot-kind (`KIND_ICON`/`KIND_LABEL`), float-kind-switch (`convertFloatingKind`), task-grouping (`partitionByGroup`/`getGroupColor`/`GROUP_OPTIONS`), cross-group-drag (`blockContextId`/`parseBlockContextId`/`resolveCrossGroupMutation`), rail-dnd (`resolveFloatDockTarget`/`nearestStubSlotId`/tab reducers), task-dnd/ (unified DnD vocabulary: `kinds.ts`, `ids.ts` per-surface drag ids, `collision.ts` declarative rule table, `dispatch.ts` single dispatcher for taskboard + calendar drops, `search-drop.ts`)
└── services/              → NLP (parser + resolver; `#tag` lookup-or-create, case-insensitive), command registry, file storage, undoable, backup scheduler, ensure-default-project (Inbox auto-create), dashboard-lists interpreter (`buildDashboardLists` with multi-value `runtimeFilterValues`), horizons (`classifyByDateSource`), stats/ (`status-breakdown`, `discipline`, `snooze`, `buckets`), notes-export (`mdToHtml`/`htmlToMarkdown`/`copyNotesRich`), task-copy (`copyTasksRich`/`buildTasksHtml`/`buildTasksPlain`)
```

## Data Flow

1. **Startup**: Dexie opens IndexedDB → `useCanvasStore.ensureDefault()` → `fileStorageService.initialize()` reconnects file handle. Settings loads theme + applies `data-theme` to `<html>`; user color overrides applied as inline styles. Expired completed tasks purged if `completedRetentionDays` set. `backupScheduler.start()` begins auto-snapshots.
2. **Normal use**: UI → Zustand stores → repository methods → Dexie. If file storage connected, Dexie hooks debounce-save to JSON file. Cross-cutting capture rides `QuickAddBar` (`Ctrl+Space` / FAB / `command-registry.openQuickAdd`); the `TaskEditPopup` create modal is reachable via QuickAdd's Details handoff and the canvas right-click menu.
3. **Canvas**: Single canvas only; `ensureDefault()` creates/selects at startup.
4. **View switching**: Sidebar → React Router. The horizon ribbon is a canvas `horizons` widget — drag to any rail or pop out as a float. Ribbon is a user-editable ordered list of N rows seeded with five default lists (This week / Next week / Rest of month / Later / Someday).
5. **Person assignment**: Many-to-many via `todoPeople` join; `usePersonStore` caches `assignedPeopleMap`.
6. **Person-org membership**: Many-to-many via `personOrgs` join; a person can belong to multiple orgs.

## Testing

Two layers, picked by what's being verified:

- **vitest (`npm test`)** — unit + JSDOM under `src/test/**`. Authoritative for pure logic, models, repositories, store reducers, services, utilities, and rendering / event-handler dispatch that doesn't depend on real layout, focus, or async DOM timing. `e2e/**` is excluded from the vitest sweep.
- **Playwright (`npm run test:e2e`)** — Chromium-only real-browser flows under `e2e/**`. Fixed port 5173, `reuseExistingServer`, `trace: 'retain-on-failure'`. Runs against `npm run dev`. Fixtures + CDP-trusted gestures live in `e2e/fixtures/seed.ts`. `/list` specs must use `page.goto('/#/list')` (HashRouter). CI is out of scope.

**JSDOM is not authoritative** for: focus handoffs, `ResizeObserver`-driven layout, drag-and-drop hit-testing (rails / floats / taskboard / `data-rails-drop-id` / `data-tbp-entry` geometry), popover anchor placement and viewport flips, async-store-driven re-render timing, and canvas positional behavior. Those categories require a Playwright spec — JSDOM passing is not enough signal.

**Diagnosis vs. regression.** The Chrome DevTools MCP server (`mcp__chrome-devtools__*`) is a *spike* tool — drive an interaction live in real Chromium, capture state, then codify the regression in Playwright. See CLAUDE.md "Tools — Chrome DevTools MCP".

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
