# Import and export

Every file the app reads (a Settings import, a backup, the sync file, an append import) goes through the import pipeline before anything is written: `data/import-pipeline.prepareImport` reads its version (and runs any schema upgrade above it), then `data/import-validation.validateImportData` checks it. This file covers what an import refuses, what it repairs and reports, and the audit (`data/audit.auditData`), which holds the rows already stored to the same rules.

Launch and `replaceData` are in [startup-and-data-replaces](startup-and-data-replaces.md). The shape rules themselves (the layout check, the predicate check, each table's row check and fixer, the schema upgrades) are in [models-and-data](../models-and-data.md).

## The import pipeline

Before a file's data is used:

- A file from below the schema floor (`OLDEST_SUPPORTED_DB_VERSION`, v87, the current version), or without a version, is refused: nothing read, nothing written. The message names the older build that still converts it.
- A file whose layouts hold far more parts than the app keeps is refused too, with a message, before anything else reads them (`data/layout-size`).
- `validateImportData` runs after the upgrade pipeline. Import paths call `prepareImport`, not `validateImportData`.

`validateImportData(data, options)` returns `{ ok, data, warnings }`. It is strict: a bad row fails the file. Two things pass with a line in `warnings` instead: a settings row with an unrecognized key, and a part that can be repaired (see [What an import repairs](#what-an-import-repairs)).

Only registry tables are read. Other keys in the file, a stray `projects` array for example, are ignored.

## What an import refuses

### A file that is no database

`options.requireFullDatabase` (default true: a restore) requires `todos` and `settings` arrays. Every full export carries both, possibly empty. Without them the file fails with `File is not a valid TODO2 database (missing tasks or settings)`. An append passes false: a task archive carries only task tables.

### A bad row

- A failure lists every bad row: the first 10 (`MAX_REPORTED_ROW_ERRORS`), then a count. A single bad row keeps its one-line message.
- Messages quote a name or title shortened to 60 characters.

### Sizes and lengths

- A table holds at most 100,000 rows (`MAX_RECORDS_PER_TABLE`).
- Task titles and notes, the workspace note, and person, tag, status and list names have no length limit. An import must accept every value the app can store, and the file-size cap (`MAX_IMPORT_SIZE_BYTES`) bounds them. An empty or non-string title or name is still rejected.
- Caps stay where no writer can exceed them:
  - A task's `uid`: 200.
  - A status update's `text`: 500, and not empty. Its `date` and `createdAt` must read as dates. `followedUp` is optional, and only `true` is kept.
  - A subtask's title: 500.
  - A person's initials: 4. They are then normalized (trimmed, uppercase, at most 3: `utils/person.normalizeInitials`), with a fix note.
  - A layout's name: 200. A longer one is cut by the layout repair, not refused.
  - A setting's key: 100, and its value: 200. The keyboard shortcuts and check-in filter rows take any text ([settings](settings.md#settings-rows-on-import)).

### Ids and keys

- Every table's `id` is absent (the database numbers the row) or a whole number from 1.
- Ids are unique within a table (`duplicate id 4 (same as index 0)`), as `settings` keys are (`duplicate key "…"`).
- Todos require a non-empty `uid`, and duplicate uids across rows are rejected.
- Two `listOrders` rows for the same list + task pair are rejected.

The unique indexes would otherwise abort the restore. Checked here, a file fails with a message, never with a raw `BulkError` from the restore.

### Models

- Schema validation covers every model. A color that is not a hex color fails its row.
- Settings rows go through the key allowlist (`ALL_SETTING_KEYS`) and per-key value checks (numeric ids, the retention range, `weekStartsOn`, the follow-up interval, `color.*` hex). Detail: [settings](settings.md#settings-rows-on-import).
- A list definition needs a current sort and group literal, and a `runtimeFilter.field` of person, status or tag.
- A stored predicate must have the core predicate shape (`predicate-shape.checkPredicateShape`).

## What an import repairs

Each of these is reported in `warnings` instead of failing the import.

- **Unrecognized settings.** A well-formed `settings` row with an unrecognized key is dropped.
- **Layouts.** A `layouts` row its check rejects is **repaired** (`ImportTableRules.repairs` / `read`) by `pickLayout`, the repair the database read and the audit use. The repaired row is what is stored, and the fixes are a warning: `Fixed 1 layout: "Plain" (tab name shortened)`. The whole file is never refused for it. A row that is no object, or whose `id` doesn't read, is still refused.
- **Filters.** A stored predicate is rebuilt from known keys by `pickPredicate`. A malformed people / status / tag id filter, Priority (markers) filter or date clause is dropped, and a text filter over 500 characters is shortened: `Fixed N lists: "…" (people filter dropped, …)`.
- **Initials.** A person's initials are normalized: `Fixed N people: …`.

## The audit

`auditData` scans the database and returns an `AuditReport`. The data tables are read in one read transaction (`readDataTables`).

Each `AuditIssue` carries:

- `table`, `description` and `count`.
- `ids`, or string `keys`.
- A `fix` (`'delete' | 'clear-field' | 'drop-store' | 'sanitize' | 'adopt-lists'`), with its `field` for `clear-field`.
- Up to 25 sample rows (`MAX_SAMPLES_PER_ISSUE`), each with its highlighted fields and a note, for the detail popup (`AuditIssueDetailDialog`).

Cleanup applies every issue's `fix` (`cleanupIssues`). It is a data replace: see [startup-and-data-replaces](startup-and-data-replaces.md#data-replaces).

### The checks, in order

1. **Unknown tables.** The raw IndexedDB store list is walked against `KNOWN_DB_TABLES`. It finds, for example, a store left behind by an older schema. `drop-store` clears it through raw IndexedDB.
2. **Unknown rows.** Every row of every registry table except settings goes through `validateRow`. A row it rejects is deleted (`delete`), except what `REPAIRS` keeps:
   - **A layout** is repaired, never deleted: `sanitize` through `pickLayout`, the sample naming what goes (`Cleanup: size reset, tab dropped`). So cleanup never deletes a layout, the active one included.
   - **A subtask** whose title alone is too long is repaired: `sanitize`, the title as `subtaskTitle` cuts it (`Cleanup: title shortened`). One with no title is deleted.
3. **Sanitizable rows.** Rows that pass `validateRow` but still hold a part an import would drop (`rowFixes`): a list's malformed people / status / tag / Priority (markers) filter or over-long text filter, a person's initials to normalize. `sanitize`. Checks 2 and 3 run together, table by table.
4. **Unknown settings.** `db.settings` keys failing `isKnownSettingKey`: deleted by `keys`.
5. **Invalid setting values.** Settings rows with a recognized key but an invalid value: deleted by `keys`.
6. **Sanitizable settings.** A readable value holding parts an import would drop (`rowFixes('settings')`): keyboard shortcut overrides that are unknown, refused or clashing, and the parts of the check-in filter its read drops (`data/checkin-filter-shape`). `sanitize` by `keys`, the sample naming each.
7. **Orphaned rows.** `todoPeople` / `todoTags` join rows, `listOrders` rows whose task or list is gone, and `todoEvents`, `statusUpdates` and `subtasks` rows whose task is gone. All `delete`, through one helper; each sample names the missing targets.
8. **A deleted status.** Todos pointing at one: `clear-field statusId`.
9. **Lists that belong to no layout.** No owner, or a layout that is gone: `adopt-lists`. The sample note is `no owner` or `owner layout N not in layouts`.
10. **Orphaned recurrence rules.** Todos with `recurrenceRule` but no due date: `clear-field recurrenceRule`.

### Lists that belong to no layout

Cleanup never deletes such a list. `layoutRepository.adoptUnownedLists(ids)` gives each one a layout, in one read-write transaction:

- Each list of `ids` that no stored layout owns becomes the first layout's, in the picker's order, whose stored row names it.
- The rest go, as list tabs in their list order, into a new layout `Recovered lists` (`RECOVERED_LISTS_LAYOUT_NAME`), after the others.
- It returns how many lists it gave a layout.
