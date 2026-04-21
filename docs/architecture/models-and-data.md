# Models & Data Layer

Detail reference for `src/models/` (TypeScript interfaces) and `src/data/` (Dexie persistence). Load when touching schema, repositories, migrations, import/export, or model shapes.

## Models

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| Canvas | models/canvas.ts | Named spatial workspace |
| Project | models/project.ts | Positioned group of tasks on a canvas (optional color) |
| TodoItem | models/todo-item.ts | Core todo entry (id optional, pre-insert); optional `progress`, `statusId`, `scheduledDate` (ScheduledValue), `dueDate` (deadline), `recurrenceRule` |
| PersistedTodoItem | models/todo-item.ts | TodoItem with guaranteed id (post-insert) |
| ScheduledValue | models/scheduled-value.ts | Discriminated union for `scheduledDate`: `{kind:'date', value:Date}` or `{kind:'fuzzy', token: FuzzyToken}` where FuzzyToken ∈ today/tomorrow/this-week/next-week/this-month/next-month |
| RecurrenceRule | models/recurrence.ts | Recurrence pattern: type (daily/weekly/biweekly/monthly/quarterly/yearly), optional originalDayOfMonth to prevent drift |
| ListDefinition | models/list-definition.ts | Dashboard list definition: name, sortOrder, `pinnedToDashboard`, membership (today/upcoming/deadlines/someday/custom), sort, grouping. `today`/`upcoming` accept optional `warningWindowDays`; `custom` carries a `TodoPredicate` |
| TodoPredicate | models/filter-predicate.ts | Serializable predicate DSL mirroring live filter fields (number arrays + ISO strings — no Sets, no Dates). Stored inside `ListMembership.custom` and `SavedViewFilters`; runtime converts to `FilterCriteria` via `predicateToCriteria` at evaluation time |
| Person | models/person.ts | Assignable person with name + initials. Display color is derived at render time from the person's first assigned org via `utils/person-color.resolvePersonColor` (the legacy `color` field was dropped in Dexie v31) |
| PersistedPerson | models/person.ts | Person with guaranteed id (post-insert) |
| Org | models/org.ts | Organization/group for people (name, optional initials, optional color) |
| PersonOrg | models/person-org.ts | Many-to-many join: person ↔ org |
| TodoPerson | models/todo-person.ts | Many-to-many join: todo ↔ person |
| TodoOrg | models/todo-org.ts | Many-to-many join: todo ↔ org (direct org assignment) |
| Status | models/status.ts | User-defined workflow state: name, color, sortOrder, `icon` (key from StatusIcon registry, default 'circle'), optional `hideByDefault` (excluded from default filter when true) |
| PersistedStatus | models/status.ts | Status with guaranteed id (post-insert) |
| ListInset | models/list-inset.ts | Canvas widget referencing a `ListDefinition` (`listDefinitionId` FK); delegates to the dashboard-lists interpreter |
| Note | models/note.ts | The single global markdown note: `{content, createdAt, modifiedAt}`. One row backs the dashboard tile, the rail Notes slot, and every canvas `FloatingNote` placement |
| FloatingNote | models/floating-note.ts | Canvas-pinned placement that renders the single global note. `{canvasId, x, y, width, height}`. Content lives in `Note`; this row only tracks placement. Dexie secondary index on `canvasId` |
| FloatingCalendar | models/floating-calendar.ts | Canvas-pinned placement that renders the shared two-week calendar strip. `{canvasId, x, y, width, height}`. Dexie secondary index on `canvasId` |
| FloatingTaskboard | models/floating-taskboard.ts | Canvas-pinned placement that references a `Taskboard` by id. `{canvasId, taskboardId, x, y, width, height, collapsed?}`. Dexie secondary indexes on `canvasId` + `taskboardId` (so removing a board cascades the floats) |
| Taskboard | models/taskboard.ts | Reusable queue of tasks: `{name, entries: TaskboardEntry[], createdAt, updatedAt}`. Entries live inline (no join table) — every entry-level mutation rewrites the row. Referenced by dashboard cards, rail-slot tabs (`Tab.taskboardId`), and `FloatingTaskboard` widgets, so the same board renders live across multiple surfaces |
| TaskboardEntry | models/taskboard-entry.ts | Ordered slot within a `Taskboard`: `{todoId, sortOrder}`. Stored inline on the Taskboard row — no row id; `todoId + sortOrder` uniquely locate an entry within a given board |
| Slot, Tab, TabType, SlotKind, Rail, RailsState, Corner, CornerOwner | models/canvas-rails.ts | Canvas-side-rail shapes. `SlotKind ∈ {'lens','notes','calendar','taskboard'}` (canonical `SLOT_KINDS`); `TabType` is an alias used by per-tab content type. `Slot` is `{ id, flex?, tabs: Tab[], activeTabId, orientation?, weekOffset? }` — every slot carries ≥1 `Tab { id, type: TabType, listDefinitionId?, taskboardId? }`; single-tab slots render identically to pre-rail-tabs slots, multi-tab slots render a `TabStrip`. `getActiveTab(slot)` resolves the active tab (falls back to `tabs[0]` if `activeTabId` is stale). `RailsState` has per-side `Rail | null`, optional `widths`/`heights` bags (persisted even when the rail is null), and optional `corners: Partial<Record<Corner, CornerOwner>>` where `Corner ∈ {nw,ne,sw,se}` and `CornerOwner ∈ {'h','v'}` (`'h'` lets the top/bottom rail extend into the corner cell; default/absent `'v'` keeps the legacy vertical-owns layout). `resolveCorner(rails, corner)` falls back to the orthogonal side when the stored owner's rail is absent, so the layout is always well-defined; `computeRailGridArea(rails, side)` derives each rail's grid-area in the `RailsFrame` 3×3 grid from the resolved corners. `cornerForSideClaim(side, 'start'\|'end')` maps an empty-side drop-strip sub-zone to the corner the new rail would claim. Helpers: `clampRailSize` ([200, 600]), `defaultRailSize`, `railSize`, `railOrientationForSide`, `EMPTY_RAILS`, `CORNERS` (readonly 4-tuple), `serializeRailsState` / `parseRailsState` (accepts both the new `{ tabs, activeTabId }` shape **and** the legacy `{ kind, listDefinitionId?, taskboardId? }` slot shape — legacy is wrapped into a single-tab slot; round-trips `corners`, dropping unknown keys and non-`'h'|'v'` values; returns null on shape failure; used by `settings-store` hydration + import validator) |
| Backup | models/backup.ts | Auto-snapshot record: trigger type, serialized data, size |
| SavedView | models/saved-view.ts | Named saved list view: sortBy + serializable filter snapshot (including dateRangeStart/End). Optional `maxTasks` (1..10000) + `limitMode` (`'hard' \| 'scroll'`) cap visible task count |
| AppView | models/app-view.ts | Enum: Canvas, Dashboard, List, Calendar, Settings |
| ListSortBy | models/app-view.ts | Type: date, scheduled, deadline, people, org, project, status. Used by list-definition `sort.by` |
| ListGroupBy | models/app-view.ts | Type: `'none'` + every `ListSortBy` value. Drives `ListView` section-builder choice; `'none'` renders a flat list (header hidden) |
| ListItemSortBy | models/app-view.ts | Type: `'manual' \| 'date' \| 'scheduled' \| 'deadline'`. Sort applied within each group (or across the whole list when groupBy='none'). Round-trips into saved list-definitions via `encodeGroupSort` / `resolveGroupBy` / `resolveItemSortBy` |
| DateField | models/app-view.ts | Type: date, scheduled, deadline, created, modified — used by filter store and saved views. `'date'` filters on `effectiveDate`; `'scheduled'` on resolved `scheduledDate`; `'deadline'` on `dueDate` |

## Data Layer

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| Todo2Database | data/database.ts | Dexie DB class with schema versioning |
| ALL_DATA_TABLES | data/database.ts | Canonical list of all data tables (excludes backups); used by restore and file-storage hooks |
| runV20Migration | data/database.ts | v20 upgrade: seeds Assigned/Follow-up statuses, backfills `statusId` from `isStarred`/`isAssigned`, deletes retired `starred` list insets |
| ensureSeededStatuses | data/database.ts | Idempotent seeder for Assigned/Follow-up status rows; settings-pointer-as-truth (`seededAssignedStatusId`/`seededFollowupStatusId`); used by v20 migration and restore |
| runV21Migration | data/database.ts | v21 upgrade: folds `priority`/`dueDate`/`isHardDeadline`/`recurrenceRule` into `scheduledDate`+`dueDate` per Q2 precedence, deletes priority list insets, seeds four `listDefinitions` rows |
| translateTodoV20ToV21 | data/database.ts | Per-todo precedence helper (in-place mutation, returns outcome); strips `priority`/`isHardDeadline`; shared by `runV21Migration` and `restoreFromImportData`; idempotent on post-v21 rows |
| ensureSeededListDefinitions | data/database.ts | Seeder for Today/Upcoming/Deadlines/Someday list-definition rows. Semantics: insert iff table is empty; seeded rows are normal rows; deletion is permanent |
| runV22Migration | data/database.ts | v22 upgrade: backfills `pinnedToDashboard=true` on every row; strips retired `seededKey` |
| runV23Migration | data/database.ts | v23 upgrade: walks every `ListInset`, synthesizes an unpinned `ListDefinition` (via `buildListDefFromLegacyInset`), rewrites the inset to reference it by id, strips `preset`/`attributeFilter`/`name`. Corrupt rows dropped |
| buildListDefFromLegacyInset | data/database.ts | Produces a `ListDefinition` shape from a pre-v23 inset row (preset → custom predicate with `dateRangeEnd=today+7d`; attributeFilter → personIds/orgIds predicate; legacy `tag` attribute is rewritten as a `searchText: '#tagname'` predicate to match v29-baked title suffixes). Shared by v23 migration and file-import restore |
| createRepository | data/create-repository.ts | Factory for shared CRUD operations (getAll, getById, insert, update, remove); extended per-repo |
| createJoinOps | data/join-helpers.ts | Factory for join table assign/unassign with dedup check |
| buildAssignmentMap | data/join-helpers.ts | Generic join table → entity map builder (Map\<linkId, Entity[]\>) |
| todoRepository | data/todo-repository.ts | Full CRUD + queries for TodoItem, bulkUpdate (batched transaction), bulkDelete (atomic multi-delete) |
| projectRepository | data/project-repository.ts | CRUD + position updates (single + bulk) for Project |
| canvasRepository | data/canvas-repository.ts | CRUD for Canvas (cascading delete: todos, projects, todoPeople, todoOrgs, notes, listInsets) |
| personRepository | data/person-repository.ts | CRUD for Person + todoPeople join queries |
| orgRepository | data/org-repository.ts | CRUD for Org (cascading delete clears personOrgs + todoOrgs), todo-org assignment queries, person-org many-to-many (getOrgsForPerson, getPersonOrgMap, setPersonOrgs) |
| listInsetRepository | data/list-inset-repository.ts | CRUD for ListInset (position, resize) |
| noteRepository | data/note-repository.ts | CRUD for Note. `getGlobal()` filters to canvasId==null (dashboard/rail); `getByCanvas(id)` scopes to a canvas; `updatePosition(id, x, y)` for drag persistence; `deleteByCanvas(id)` for canvas cascade |
| translateStickyToNote | data/database.ts | Pure function: legacy sticky row → Note row (title prepended as H1; placement + color carried over). Shared by v26 migration and legacy-import restore |
| runV26Migration | data/database.ts | v26 upgrade: move every `stickyNotes` row into the `notes` table via `translateStickyToNote`, then drop the `stickyNotes` store |
| runV29Migration / appendTagNamesToTitle / buildTagNamesByTodo | data/database.ts | v29 upgrade: bake every assigned tag's name into the host todo's title as ` #tagname`, strip `tagIds` from any persisted custom predicate / saved-view filters, drop the `tags` + `todoTags` tables. Pure helpers reused by `restoreFromImportData` for legacy JSON imports |
| runV31Migration | data/database.ts | v31 upgrade: strip the legacy `color` key from every `people` row. Person color is now derived at render time from the person's first assigned org (`resolvePersonColor`) |
| taskboardRepository | data/taskboard-repository.ts | CRUD for `Taskboard`: `getAll`, `getById`, `create(name)`, `rename`, `remove`, `writeEntries(id, entries)` (replace the inline entries array + bump `updatedAt`). Entry-level mutations are built in the store from `writeEntries` |
| floatingNoteRepository | data/floating-note-repository.ts | CRUD for `FloatingNote` (inherits `createRepository` base) + `getByCanvas`, `updatePosition`, `deleteByCanvas` (canvas cascade) |
| floatingCalendarRepository | data/floating-calendar-repository.ts | CRUD for `FloatingCalendar` (inherits base) + `getByCanvas`, `updatePosition`, `deleteByCanvas` |
| floatingTaskboardRepository | data/floating-taskboard-repository.ts | CRUD for `FloatingTaskboard` (inherits base) + `getByCanvas`, `updatePosition`, `deleteByCanvas` (canvas cascade), `deleteByTaskboard` (invoked when a `Taskboard` is removed so placement rows don't dangle) |
| statusRepository | data/status-repository.ts | CRUD for Status (transactional cascade delete clears statusId from todos) |
| settingsRepository | data/settings-repository.ts | CRUD for settings key-value pairs (getAll, put, delete, bulkDelete) |
| savedViewRepository | data/saved-view-repository.ts | CRUD for SavedView (getAll, add, update, remove) |
| listDefinitionRepository | data/list-definition-repository.ts | CRUD for ListDefinition (getAll ordered by sortOrder, reorder) |
| backupRepository | data/backup-repository.ts | Snapshot CRUD: createSnapshot, listSnapshots (lightweight), restoreSnapshot (validates + imports), pruneSnapshots |
| auditData | data/audit.ts | Scan all tables for orphaned join rows, dangling foreign keys, and unplaced canvas tasks (canvasId set but no projectId); returns AuditReport |
| cleanupIssues | data/audit.ts | Atomic cleanup of all audit issues (delete orphans, clear dangling FKs) in single transaction |
| validateImportData | data/import-validation.ts | Schema validation for JSON import (all models, color sanitization, size limits, SavedView filter validation, setting key allowlist) |
| isValidCssColor | utils/css.ts | Validates hex color strings (#rgb or #rrggbb only). Re-exported by `data/import-validation.ts` for legacy import paths |
| restoreFromImportData | data/restore.ts | Clear-all-tables + bulk-add from ImportData + auto-seed statuses + auto-seed listDefinitions + `isStarred`/`isAssigned` translation + `translateTodoV20ToV21` per row + priority list-inset deletion; used by backup restore, file import, and settings import |
| parseAndRestore | data/restore.ts | Parse JSON string, validate, and restore all data tables; used by backup restore |
