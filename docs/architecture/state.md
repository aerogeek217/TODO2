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
| useNoteStore | stores/note-store.ts | Multi-row notes store. `notes: Map<id, PersistedNote>` mixes the single global note (canvasId == null, backs dashboard tile + rail slot, seeded by `load()`, pointed at by `activeId`) with canvas floating notes (canvasId set; loaded per-canvas via `loadByCanvas`). APIs: `setContent` (debounced save + `flush`), `addFloating(canvasId, x, y, color?)`, `updatePosition`, `updateSize`, `updateColor`, `remove` (canvas notes deregister with undo snackbar; the global note is never removed) |
| useTaskboardStore | stores/taskboard-store.ts | Taskboard entries: load, add, addAt (positional insert with collision renormalization), addMultipleAt (batch insert with even distribution), remove, clear, has, reorder with undo support |
| useSavedViewStore | stores/saved-view-store.ts | Saved list views CRUD: save, update (overwrite filters/sortBy), rename, remove, reorder, apply (restores filters + grouping). Exports `savedFiltersToRuntime` (status + scheduling translation, silent) and `translateSortBy` (`'priority'`/`'due'` → `'date'`) |
| useListDefinitionStore | stores/list-definition-store.ts | Dashboard list definitions: load, add (appends with auto sortOrder), update, rename, setPinned, remove (with undo + snackbar), clone (unique-name copy), reorder. Exports `emptyPredicate()` for new custom lists |
| useUIStore | stores/ui-store.ts | Active view, selected task(s), multi-selection (selectedTodoIds Set, selectionAnchorId, selectionFocusId, focusedTodoId, rangeSelectTodo, selectAll), hoveredTodoId + setHoveredTodoId (cross-surface hover sync — TaskRow + MobileTaskRow read via selector, write on mouseenter/leave, expose `data-hovered-synced`), edit popup mode, parent collapse, bulk confirmation dialog state, inlineCreateAfterId (Insert hotkey), clipboard (clipboardTodoIds, clipboardSourceProjectId, cutTasks, clearClipboard), filteredListPopup (AttributeFilter: person/org), pendingCanvasTarget (command palette navigation), editingListDefId / editingListDefName + startEditingListDef / clearEditingListDef (drives ListView's "Editing preset" banner; set by DashboardListsEditor "Edit in ListView…" deep-link, cleared on Save / Cancel) |
| useUndoStore | stores/undo-store.ts | Undo/redo stacks (max 50), push/undo/redo/clear, isPerformingUndoRedo guard, beginGroup/endGroup (compound ops), snackbar state with auto-dismiss |
| useSettingsStore | stores/settings-store.ts | Theme mode (light/dark/system), theme color overrides (accent/canvasBg/surface/danger/warning/star/scheduled/deadline), defaultProjectId, defaultStatusId, quickStatusId (one-click status toggle, defaults to seeded Follow-up), seededAssignedStatusId, seededFollowupStatusId, completedRetentionDays, weekStartsOn (0=Sunday, 1=Monday — default 1; mirrored into `effective-date` via `setConfiguredWeekStart`), canvasViewport (single source of truth, debounced persistence); only user-customized colors set as inline overrides |
| useFileStorageStore | stores/file-storage-store.ts | File storage connection state and actions; `pendingMigration` / `confirmMigration` / `cancelMigration` for legacy-import confirmation; exports refreshAllStores() |

## Filter Semantics

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| useFilterStore | stores/filter-store.ts | Filter criteria (personIds, orgIds, statusIds as null\|Set; showCompleted, showHiddenStatuses (overrides hideByDefault), searchText, dateField, dateRangeStart/End, dateRangeIncludeNoDate; personFilterMode (include-orgs/direct-only), orgFilterMode (include-people/direct-only)); displayed in TopBar filter bar |
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
