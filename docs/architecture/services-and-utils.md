# Services, Hooks & Utils

Detail reference for `src/services/` (non-UI logic), `src/hooks/` (custom React hooks), and `src/utils/` (pure utilities). Load when touching NLP, recurrence, file storage, dashboard list interpretation, drag-and-drop logic, keyboard shortcuts, or date/hierarchy helpers.

## Services

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| buildDashboardLists, interpretMembership, interpretSort, interpretGrouping, WARNING_WINDOW_DAYS | services/dashboard-lists.ts | Pure interpreter over `ListDefinition`. Membership kinds: today (≤ today OR deadline within `warningWindowDays`, default WARNING_WINDOW_DAYS=3), upcoming (has date, not in today), deadlines (has `dueDate`, intentional overlap with today), someday (no dates), custom (injected `ctx.evalPredicate` consumes a `TodoPredicate`). Sort kinds: effective-date-asc (expired-fuzzy first), deadline-asc, sort-order, sortBy (chronological `by` values sort properly; categorical fall back to sortOrder). Grouping kinds: none, relative-effective, relative-deadline, by-sortBy. Applies `showCompleted` + `showHiddenStatuses` gates |
| buildExportData | services/export-import.ts | Reads all DB tables (incl. `listDefinitions`) in parallel; shared by file-storage, settings export, and backup snapshots |
| buildMarkdownExport | services/export-import.ts | Builds markdown representation of all tasks grouped by project; shows `[status.name]` for meaningful statuses (icon or hideByDefault); uses buildExportData |
| fileStorageService | services/file-storage.ts | File System Access API sync (file ↔ IndexedDB); uses onAfterImport callback for store refresh; `onConfirmMigration` callback pauses import of legacy-format files pending user confirmation |
| backupScheduler | services/backup-scheduler.ts | Auto-snapshot every 24h, pre-destructive snapshots, prune to 10 max; started in App.tsx |
| checkMigrationNeeded | services/migration-check.ts | Checks IndexedDB version via `indexedDB.databases()` before Dexie opens; converts IDB version (Dexie multiplies by 10) to Dexie version for comparison; returns `MigrationInfo` if data-modifying upgrade is pending |
| detectLegacyFormat | services/migration-check.ts | Inspects raw parsed JSON for legacy fields (`isStarred`/`isAssigned` booleans, `starred` list insets, `priority`/`isHardDeadline` todo fields, `high-priority`/priority-`attributeFilter` list insets); returns `LegacyImportInfo` with per-category counts and human-readable descriptions |
| exportCurrentDatabase | services/migration-check.ts | Reads all tables from raw IndexedDB at a specified version (without triggering Dexie upgrade); returns JSON string |
| undoable | services/undoable.ts | Helper to register an action as undoable; skips when undo store is mid-undo/redo |
| task-placement | services/task-placement.ts | Pure functions for task ordering: computeInsertionSort, placeTaskAt, placeMultipleAt, indentTasks, outdentTasks, moveTasksInDirection, findOrphans, normalizeSortOrders, shouldNormalize |
| pasteTasksAt | services/clipboard.ts | Paste cut tasks at a target position using placeMultipleAt + applyMutations; clears clipboard after paste |
| drop-resolver | services/drop-resolver.ts | Pure drop target resolution: resolveDropTarget (DropResolution), resolveDropPreview (preview indicators) |
| parseInput | services/natural-language-parser.ts | Parses raw text for NLP tokens: `@person` or `@"First Last"`, `#tag`, `/project`, date keywords (→ `scheduledDate`), deadline syntax `by <date>` / `!<day>` (→ `dueDate`, fuzzy windows resolve to end-of-window), recurrence (`every week`, `every quarter`, `repeat daily`); returns ParsedInput with cleaned title, persons[], tags[], projects[], scheduledDate, dueDate, recurrence |
| makeRecurrenceRule | services/recurrence.ts | Build a RecurrenceRule, capturing originalDayOfMonth for monthly/quarterly/yearly |
| computeNextDueDate | services/recurrence.ts | Advances a due date by one recurrence interval, skipping past dates |
| recurrenceAnchor, advanceRecurring | services/recurrence.ts | `recurrenceAnchor(todo)` picks `dueDate` first, falls back to a precise `scheduledDate` (returns null for fuzzy-only). `advanceRecurring(todo)` computes the next-occurrence field update — either `{dueDate}` or `{scheduledDate: {kind:'date', value}}` — used by `todo-store.toggleComplete` / `bulkSetCompleted` and CalendarView virtual instances |
| generateRecurringInstances | services/recurrence.ts | Generates all recurring dates within a date range for calendar display |
| resolveInput | services/nlp-resolver.ts | Matches parsed person/tag/project/org names against known entities (case-insensitive exact/prefix/initials/first-name); person-first for @tokens, unmatched fall through to org matching; returns personIds[], tagIds[], orgIds[], projectId, unmatched names |
| parseTaskInput | services/nlp-task-creator.ts | Combines parseInput + resolveInput; applyNlpMetadata assigns parsed metadata (people, tags, orgs) after task creation |

## Hooks

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| useIsMobile | hooks/use-is-mobile.ts | Reactive mobile detection hook (640px breakpoint via matchMedia + useSyncExternalStore) |
| useResolvedTheme | hooks/use-resolved-theme.ts | Reactive resolved theme hook ('light' \| 'dark'); combines Zustand themeMode with OS prefers-color-scheme via useSyncExternalStore |
| useKeyboardShortcuts | hooks/use-keyboard-shortcuts.ts | Global keyboard shortcut handler: undo/redo, task navigation (Arrow/Home/End), task actions (Enter/Space/Delete/Insert), movement (Ctrl+Arrow/Tab), chord navigation (G then C/L/A/S), filter focus (F), select all (Ctrl+A), keyboard shortcuts modal (?) |
| useBulkActions | hooks/use-bulk-actions.ts | Hook wrapping mutations with multi-select awareness (toggleComplete, remove, setStatus, setScheduled, setDeadline, setProject, quickAssign/Unassign person/tag/org); called directly by TaskRow |
| useTaskEditCallbacks | hooks/use-task-edit-callbacks.ts | Shared TaskEditPopup wiring: onCreate (NLP + metadata), editProps (assignments, actions), entityCreators — used by CanvasPage, DashboardView, ListView, CalendarView |
| useCanvasDnD | hooks/use-canvas-dnd.ts | DnD state, edge panning, drag handlers (including handleDragCancel), drop execution; shared resetDragState cleans up on Escape/focus-loss |
| useInlineEdit | hooks/use-inline-edit.ts | Inline title editing: state, focus, save/cancel, 250ms click-to-edit timer |
| useClickOutside | hooks/use-click-outside.ts | Click-outside detection hook for closing dropdowns/menus |
| useNlpAutocomplete | hooks/use-nlp-autocomplete.ts | Hook for `@`/`#`/`/` autocomplete in input fields: tracks trigger position, filters people/orgs/tags/projects, handles arrow/Tab/Enter/Escape navigation |

## Utils

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| resolveFuzzy, resolveScheduled, effectiveDate, isScheduledExpired, isScheduledPast, isDeadlinePast, scheduledLabel, scheduledValuesEqual, daysUntil, dateIntensity, setConfiguredWeekStart, getConfiguredWeekStart | utils/effective-date.ts | Unified scheduling helpers: resolve `ScheduledValue` fuzzy tokens to concrete end-of-window dates, compute `min(scheduled, deadline)`, label chips, structural equality for ScheduledValue. `daysUntil(date, today)` returns whole-day diff; `dateIntensity(days)` returns a 0.15..1 proximity factor used by task-row chips to fade toward `--color-text-muted` for distant dates. `isScheduledExpired` is fuzzy-only; `isScheduledPast` broadens to fuzzy-expired OR precise past; `isDeadlinePast` covers `dueDate < today`. Every sort/filter/group consumer reads `effectiveDate`. `resolveFuzzy(token, today, weekStartsOn?)` takes an optional week-start override (0=Sunday, 1=Monday); default is the module-level value managed by `setConfiguredWeekStart`, which settings-store keeps in sync with the persisted `weekStartsOn` setting |
| MS_PER_DAY, startOfDay, startOfToday, isSameDay, formatDate, formatRelativeTime, toDateInputValue | utils/date.ts | Centralized date utilities: day normalization, formatting, constants |
| bySortOrder | utils/hierarchy.ts | Shared sort comparator: sortOrder ascending, with id as a stable tiebreaker so equal-sortOrder tasks render in deterministic order |
| buildChildMap | utils/hierarchy.ts | Builds parentId → sorted children map from flat todo list |
| buildHierarchy | utils/hierarchy.ts | Groups flat todo list into parent/child hierarchy (max 2 levels), sorts roots and children by sortOrder by default or by a custom `rootComparator` when supplied; promotes grandchildren to root ancestor to prevent invisible tasks |
| getFlatVisualOrder | utils/hierarchy.ts | Returns todos in visual display order (parent, children, parent, children, ...) |
| generateInitials | utils/person.ts | Generates 1-3 character uppercase initials from a name |
| toggleItem | utils/filter.ts | Toggle an item in a null-or-Set filter (null = all shown, Set = explicit selection) |
| getFilterDefaults | utils/filter-defaults.ts | Extract task creation defaults (people, tags, orgs, status) from active filter criteria; strips sentinel 0 values |
| supplementWithFilterDefaults | utils/filter-defaults.ts | Supplement resolved NLP output with filter-inferred defaults (person/tag/org); mutates resolved in place (void return) |
