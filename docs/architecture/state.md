# State (Zustand Stores)

Detail reference for `src/stores/`. Load when touching store APIs, filter semantics, undo, selection, or cross-store helpers.

## Stores

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| useCanvasStore | stores/canvas-store.ts | Single canvas: ensureDefault (create if needed), selectedCanvasId |
| useTodoStore | stores/todo-store.ts | Todo list, CRUD, filtering, bulk operations (bulkSetCompleted, bulkSetStatus, bulkSetScheduled, bulkSetDeadline, bulkSetProject, bulkRemove), applyMutations (batch placement writes), addAt (positioned insertion with sortOrder/parentId), duplicate (copy task with assignments), purgeExpiredCompleted (with backup snapshot) |
| useProjectStore | stores/project-store.ts | Projects for current canvas |
| usePersonStore | stores/person-store.ts | People list, CRUD, todo-person assignments, bulk assign/unassign |
| useOrgStore | stores/org-store.ts | Orgs list, CRUD, assignedOrgsMap, personOrgMap (centralized person↔org membership), todo-org assignments (assign/unassign/bulk with undo) |
| useStatusStore | stores/status-store.ts | Status definitions: load, add, update, remove (cascade delete clears todos + default setting, with undo), reorder (drag sort with persisted sortOrder) |
| useListInsetStore | stores/list-inset-store.ts | List inset widgets CRUD; `add(listDefinitionId, canvasId, x, y)` pins an existing `ListDefinition` onto the canvas |
| useNoteStore | stores/note-store.ts | The single global "outside-tasks" note: `content`, debounced `setContent` + `flush`, `load()` seeds the row if missing. Canvas-pinned notes are placement-only and live in `useFloatingNoteStore` |
| useFloatingNoteStore | stores/floating-note-store.ts | Per-canvas placement widgets that render the single global note. `loadByCanvas`, `add(canvasId, x, y)`, `updatePosition`, `updateSize`, `remove` (with undo). Content stays in `useNoteStore`; this store only tracks x/y/w/h |
| useFloatingCalendarStore | stores/floating-calendar-store.ts | Per-canvas placement widgets that render the shared `CalendarStrip`. `loadByCanvas`, `add(canvasId, x, y)`, `updatePosition`, `updateSize`, `updateOrientation(id, 'vertical'\|'horizontal')`, `updateWeekOffset(id, n)` (clamped to ±`WEEK_OFFSET_MAX`), `remove` (with undo). Placement-only — parallels `useFloatingNoteStore`; `orientation`/`weekOffset` default to `'vertical'` / `0` at read time |
| useFloatingTaskboardStore | stores/floating-taskboard-store.ts | Per-canvas placement widgets that render a specific `Taskboard` by id. `loadByCanvas`, `add(canvasId, taskboardId, x, y)`, `updatePosition`, `updateSize`, `setCollapsed`, `remove` (with undo). Entries live on the referenced `Taskboard` row; this store only tracks placement + collapse |
| useCanvasRailsStore | stores/canvas-rails-store.ts | Canvas side-rail layout: `rails: RailsState` (per-side `Rail | null` + widths/heights bags), `hydrated`, `pendingFocusSlotId` (transient focus target after split). Slot ops: `addRail`, `closeSlot`, `updateSlot`, `setSlotKind` (rebuild slot with kind-appropriate seed via `SLOT_KINDS`), `setSlotOrientation(slotId, 'vertical'\|'horizontal')` + `setSlotWeekOffset(slotId, n)` (calendar slots only; wrappers over `updateSlot`), `dropSlotToSide` / `edgeDropSlot` / `splitDropSlot` (delegate to pure `utils/rail-dnd` reducers), `splitSlot(slotId, dir)`, `createAndDockSlot(kind, …)` (docks into first empty rail by priority right→left→top→bottom), `setRailSize`, `setSlotFlexBatch` (atomic per-slot flex writes used by `SlotDivider`). Factory helpers `createLensSlot` / `createSlot(kind, …)` / `createTaskboardSlot`. Persisted through `settings.canvasRails` via `serializeRailsState` / `parseRailsState` (optional `orientation` / `weekOffset` per slot survive round-trip; `weekOffset` clamped to ±`WEEK_OFFSET_MAX` on parse) |
| useTaskboardStore | stores/taskboard-store.ts | Instance-indexed: `boards: Map<number, Taskboard>` + `defaultBoardId`. Board ops: `load`, `ensureDefault` (creates + persists `defaultTaskboardId` setting), `createBoard`, `renameBoard`, `removeBoard`. Entry ops (all scoped by `taskboardId`): `add`, `addAt` (positional insert with 1000-step `sortOrder` renormalization), `addMultipleAt` (batch with even distribution), `removeEntry`, `clear`, `has`, `reorder` (with undo). Entries persist inline on the `Taskboard` row via `writeEntries` |
| useSavedViewStore | stores/saved-view-store.ts | Saved list views CRUD: save, update (overwrite filters/sortBy), rename, remove, reorder, apply (restores filters + grouping). Exports `savedFiltersToRuntime` (status + scheduling translation, silent) and `translateSortBy` (`'priority'`/`'due'` → `'date'`) |
| useListDefinitionStore | stores/list-definition-store.ts | Dashboard list definitions: load, add (appends with auto sortOrder), update, rename, setPinned, remove (with undo + snackbar), clone (unique-name copy), reorder. Exports `emptyPredicate()` for new custom lists |
| useUIStore | stores/ui-store.ts | Active view, selected task(s), multi-selection (selectedTodoIds Set, selectionAnchorId, selectionFocusId, focusedTodoId, rangeSelectTodo, selectAll), hoveredTodoId + setHoveredTodoId (cross-surface hover sync — TaskRow + MobileTaskRow read via selector, write on mouseenter/leave, expose `data-hovered-synced`), edit popup mode, parent collapse, bulk confirmation dialog state, inlineCreateAfterId (Insert hotkey), clipboard (clipboardTodoIds, clipboardSourceProjectId, cutTasks, clearClipboard), filteredListPopup (AttributeFilter: person/org), pendingCanvasTarget (command palette navigation), editingListDefId / editingListDefName + startEditingListDef / clearEditingListDef (drives ListView's "Editing preset" banner; set by DashboardListsEditor "Edit in ListView…" deep-link, cleared on Save / Cancel) |
| useUndoStore | stores/undo-store.ts | Undo/redo stacks (max 50), push/undo/redo/clear, isPerformingUndoRedo guard, beginGroup/endGroup (compound ops), snackbar state with auto-dismiss |
| useSettingsStore | stores/settings-store.ts | Theme mode (light/dark/system), theme color overrides (accent/canvasBg/surface/danger/warning/star/scheduled/deadline), defaultProjectId, defaultStatusId, quickStatusId (one-click status toggle, defaults to seeded Follow-up), seededAssignedStatusId, seededFollowupStatusId, completedRetentionDays, weekStartsOn (0=Sunday, 1=Monday — default 1; mirrored into `effective-date` via `setConfiguredWeekStart`), canvasViewport (single source of truth, debounced persistence); only user-customized colors set as inline overrides |
| useFileStorageStore | stores/file-storage-store.ts | File storage connection state and actions; `pendingMigration` / `confirmMigration` / `cancelMigration` for legacy-import confirmation; exports refreshAllStores() |
| useFileOpsStore | stores/file-ops-store.ts | Data-ops store consumed by SettingsPage: `backups` list + `loadBackups` / `createBackup` / `deleteBackup` / `peekBackupData` / `restoreBackup` (delegates to `backupRepository`); `auditReport` + `runAudit` / `cleanupCurrentAudit` (delegates to `data/audit`); `restoreFromImport` (delegates to `data/restore`). Keeps the view free of direct `data/*` imports (Phase 2 layer-repair) |

## Filter Semantics

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| useFilterStore | stores/filter-store.ts | Filter criteria (personIds, orgIds, projectIds, statusIds as null\|Set; showCompleted, showHiddenStatuses (overrides hideByDefault), searchText, dateField, dateRangeStart/End, dateRangeIncludeNoDate; personFilterMode (include-orgs/direct-only), orgFilterMode (include-people/direct-only)); displayed in TopBar filter bar |
| matchesFilter / applyFilter | stores/filter-store.ts | Top-level evaluators (not store methods). Take `filters: FilterCriteria` explicitly so the dashboard interpreter can synthesize a runtime FilterCriteria from a stored `TodoPredicate`. `statuses[]` drives hideByDefault exclusion; optional `today` anchors fuzzy-scheduled resolution |
| criteriaToPredicate / predicateToCriteria | stores/filter-store.ts | Converters between runtime `FilterCriteria` (Sets + Dates) and serializable `TodoPredicate` (arrays + ISO strings). Crossed at storage/evaluation boundaries (save-view serialize, dashboard-lists custom-membership evaluate) |
| OrgFilterMode | stores/filter-store.ts | Type: include-people, direct-only — include-people matches person-org + direct-org; direct-only matches only direct org assignment |
| PersonFilterMode | stores/filter-store.ts | Type: include-orgs, direct-only — include-orgs also matches tasks with directly-assigned orgs the filter person belongs to |
| computeFilterPersonOrgIds | stores/filter-store.ts | Helper: precomputes the set of orgs that filter persons belong to, for include-orgs person-filter matching (returns undefined when not applicable) |

## Store Helpers

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| createAssignmentActions | stores/assignment-helpers.ts | Factory for assign/unassign/bulk/load actions shared by person + org stores |
| loadWithState | stores/store-helpers.ts | Loading/error state boilerplate for store data fetching |
| mutate | stores/store-helpers.ts | Error handling wrapper for store mutation actions (clears error, catches failures, logs, sets error state) |
| optimistic | stores/store-helpers.ts | Optimistic mutation: applies state immediately, persists async, rolls back on failure; undo registered only after successful persist |
| updateEntityInMap | stores/store-helpers.ts | Refresh entity references in assignment maps when entity is edited |
| captureJoinRows, restoreEntityWithJoins | stores/store-helpers.ts | Capture and restore join table rows for entity delete undo |
| captureAssignments, captureAssignmentsBulk | stores/store-helpers.ts | Capture person/org assignment IDs for todo undo |
| bulkUpdateField | stores/store-helpers.ts | Generic bulk field update with undo for todo store |
| ViewLimit | stores/saved-view-store.ts | Optional `{ maxTasks?, limitMode? }` passed to `saveCurrentView` / `updateView`; persists to `SavedView.maxTasks` / `SavedView.limitMode`. Passing `undefined` explicitly on update clears a previously stored cap |
