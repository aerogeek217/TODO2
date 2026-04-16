# Architecture Overview

## Tech Stack
- **Frontend**: React 19 + TypeScript, built with Vite
- **State**: Zustand stores (replaces WPF MVVM ViewModels)
- **Database**: Dexie.js over IndexedDB (local-first, replaces SQLite)
- **Spatial Canvas**: React Flow (Phase 3)
- **Drag-and-Drop**: dnd-kit (Phase 4)
- **Routing**: React Router v7

## Dependency Graph

```
main.tsx (entry point)
├── App.tsx                → Router, layout shell
├── styles/tokens.css      → CSS custom properties (design system: dark/light themes via [data-theme], tint scale, shadows, radii, z-index, spacing, typography)
├── views/                 → Route-level pages
│   ├── CanvasPage         → components/canvas/, stores
│   ├── DashboardView      → Top 10 lists (Mine/Follow-up/Assigned/Stale) ranked by importance score + Taskboard (Follow-up/Assigned use seeded statusId matching)
│   ├── ListView           → Unified list with sort-by grouping (Priority/Due/People/Tag/Project), saved views, plain text export
│   ├── CalendarView       → Month/week calendar grid, drag-to-reschedule, overdue highlights, recurring virtual instances
│   └── SettingsPage       → Compact hub: theme toggle (light/dark/system), manage buttons open modals; task defaults (project, status), database location, import/export
├── components/
│   ├── layout/            → Sidebar (vertical icon nav), TopBar (filter bar + search + storage status), FileSyncBanner, BottomTabBar (mobile)
│   ├── task/              → TaskRow, TaskList, TaskEditPopup, MobileTaskRow
│   ├── canvas/            → CanvasView, ProjectNode, ListInsetNode, StickyNoteNode, SortableTaskList, ProjectNavigator, alignment
│   ├── taskboard/         → TaskboardPanel (dashboard card), TaskboardNode (canvas node with sortable reorder)
│   ├── overlays/          → CommandPalette, ReassignDialog, BulkConfirmDialog, UndoSnackbar, FilterSheet (mobile)
│   ├── settings/          → PeopleEditor, OrgEditor, TagEditor, StatusEditor, ThemeColorsEditor, KeyboardShortcutsModal
│   └── shared/            → Chip, SectionHeader, ChipSelector, PriorityMenu, ColorInput, StatusIcon, selection.module.css, dropdown.module.css
├── stores/                → Zustand (canvas, todo, project, person, tag, org, status, list-inset, sticky-note, taskboard, ui, filter, undo, saved-view, settings, file-storage)
├── data/                  → Dexie repositories (todo, project, canvas, person, tag, org, status, settings, saved-view, sticky-note)
├── models/                → TypeScript interfaces
├── hooks/                 → Custom React hooks
├── utils/                 → Shared pure utilities (hierarchy helpers)
└── services/              → Natural language parser, command registry, file storage, undoable, backup scheduler
```

## Key Abstractions

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| Canvas | models/canvas.ts | Named spatial workspace |
| Project | models/project.ts | Positioned group of tasks on a canvas (optional color) |
| TodoItem | models/todo-item.ts | Core todo entry (id optional, pre-insert); includes optional `progress`, `statusId`, `isHardDeadline`, and `recurrenceRule` fields |
| RecurrenceRule | models/recurrence.ts | Recurrence pattern: type (daily/weekly/biweekly/monthly/quarterly/yearly), optional originalDayOfMonth to prevent drift |
| PersistedTodoItem | models/todo-item.ts | TodoItem with guaranteed id (post-insert) |
| Person | models/person.ts | Assignable person with name, initials, color |
| PersistedPerson | models/person.ts | Person with guaranteed id (post-insert) |
| Org | models/org.ts | Organization/group for people (name, optional initials, optional color) |
| PersonOrg | models/person-org.ts | Many-to-many join: person ↔ org |
| Tag | models/tag.ts | Label with name and color |
| TodoTag | models/todo-tag.ts | Many-to-many join: todo ↔ tag |
| TodoPerson | models/todo-person.ts | Many-to-many join: todo ↔ person |
| TodoOrg | models/todo-org.ts | Many-to-many join: todo ↔ org (direct org assignment) |
| Status | models/status.ts | User-defined workflow state with name, color, sortOrder, optional `icon` (key from StatusIcon registry), and optional `hideByDefault` (excluded from default filter when true) |
| PersistedStatus | models/status.ts | Status with guaranteed id (post-insert) |
| Priority | models/priority.ts | Enum: Normal, Medium, High |
| AppView | models/app-view.ts | Enum: Canvas, Dashboard, List, Calendar, Settings |
| ListSortBy | models/app-view.ts | Type: priority, due, people, org, tag, project, status |
| DateField | models/app-view.ts | Type: due, created, modified — used by filter store and saved views |
| OrgFilterMode | stores/filter-store.ts | Type: include-people, direct-only — org filter mode; include-people matches person-org + direct-org, direct-only matches only direct org assignment |
| PersonFilterMode | stores/filter-store.ts | Type: include-orgs, direct-only — person filter mode; include-orgs also matches tasks with directly-assigned orgs the filter person belongs to, direct-only matches only direct person assignment |
| computeFilterPersonOrgIds | stores/filter-store.ts | Helper: precomputes the set of orgs that filter persons belong to, for include-orgs person-filter matching (returns undefined when not applicable) |
| ListInset | models/list-inset.ts | Filtered task list widget on canvas (preset: due-this-week, high-priority; or attributeFilter: priority/person/tag/org) |
| ListInsetAttributeFilter | models/list-inset.ts | Attribute-based filter for list insets: priority, person, tag, or org |
| StickyNote | models/sticky-note.ts | Free-text note widget on canvas (optional title, text, position, dimensions, optional color defaulting to yellow #FFF3B0, timestamps) |
| TaskboardEntry | models/taskboard-entry.ts | Ordered task queue entry (todoId, sortOrder) for next-up work tracking |
| Backup | models/backup.ts | Auto-snapshot record: trigger type, serialized data, size |
| SavedView | models/saved-view.ts | Named saved list view: sortBy + serializable filter snapshot (including dateRangeStart/End) |
| Todo2Database | data/database.ts | Dexie DB class with schema (v16 base + v17/v18/v19 incremental + v20 unified status; v1-v15 collapsed) |
| runV20Migration | data/database.ts | v20 upgrade: seeds Assigned/Follow-up statuses, backfills `statusId` from `isStarred`/`isAssigned`, deletes retired `starred` list insets |
| ensureSeededStatuses | data/database.ts | Idempotent seeder for Assigned/Follow-up status rows; settings-pointer-as-truth (`seededAssignedStatusId`/`seededFollowupStatusId`); used by v20 migration and restore |
| ALL_DATA_TABLES | data/database.ts | Canonical list of all data tables (excludes backups); used by restore, file-storage hooks |
| createRepository | data/create-repository.ts | Factory for shared CRUD operations (getAll, getById, insert, update, remove); extended per-repo |
| createJoinOps | data/join-helpers.ts | Factory for join table assign/unassign with dedup check |
| buildAssignmentMap | data/join-helpers.ts | Generic join table → entity map builder (Map\<linkId, Entity[]\>) |
| todoRepository | data/todo-repository.ts | Full CRUD + queries for TodoItem, bulkUpdate (batched transaction), bulkDelete (atomic multi-delete) |
| projectRepository | data/project-repository.ts | CRUD + position updates (single + bulk) for Project |
| canvasRepository | data/canvas-repository.ts | CRUD for Canvas (cascading delete: todos, projects, todoTags, todoPeople, todoOrgs, stickyNotes, listInsets) |
| personRepository | data/person-repository.ts | CRUD for Person + todoPeople join queries |
| tagRepository | data/tag-repository.ts | CRUD for Tag + todoTags join queries |
| orgRepository | data/org-repository.ts | CRUD for Org (cascading delete clears personOrgs + todoOrgs), todo-org assignment queries, person-org many-to-many (getOrgsForPerson, getPersonOrgMap, setPersonOrgs) |
| listInsetRepository | data/list-inset-repository.ts | CRUD for ListInset (position, resize) |
| stickyNoteRepository | data/sticky-note-repository.ts | CRUD for StickyNote (position, text, color) |
| taskboardRepository | data/taskboard-repository.ts | CRUD for TaskboardEntry (add, addAt with sortOrder, remove by todoId, reorder) |
| statusRepository | data/status-repository.ts | CRUD for Status (transactional cascade delete clears statusId from todos) |
| settingsRepository | data/settings-repository.ts | CRUD for settings key-value pairs (getAll, put, delete, bulkDelete) |
| savedViewRepository | data/saved-view-repository.ts | CRUD for SavedView (getAll, add, update, remove) |
| backupRepository | data/backup-repository.ts | Snapshot CRUD: createSnapshot, listSnapshots (lightweight), restoreSnapshot (validates + imports), pruneSnapshots |
| auditData | data/audit.ts | Scan all tables for orphaned join rows and dangling foreign keys; returns AuditReport with issues and cleanup metadata |
| cleanupIssues | data/audit.ts | Atomic cleanup of all audit issues (delete orphans, clear dangling FKs) in single transaction |
| validateImportData | data/import-validation.ts | Schema validation for JSON import (all models, color sanitization, size limits, SavedView filter validation, setting key allowlist) |
| restoreFromImportData | data/restore.ts | Shared clear-all-tables + bulk-add from ImportData; used by backup restore, file import, and settings import |
| parseAndRestore | data/restore.ts | Parse JSON string, validate, and restore all data tables; used by backup restore |
| createAssignmentActions | stores/assignment-helpers.ts | Factory for assign/unassign/bulk/load actions shared by tag, person, org stores |
| loadWithState | stores/store-helpers.ts | Loading/error state boilerplate for store data fetching |
| mutate | stores/store-helpers.ts | Error handling wrapper for store mutation actions (clears error, catches failures, logs, sets error state) |
| optimistic | stores/store-helpers.ts | Optimistic mutation: applies state immediately, persists async, rolls back on failure; undo registered only after successful persist |
| updateEntityInMap | stores/store-helpers.ts | Refresh entity references in assignment maps when entity is edited |
| captureJoinRows, restoreEntityWithJoins | stores/store-helpers.ts | Capture and restore join table rows for entity delete undo |
| captureAssignments, captureAssignmentsBulk | stores/store-helpers.ts | Capture person/tag/org assignment IDs for todo undo |
| bulkUpdateField | stores/store-helpers.ts | Generic bulk field update with undo for todo store |
| useCanvasStore | stores/canvas-store.ts | Single canvas: ensureDefault (create if needed), selectedCanvasId |
| useTodoStore | stores/todo-store.ts | Todo list, CRUD, filtering, bulk operations (bulkSetCompleted, bulkSetPriority, bulkSetStatus, bulkSetDueDate, bulkSetProject, bulkRemove), applyMutations (batch placement writes), addAt (positioned insertion with sortOrder/parentId), duplicate (copy task with assignments), purgeExpiredCompleted (with backup snapshot) |
| useProjectStore | stores/project-store.ts | Projects for current canvas |
| usePersonStore | stores/person-store.ts | People list, CRUD, todo-person assignments, bulk assign/unassign |
| useOrgStore | stores/org-store.ts | Orgs list, CRUD, assignedOrgsMap, personOrgMap (centralized person↔org membership), todo-org assignments (assign/unassign/bulk with undo) |
| useTagStore | stores/tag-store.ts | Tags list, CRUD, bulk assign/unassign |
| useFilterStore | stores/filter-store.ts | Filter criteria (priorities, personIds, tagIds, orgIds, statusIds as null\|Set; showCompleted boolean, showHiddenStatuses boolean (overrides hideByDefault exclusion), hardDeadlineOnly, searchText, dateField (due/created/modified), dateRangeStart/End, dateRangeIncludeNoDue; personFilterMode (include-orgs/direct-only), orgFilterMode (include-people/direct-only)); `matchesFilter` accepts `statuses[]` for hideByDefault exclusion; displayed in TopBar filter bar |
| useUIStore | stores/ui-store.ts | Active view, selected task(s), multi-selection (selectedTodoIds Set, selectionAnchorId, selectionFocusId, focusedTodoId, rangeSelectTodo, selectAll), edit popup mode, parent collapse, bulk confirmation dialog state, inlineCreateAfterId (Insert hotkey), clipboard (clipboardTodoIds, clipboardSourceProjectId, cutTasks, clearClipboard), filteredListPopup (AttributeFilter: priority/person/tag), pendingCanvasTarget (command palette navigation) |
| useUndoStore | stores/undo-store.ts | Undo/redo stacks (max 50), push/undo/redo/clear, isPerformingUndoRedo guard, beginGroup/endGroup (compound ops), snackbar state with auto-dismiss |
| useSettingsStore | stores/settings-store.ts | Theme mode (light/dark/system), theme color overrides, defaultProjectId, defaultStatusId, quickStatusId (one-click status toggle, defaults to seeded Follow-up), seededAssignedStatusId, seededFollowupStatusId, completedRetentionDays, canvasViewport (single source of truth, debounced persistence); persisted to settings table; only user-customized colors set as inline overrides |
| useListInsetStore | stores/list-inset-store.ts | List inset widgets CRUD, position, addFiltered (attribute-based insets) |
| useStickyNoteStore | stores/sticky-note-store.ts | Sticky notes CRUD, position, title, text, color (default yellow #FFF3B0) |
| useStatusStore | stores/status-store.ts | Status definitions: load, add, update, remove (cascade delete clears todos + default setting, with undo), reorder (drag sort with persisted sortOrder) |
| useTaskboardStore | stores/taskboard-store.ts | Taskboard entries: load, add, addAt (positional insert with collision renormalization), addMultipleAt (batch insert with even distribution), remove, clear, has, reorder with undo support |
| useSavedViewStore | stores/saved-view-store.ts | Saved list views CRUD: save, update (overwrite filters/sortBy), rename, remove, reorder (drag sort with persisted sortOrder), apply (restores filters + grouping) |
| TaskEditPopup | components/task/TaskEditPopup.tsx | Centered modal for editing/creating tasks; project selector in create/edit mode (replaced TaskDetailPanel + QuickAddPopup) |
| ChipSelector | components/shared/ChipSelector.tsx | Reusable autocomplete dropdown for assigning people/tags; search input, filtered list, create-new option |
| PriorityMenu | components/shared/PriorityMenu.tsx | Shared priority picker dropdown (High/Medium/Normal with colored dots); also exports getPriorityColor and getPriorityLabel helpers |
| ColorInput | components/shared/ColorInput.tsx | Shared color picker: native swatch + editable hex text input with validation, 3-digit expansion, auto-# prefix, blur revert |
| ProjectPicker | components/shared/ProjectPicker.tsx | Shared project search + list UI (with "No project" option); self-contained search state |
| ProjectPickerPopup | components/overlays/ProjectPickerPopup.tsx | Portal-rendered positioned popup wrapping `ProjectPicker`; closes on outside-click / Escape; used by TaskRow right-click "Move to project…" |
| StatusIcon | components/shared/StatusIcon.tsx | Inline SVG icon registry for statuses (13 icons: person, message-bubble, circle, star, stop-sign, exclamation, clock, check, question, flag, eye, bookmark, snooze); returns null for unknown/missing icon (caller renders color dot fallback) |
| ErrorBoundary | components/shared/ErrorBoundary.tsx | Generic React error boundary (class component, documented exception); catches render errors, shows scoped fallback with "Try again" / "Reload"; wired at App level and around Canvas route |
| DEFAULT_ENTITY_COLOR | constants.ts | Default color '#537FE7' for new people, tags, and orgs |
| FileSyncBanner | components/layout/FileSyncBanner.tsx | Dismissible banner suggesting file sync when no file handle saved; dismissal persisted in localStorage |
| DragInsertContext | components/canvas/DragInsertContext.ts | React context for stable per-drag state (activeDragTodoId, dragExpandedProjectId, dragGroupIds); consumed by CanvasView + ProjectNode |
| DragPreviewContext | components/canvas/DragInsertContext.ts | React context for rapidly-changing drag preview (insertTodoId, insertIndentLevel, insertAtEnd, insertProjectId); consumed only by SortableTaskList so CanvasView/ProjectNode don't re-render on every drag-move tick |
| InsertTrigger | components/canvas/InsertTrigger.tsx | Controlled "+" button between tasks for inline task creation; editing state lifted to SortableTaskList for Enter-chaining (new task opens next trigger) |
| MS_PER_DAY, startOfDay, startOfToday, isSameDay, formatDate, formatRelativeTime, toDateInputValue | utils/date.ts | Centralized date utilities: day normalization, formatting, constants |
| TaskEditHeader | components/task/TaskEditHeader.tsx | Title input + NLP autocomplete + close (extracted from TaskEditPopup) |
| TaskEditMetadata | components/task/TaskEditMetadata.tsx | Due date, recurrence, project, people/orgs, tags sections (extracted from TaskEditPopup) |
| TaskEditFooter | components/task/TaskEditFooter.tsx | Edit/create mode footer with timestamps, actions (extracted from TaskEditPopup) |
| bySortOrder | utils/hierarchy.ts | Shared sort comparator: sortOrder ascending, with id as a stable tiebreaker so equal-sortOrder tasks render in deterministic order |
| byHardDeadlineThenDate | views/ListView.tsx | Sort comparator: hard-deadline bucket first (hard tasks before soft), then by user `sortOrder` within bucket (drag-to-reorder persists), then by id. Date is intentionally NOT sorted within a bucket — `buildDueSections` already partitions by date range |
| buildChildMap | utils/hierarchy.ts | Builds parentId → sorted children map from flat todo list |
| buildHierarchy | utils/hierarchy.ts | Groups flat todo list into parent/child hierarchy (max 2 levels), sorts roots and children by sortOrder by default or by a custom `rootComparator` when supplied (used by ListView due-sort and ProjectNode attribute sort); promotes grandchildren to root ancestor to prevent invisible tasks |
| getFlatVisualOrder | utils/hierarchy.ts | Returns todos in visual display order (parent, children, parent, children, ...) |
| findAlignments, findAlignmentsScoped, findResizeSnap | components/canvas/alignment.ts | Snap-to-edge alignment for dragging/resizing nodes (5px threshold, guide lines) |
| computeCascadeShifts, CASCADE_GAP_THRESHOLD | components/canvas/cascade-shift.ts | Auto-shift stacked projects when a neighbor's height changes (40px gap threshold, BFS cascade) |
| useIsMobile | hooks/use-is-mobile.ts | Reactive mobile detection hook (640px breakpoint via matchMedia + useSyncExternalStore) |
| useResolvedTheme | hooks/use-resolved-theme.ts | Reactive resolved theme hook ('light' \| 'dark'); combines Zustand themeMode with OS prefers-color-scheme via useSyncExternalStore |
| useKeyboardShortcuts | hooks/use-keyboard-shortcuts.ts | Global keyboard shortcut handler: undo/redo, task navigation (Arrow/Home/End), task actions (Enter/Space/Delete/Insert), movement (Ctrl+Arrow/Tab), chord navigation (G then C/L/A/S), filter focus (F), select all (Ctrl+A), keyboard shortcuts modal (?) |
| useBulkActions | hooks/use-bulk-actions.ts | Hook wrapping mutations with multi-select awareness; called directly by TaskRow |
| useTaskEditCallbacks | hooks/use-task-edit-callbacks.ts | Shared TaskEditPopup wiring: onCreate (NLP + metadata), editProps (assignments, actions), entityCreators — used by CanvasPage, DashboardView, ListView, CalendarView |
| useCanvasDnD | hooks/use-canvas-dnd.ts | DnD state, edge panning, drag handlers (including handleDragCancel), drop execution; shared resetDragState cleans up on Escape/focus-loss — extracted from CanvasPage |
| useInlineEdit | hooks/use-inline-edit.ts | Inline title editing: state, focus, save/cancel, 250ms click-to-edit timer |
| useClickOutside | hooks/use-click-outside.ts | Click-outside detection hook for closing dropdowns/menus |
| INDENT_PX, TASK_ROW_PADDING_LEFT | constants.ts | Shared UI constants for task indentation |
| BulkConfirmDialog | components/overlays/BulkConfirmDialog.tsx | Confirmation dialog for destructive/relationship bulk actions (delete, complete/uncomplete, parent+children prompts); supports custom messages, labels, and skipIds for two-option dialogs |
| UndoSnackbar | components/overlays/UndoSnackbar.tsx | Bottom-center toast after destructive actions with "Undo" button, auto-dismiss 5s |
| Sidebar | components/layout/Sidebar.tsx | Desktop vertical icon sidebar: Canvas (grid), List (lines), Calendar (calendar) at top, Settings (gear) at bottom; hidden on mobile |
| BottomTabBar | components/layout/BottomTabBar.tsx | Mobile bottom tab navigation (List, Filters, Settings); shows filter active indicator dot |
| FilterSheet | components/overlays/FilterSheet.tsx | Mobile filter bottom sheet: search, priority, date range, toggles, people/orgs/tags/statuses accordion lists; reads/writes useFilterStore |
| MobileTaskRow | components/task/MobileTaskRow.tsx | Mobile-optimized two-line task row: priority + checkbox + title + status icon + chevron (line 1), due/people/tags/org/notes (line 2); 48px min touch targets |
| CanvasContextMenu | components/overlays/CanvasContextMenu.tsx | Reusable right-click context menu (canvas background, project, box) |
| ListInsetNode | components/canvas/ListInsetNode.tsx | Canvas node showing filtered task list (preset: due-this-week, high-priority); draggable TaskRow components (drag to taskboard); filter description subtitle |
| StickyNoteNode | components/canvas/StickyNoteNode.tsx | Canvas note widget with editable title, textarea, per-line task conversion, color picker palette, @/#// autocomplete |
| FilteredListPopup | components/overlays/FilteredListPopup.tsx | On-demand floating list popup triggered by right-clicking priority/person/tag on any TaskRow; reads from stores directly |
| ProjectNavigator | components/canvas/ProjectNavigator.tsx | Collapsible overlay panel listing all projects; click to fitView-navigate; toggled with P key |
| TaskboardPanel | components/taskboard/TaskboardPanel.tsx | Dashboard card for taskboard; sortable drag reorder via dnd-kit; droppable target for drag-to-add from dashboard lists |
| TaskboardNode | components/canvas/TaskboardNode.tsx | Canvas node for taskboard; resizable, closable (clears with confirmation), sortable drag reorder, droppable target for drag-to-add from project lists and list insets; always visible on canvas |
| PlainTextExportPopup | components/overlays/PlainTextExportPopup.tsx | Modal with plain text representation of current list sections; copy-to-clipboard support |
| DashboardView | views/DashboardView.tsx | Top 10 lists view: Mine, Follow-up, Assigned, Stale; unfiltered; 2x2 grid layout; collapsible cards; drag tasks to taskboard via DndContext |
| scoreTask | views/DashboardView.tsx | Importance scoring: hard deadline (+50), overdue (100+days), due proximity (60-days), priority (High+20, Medium+10) |
| buildDashboardLists | views/DashboardView.tsx | Builds 4 dashboard lists from all incomplete todos using scoreTask ranking (Mine = status not hideByDefault, Follow-up/Assigned matched by seeded statusIds, Stale by oldest modifiedAt) |
| buildExportData | services/export-import.ts | Reads all 12 DB tables in parallel; shared by file-storage, settings export, and backup snapshots |
| buildMarkdownExport | services/export-import.ts | Builds markdown representation of all tasks grouped by project; uses buildExportData |
| fileStorageService | services/file-storage.ts | File System Access API sync (file ↔ IndexedDB); uses onAfterImport callback for store refresh |
| backupScheduler | services/backup-scheduler.ts | Auto-snapshot every 24h, pre-destructive snapshots, prune to 10 max; started in App.tsx |
| useFileStorageStore | stores/file-storage-store.ts | File storage connection state and actions; exports refreshAllStores() |
| generateInitials | utils/person.ts | Generates 1-3 character uppercase initials from a name |
| toggleItem | utils/filter.ts | Toggle an item in a null-or-Set filter (null = all shown, Set = explicit selection) |
| getFilterDefaults | utils/filter-defaults.ts | Extract task creation defaults (people, tags, orgs, status, priority) from active filter criteria; strips sentinel 0 values |
| supplementWithFilterDefaults | utils/filter-defaults.ts | Supplement resolved NLP output with filter-inferred defaults (person/tag/org/priority); mutates resolved in place (void return) |
| isValidCssColor | data/import-validation.ts | Validates hex color strings (#rgb or #rrggbb only) |
| undoable | services/undoable.ts | Helper to register an action as undoable; skips when undo store is mid-undo/redo |
| task-placement | services/task-placement.ts | Pure functions for task ordering: computeInsertionSort, placeTaskAt, placeMultipleAt, indentTasks, outdentTasks, moveTasksInDirection, findOrphans, normalizeSortOrders, shouldNormalize |
| pasteTasksAt | services/clipboard.ts | Paste cut tasks at a target position using placeMultipleAt + applyMutations; clears clipboard after paste |
| drop-resolver | services/drop-resolver.ts | Pure drop target resolution: resolveDropTarget (DropResolution), resolveDropPreview (preview indicators) |
| parseInput | services/natural-language-parser.ts | Parses raw text for NLP tokens: `@person` or `@"First Last"`, `#tag`, `/project`, `p1`/`p2`/`p3`, date keywords, recurrence (`every week`, `every quarter`, `repeat daily`); returns ParsedInput with cleaned title, persons[], tags[], projects[], priority, dueDate, recurrence |
| makeRecurrenceRule | services/recurrence.ts | Build a RecurrenceRule, capturing originalDayOfMonth for monthly/quarterly/yearly |
| computeNextDueDate | services/recurrence.ts | Advances a due date by one recurrence interval, skipping past dates |
| generateRecurringInstances | services/recurrence.ts | Generates all recurring dates within a date range for calendar display |
| resolveInput | services/nlp-resolver.ts | Matches parsed person/tag/project/org names against known entities (case-insensitive exact/prefix/initials/first-name); person-first for @tokens, unmatched fall through to org matching; returns personIds[], tagIds[], orgIds[], projectId, unmatched names |
| parseTaskInput | services/nlp-task-creator.ts | Combines parseInput + resolveInput; applyNlpMetadata assigns parsed metadata (people, tags, orgs) after task creation |
| useNlpAutocomplete | hooks/use-nlp-autocomplete.ts | Hook for `@`/`#`/`/` autocomplete in input fields: tracks trigger position, filters people/orgs/tags/projects, handles arrow/Tab/Enter/Escape navigation |
| NlpAutocomplete | components/shared/NlpAutocomplete.tsx | Floating dropdown for autocomplete suggestions; renders people or tags with color dots |

## Data Flow

1. **App startup**: Dexie opens IndexedDB, `useCanvasStore.ensureDefault()` creates default canvas if needed, then `fileStorageService.initialize()` reconnects to a saved file handle (if any) and loads file data into IndexedDB. Settings store loads theme mode and applies `data-theme` attribute to `<html>` (light/dark/system); only user-customized color overrides are applied as inline styles. If `completedRetentionDays` is configured, expired completed tasks are purged. `backupScheduler.start()` begins periodic auto-snapshots.
2. **Normal use**: User manages todos via UI, Zustand stores call repository methods, Dexie persists to IndexedDB. If file storage is connected, Dexie hooks debounce-save all changes to the JSON file on disk
3. **Canvas**: Single canvas only (selector removed); `useCanvasStore.ensureDefault()` creates/selects it at startup
4. **View switching**: Sidebar icon buttons navigate between Canvas, Dashboard, List, Calendar, and Settings views via React Router; Dashboard shows unfiltered Top 10 lists; List view groups all todos by a user-selected sort-by attribute (Priority, Due, People, Tag, Project)
5. **Person assignment**: Many-to-many via `todoPeople` join table; `usePersonStore` maintains an `assignedPeopleMap` cache for efficient lookups
6. **Person-org membership**: Many-to-many via `personOrgs` join table; a person can belong to multiple orgs

## Module Index

| Directory | Contents | Key Files |
|-----------|----------|-----------|
| src/models/ | TypeScript interfaces + enums | todo-item.ts, project.ts, canvas.ts, person.ts, tag.ts, todo-tag.ts, todo-person.ts, priority.ts, app-view.ts |
| src/data/ | Persistence layer (Dexie/IndexedDB) | database.ts, todo-repository.ts, project-repository.ts, canvas-repository.ts, list-inset-repository.ts, person-repository.ts, tag-repository.ts, status-repository.ts, settings-repository.ts, backup-repository.ts, import-validation.ts |
| src/stores/ | Zustand state management | todo-store.ts, canvas-store.ts, project-store.ts, list-inset-store.ts, person-store.ts, tag-store.ts, status-store.ts, ui-store.ts, filter-store.ts, file-storage-store.ts, undo-store.ts |
| src/styles/ | CSS design tokens | tokens.css |
| src/views/ | Route-level page components | CanvasPage.tsx, ListView.tsx, SettingsPage.tsx |
| src/components/ | Reusable UI components | layout/, task/, canvas/, overlays/, settings/, shared/ |
| src/hooks/ | Custom React hooks | use-task-edit-callbacks.ts, use-keyboard-shortcuts.ts, use-bulk-actions.ts, use-canvas-dnd.ts, use-inline-edit.ts, use-click-outside.ts, use-is-mobile.ts, use-nlp-autocomplete.ts |
| src/services/ | Non-UI logic | natural-language-parser.ts, command-registry.ts, file-storage.ts, file-handle-idb.ts, task-placement.ts, drop-resolver.ts, undoable.ts, clipboard.ts, recurrence.ts, export-import.ts, backup-scheduler.ts |
| src/utils/ | Shared pure utilities | hierarchy.ts (bySortOrder, buildChildMap, buildHierarchy, getFlatVisualOrder), date.ts (startOfDay, startOfToday, isSameDay, formatDate, formatRelativeTime, toDateInputValue, MS_PER_DAY) |
| src/test/ | Vitest tests | data/, stores/, services/, hooks/, components/ |

---

**Update this file whenever you add new modules, services, or change the dependency graph.**
