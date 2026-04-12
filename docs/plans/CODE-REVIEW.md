# Comprehensive Code Review — 2026-04-11

Codebase: todo2_web (26K lines, 175 source files)
Reviewed by: 6 parallel agents (security, store architecture, components/views, data layer/services, TODOs/stubs, hooks/utils)

## Methodology

Each agent read the actual source code and reported only confirmed findings with file:line references. Findings were cross-verified against the codebase before inclusion. False positives were eliminated during synthesis.

---

## Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Data Integrity | 1 | 3 | 1 | — | 5 |
| Security (Import Validation) | — | — | 3 | 1 | 4 |
| Architecture / God Objects | — | — | 5 | — | 5 |
| Duplicated Logic | — | — | 4 | — | 4 |
| Inconsistent Patterns | — | — | 3 | 3 | 6 |
| React Anti-Patterns | — | — | 3 | 2 | 5 |
| Accessibility | — | — | 1 | — | 1 |
| Dead Code / Cleanup | — | — | — | 3 | 3 |
| Test Coverage Gaps | — | — | 1 | — | 1 |
| **Total** | **1** | **3** | **21** | **9** | **34** |

---

## Findings

### Critical

#### C1. Undo group leak on async exception in canvas drag-and-drop
- **File:** `src/hooks/use-canvas-dnd.ts:137-193`
- **Issue:** `beginGroup()` is called at line 137, but `endGroup()` at line 193 is not in a `finally` block. If any `await applyMutations(...)` or `await addProject(...)` throws between those lines, the undo group is left permanently open. Every subsequent undo push is silently consumed into an unclosed group, corrupting the undo stack for the rest of the session. The user loses all undo capability.
- **Fix:** Wrap the switch block in `try { ... } finally { endGroup() }`.

---

### High

#### H1. `bulkRemove` is non-atomic — partial deletes leave inconsistent state
- **File:** `src/stores/todo-store.ts:353`
- **Issue:** `await Promise.all(ids.map(id => todoRepository.delete(id)))` runs each delete as a separate IndexedDB transaction. If any delete fails (or the tab crashes mid-way), some tasks are deleted while others remain — but the undo snapshot captured at line 346 covers all of them. The Zustand state update at line 355 also removes all IDs, creating a mismatch between store and DB.
- **Fix:** Use a single Dexie transaction: `db.transaction('rw', db.todos, db.todoPeople, db.todoTags, db.todoOrgs, () => { ... })`.

#### H2. `purgeExpiredCompleted` is non-atomic — same pattern as H1
- **File:** `src/stores/todo-store.ts:505-507`
- **Issue:** Same `Promise.all(ids.map(id => todoRepository.delete(id)))` pattern. A pre-purge backup is taken, but partial purge leaves the DB in an inconsistent state with no detection mechanism.
- **Fix:** Same as H1 — single Dexie transaction.

#### H3. `restoreEntityWithJoins` (undo path) is non-atomic
- **File:** `src/stores/store-helpers.ts:114-122`
- **Issue:** Entity insert (`entityTable.add`) and join row inserts (`table.bulkAdd`) are separate transactions. If the entity insert succeeds but a join insert fails, the entity exists without its relationships. This is the undo path for person/tag/org deletes — triggered by user action.
- **Fix:** Wrap in `db.transaction('rw', entityTable, ...joinTables, () => { ... })`.

---

### Medium

#### M1. `duplicate` pollutes undo stack with individual assignment entries
- **File:** `src/stores/todo-store.ts:457-464`
- **Issue:** `duplicate()` calls `assignPerson`, `assignTag`, `assignOrg` in sequential loops. Each store action registers a separate undo entry. Duplicating a task with 3 people, 2 tags, and 1 org pushes 6 individual undo entries before the outer `undoable` at line 460 adds a 7th. Undoing "Duplicate" does not cleanly undo the assignments.
- **Fix:** Write assignments at the repository level directly (bypassing store actions), register one compound undo entry.

#### M2. `captureAssignments` reads from in-memory maps that may be incomplete
- **File:** `src/stores/store-helpers.ts:60-92`
- **Issue:** Assignment maps only cover todos seen in the current view. If a todo's assignments were never loaded, undo of `remove` restores the task without its person/tag/org assignments, silently losing data.
- **Fix:** Read from DB directly (`personRepository.getAssignedPeople(todoId)`) instead of in-memory maps.

#### M3. Import validation: `Org.initials` field not validated
- **File:** `src/data/import-validation.ts:134-140`
- **Issue:** `checkOrg` validates only `name` and `color`. The `initials` field (optional string) passes through unchecked — any length, any content. Rendered in `OrgEditor`, `TaskRow`, `MobileTaskRow`, `TaskEditMetadata`.
- **Fix:** Add `['initials', v.initials === undefined || v.initials === null || (typeof v.initials === 'string' && v.initials.length <= 4)]` to `checkOrg`.

#### M4. Import validation: `tagColor`/`orgColor` on ListInset attribute filters not validated
- **File:** `src/data/import-validation.ts:353-354`, `src/components/overlays/FilteredListPopup.tsx:37,39`
- **Issue:** `pickAttributeFilter` passes `f.tagColor` and `f.orgColor` through without calling `isValidCssColor`. These values are applied as inline CSS `style={{ color: filter.tagColor }}`. While modern browsers prevent JavaScript execution via CSS, arbitrary strings can cause visual corruption.
- **Fix:** Apply `isValidCssColor` to `tagColor`/`orgColor` in `isValidAttributeFilter` and `pickAttributeFilter`.

#### M5. Import validation: `SavedView` date range fields accept any string
- **File:** `src/data/import-validation.ts:241-242`
- **Issue:** `dateRangeStart`/`dateRangeEnd` only check `typeof === 'string'` — any content, any length. Invalid date strings produce `NaN` comparisons in filter logic (silent, not crash), and arbitrarily long strings waste memory.
- **Fix:** Use the existing `isDateLike` helper instead of bare `typeof` check, add length bound.

#### M6. `canvasViewport` state duplicated across two stores
- **File:** `src/stores/ui-store.ts:47,101,189`, `src/stores/settings-store.ts:31,146,235`
- **Issue:** Both stores track `canvasViewport`. `CanvasView.tsx:403-404` writes to both on every viewport change. After a file restore, `refreshAllStores` reloads settings-store but not ui-store, so they can diverge. Two `setCanvasViewport` methods doubles the API surface.
- **Fix:** Pick one store as source of truth. Settings-store persists; ui-store holds the live copy. Remove the double-write.

#### M7. Circular store dependencies (static imports)
- **File:** `src/stores/person-store.ts:7`, `src/stores/tag-store.ts:8`, `src/stores/org-store.ts:8`
- **Issue:** All three statically import `useTodoStore`, while `todo-store.ts:454-476` dynamically imports them back. The pattern is internally inconsistent — `todo-store` uses dynamic imports to avoid the cycle, but entity stores don't.
- **Fix:** Convert entity store imports of `useTodoStore` to dynamic imports (they're only used in undo handlers), or restructure to eliminate the cross-calls.

#### M8. Missing error handling on store mutation actions
- **File:** `src/stores/todo-store.ts` (all mutation actions), `src/stores/project-store.ts`, `src/stores/list-inset-store.ts`, `src/stores/sticky-note-store.ts`
- **Issue:** Every async mutation action (add, update, remove, bulk ops) calls repository methods without try/catch. `loadWithState` is used for load methods but not mutations. A repository failure silently leaves Zustand state inconsistent with IndexedDB.
- **Fix:** Add try/catch to mutation actions, with rollback of optimistic state updates on failure.

#### M9. Direct DB access in SettingsPage bypasses repository pattern
- **File:** `src/views/SettingsPage.tsx:208-211`
- **Issue:** `handleExportMarkdown` queries `db.todos.toArray()`, `db.projects.toArray()`, etc. directly. This is the only place in the UI layer that does raw DB access, bypassing the repository pattern and reimplementing person/tag assignment lookups.
- **Fix:** Use `buildExportData()` from `services/export-import.ts` (which already reads all tables in parallel) and derive the markdown from that result. Move the markdown formatting logic to `services/export-import.ts`.

#### M10. Filter logic duplicated in CanvasPage (50 lines)
- **File:** `src/views/CanvasPage.tsx:169-225`
- **Issue:** `filterGhostIds` memo reimplements the full filter matching logic from `useFilterStore`'s `matchesFilter` — checking priorities, starred, hard deadline, person IDs, tag IDs, org IDs, and date range. This is a copy-paste of the store logic with one difference (skip completion filter).
- **Fix:** Add an optional `skipCompletion` parameter to `matchesFilter` and call it instead.

#### M11. Entity filter dropdowns copy-pasted 3x in TopBar and FilterSheet
- **File:** `src/components/layout/TopBar.tsx:486-596`, `src/components/overlays/FilterSheet.tsx:273-388`
- **Issue:** People, Org, and Tags filter sections are structurally identical in both files (6 copies total). Each renders a search input, "None" row, and sorted/filtered entity list. Only the entity type and toggle handler differ.
- **Fix:** Extract an `EntityFilterSection` component accepting `label`, `entities`, `filterIds`, `onToggle`, `searchText`, `onSearchChange`.

#### M12. `toDateInputValue` potential timezone bug
- **File:** `src/utils/date.ts:53-59`
- **Issue:** Uses local-time methods (`getFullYear`, `getMonth`, `getDate`). If a `dueDate` is stored as UTC midnight (`2024-03-10T00:00:00Z`), then in negative UTC offsets `getDate()` returns the previous day. Whether this manifests depends on how dates round-trip through Dexie.
- **Fix:** Verify how `dueDate` is stored/retrieved. If ISO strings are used, either normalize to local midnight on read, or use UTC methods in `toDateInputValue`.

#### M13. `refreshAllStores` does not reload assignment maps
- **File:** `src/stores/file-storage-store.ts:16-35`
- **Issue:** After a file restore, `refreshAllStores` reloads entities but not `loadAssignments` on person/tag/org stores. Assignment caches remain empty until a view triggers lazy loading. Presents as a complete store reset but leaves derived caches stale.
- **Fix:** Add `loadAssignments` calls for person, tag, and org stores after entity loads complete.

#### M14. v11 migration does not migrate `listInsets.canvasId`
- **File:** `src/data/database.ts:215-227`
- **Issue:** Canvas consolidation migration migrates todos, projects, and canvasBoxes but not listInsets. Any listInset on a secondary canvas becomes orphaned. Historical bug for users who had listInsets before v11.
- **Fix:** Add a v18 migration to clean up orphaned listInsets, or document as a known historical issue if no affected users exist.

#### M15. Accessibility: filter controls missing ARIA attributes
- **File:** `src/components/layout/TopBar.tsx:436-610`
- **Issue:** Priority/People/Org/Tags dropdown triggers have no `aria-expanded`. Toggle buttons (Deadlines, Assigned, Follow up, Completed) lack `role="switch"` and `aria-checked` — these are correctly present in `FilterSheet.tsx` for the same toggles, making desktop inconsistent with mobile. Priority dropdown items use `<label>` with `onClick` rather than associated checkboxes.
- **Fix:** Add `aria-expanded` to dropdown triggers, `role="switch"` + `aria-checked` to toggle buttons, proper checkbox associations.

#### M16. `applyNlpMetadata` does multiple non-atomic DB writes
- **File:** `src/services/nlp-task-creator.ts:25-56`
- **Issue:** Task update, person assignments, and tag assignments are separate write sequences. A failure mid-way leaves the task partially configured.
- **Fix:** Wrap in a Dexie transaction, or at minimum batch all writes before committing.

---

### Low

#### L1. `canvasViewport` settings parsed without field stripping
- **File:** `src/stores/settings-store.ts:172-176`
- **Issue:** The parsed JSON is assigned directly after checking only `x`, `y`, `zoom`. Extra fields from a crafted import survive into state and React Flow's `setViewport`. No security risk in browsers, but unnecessary data leaks into state.
- **Fix:** Reconstruct: `canvasViewport = { x: parsed.x, y: parsed.y, zoom: parsed.zoom }`.

#### L2. `canvas-store` swallows errors silently
- **File:** `src/stores/canvas-store.ts:15-32`
- **Issue:** `ensureDefault` has `try/finally` with no `catch`. If `canvasRepository.getAll()` throws, the error is swallowed and `selectedCanvasId` remains `null`. No `error` state field exists (inconsistent with other stores).
- **Fix:** Add a `catch` block and `error` field.

#### L3. `saved-view-store.load()` has no error handling
- **File:** `src/stores/saved-view-store.ts:57-59`
- **Issue:** `load()` calls `savedViewRepository.getAll()` without try/catch. No `loading`/`error` fields on this store.
- **Fix:** Use `loadWithState` or add explicit error handling.

#### L4. `project-store` does not use `loadWithState`
- **File:** `src/stores/project-store.ts:27-50`
- **Issue:** Manually replicates the loading/error boilerplate that `loadWithState` centralizes. Diverges from the pattern used by every other data-loading store.
- **Fix:** Refactor to use `loadWithState`.

#### L5. `settings-store` uses module-level mutable variables
- **File:** `src/stores/settings-store.ts:114,138,139`
- **Issue:** `customizedColorKeys`, `mediaQueryCleanup`, `vpDebounceTimer` are module-level mutable state outside Zustand — invisible to devtools, not resettable between tests.
- **Fix:** Move into the store state or into refs managed by the consuming component.

#### L6. `bringToFrontRef` assigned during render
- **File:** `src/components/canvas/CanvasView.tsx:264-269`
- **Issue:** A plain assignment at the top level of the function body, not inside `useEffect` or `useCallback`. Runs on every render. Could capture a stale closure under certain React scheduling changes.
- **Fix:** Move to `useLayoutEffect` or `useCallback`.

#### L7. `StickyNoteNode` sets state during render
- **File:** `src/components/canvas/StickyNoteNode.tsx:63-75`
- **Issue:** `setLocalText(note.text)` called during render (not in effect) when external prop changes. Causes React to re-render the component twice per external update.
- **Fix:** Use a `useEffect` with `note.text` dependency, or `key={note.id}` to reset local state.

#### L8. `ProjectNode` rename timer not cleaned up on unmount
- **File:** `src/components/canvas/ProjectNode.tsx:77,207-214`
- **Issue:** `renameTimerRef` pending timer fires after unmount, calling `setIsRenaming(true)` on an unmounted component. Cleanup `useEffect` at line 85 only handles `resizeCleanupRef`.
- **Fix:** Clear `renameTimerRef` in the same cleanup effect.

#### L9. `SortableTaskList` `visibleItems` not memoized
- **File:** `src/components/canvas/SortableTaskList.tsx:130-140`
- **Issue:** Built by an imperative loop on every render. The `hierarchy` value above it is memoized, but the expansion into `visibleItems` (reading `collapsedParents`) is not.
- **Fix:** Wrap in `useMemo([hierarchy, collapsedParents])`.

---

## Dead Code and Cleanup

#### DC1. Unused `ViewSwitcher` component
- **Files:** `src/components/layout/ViewSwitcher.tsx`, `src/components/layout/ViewSwitcher.module.css`
- Superseded by `Sidebar`. Imported nowhere. Safe to delete.

#### DC2. `DATA_KEYS` / `ALL_DATA_TABLES` positional coupling
- **File:** `src/data/restore.ts:6-10` vs `src/data/database.ts:344`
- The mapping between `DATA_KEYS[i]` and `ALL_DATA_TABLES[i]` is implicit. A strongly-typed array of `{ table, key }` pairs would eliminate silent mis-mapping risk.

#### DC3. `useRef as useReactRef` alias
- **File:** `src/hooks/use-click-outside.ts:1`
- Unique alias used nowhere else. Should use standard `useRef`.

---

## Test Coverage Gaps

The data layer, stores, and services are well-tested. The main gaps:

| Area | Tested | Untested | Gap |
|------|--------|----------|-----|
| Hooks | 2/8 | `use-bulk-actions`, `use-canvas-dnd`, `use-inline-edit`, `use-keyboard-shortcuts`, `use-nlp-autocomplete`, `use-task-edit-callbacks` | 75% untested |
| Components | 6/38 | All canvas (7), most layout (3/4), all overlays (7), all settings editors (4), most shared (4/5), most task (4/6) | 84% untested |
| Views | 1/4 | `CanvasPage`, `CalendarView`, `SettingsPage` | 75% untested |
| Pure logic | — | `alignment.ts`, `utils/filter.ts` | Highly testable, no tests |

Priority for new tests: `alignment.ts` (pure functions, complex logic), `use-canvas-dnd.ts` (C1 bug lives here), `file-storage.ts` (complex state machine).

---

## Phased Remediation Plan

### Phase 1 — Critical and Data Integrity (1-2 sessions)

Fix bugs that can lose user data or corrupt application state.

| # | Finding | Files | Effort |
|---|---------|-------|--------|
| 1 | **C1**: Add try/finally around `executeDrop` undo group | `use-canvas-dnd.ts` | S |
| 2 | **H1**: Wrap `bulkRemove` in a single Dexie transaction | `todo-store.ts` | S |
| 3 | **H2**: Wrap `purgeExpiredCompleted` in a single Dexie transaction | `todo-store.ts` | S |
| 4 | **H3**: Wrap `restoreEntityWithJoins` in a Dexie transaction | `store-helpers.ts` | S |
| 5 | **M2**: Read assignments from DB in `captureAssignments` | `store-helpers.ts` | M |
| 6 | **M1**: Rewrite `duplicate` to write assignments at repo level | `todo-store.ts` | M |

### Phase 2 — Security Hardening (1 session)

Close import validation gaps. Low urgency since this is a local-first app, but these are the system boundaries.

| # | Finding | Files | Effort |
|---|---------|-------|--------|
| 7 | **M3**: Validate `Org.initials` in import | `import-validation.ts` | S |
| 8 | **M4**: Validate `tagColor`/`orgColor` with `isValidCssColor` | `import-validation.ts` | S |
| 9 | **M5**: Use `isDateLike` for SavedView date range fields | `import-validation.ts` | S |
| 10 | **L1**: Reconstruct `canvasViewport` from parsed fields only | `settings-store.ts` | S |

### Phase 3 — Architecture Cleanup (2-3 sessions)

Eliminate duplicated state, duplicated logic, and pattern inconsistencies.

| # | Finding | Files | Effort |
|---|---------|-------|--------|
| 11 | **M6**: Consolidate `canvasViewport` to one store | `ui-store.ts`, `settings-store.ts`, `CanvasView.tsx` | M |
| 12 | **M7**: Convert entity store `useTodoStore` imports to dynamic | `person-store.ts`, `tag-store.ts`, `org-store.ts` | S |
| 13 | **M13**: Add `loadAssignments` to `refreshAllStores` | `file-storage-store.ts` | S |
| 14 | **M10**: Add `skipCompletion` param to `matchesFilter`, remove CanvasPage duplicate | `filter-store.ts`, `CanvasPage.tsx` | M |
| 15 | **M9**: Move markdown export to `services/export-import.ts` | `SettingsPage.tsx`, `export-import.ts` | M |
| 16 | **M16**: Wrap `applyNlpMetadata` writes in a transaction | `nlp-task-creator.ts` | S |
| 17 | **L4**: Refactor `project-store` to use `loadWithState` | `project-store.ts` | S |
| 18 | **L2, L3**: Add error handling to `canvas-store`, `saved-view-store` | `canvas-store.ts`, `saved-view-store.ts` | S |

### Phase 4 — Component Refactoring (2-3 sessions)

Extract duplicated UI patterns, fix React anti-patterns.

| # | Finding | Files | Effort |
|---|---------|-------|--------|
| 19 | **M11**: Extract `EntityFilterSection` component | `TopBar.tsx`, `FilterSheet.tsx` | L |
| 20 | **M15**: Add ARIA attributes to desktop filter controls | `TopBar.tsx` | M |
| 21 | **L6**: Move `bringToFrontRef` to `useLayoutEffect` | `CanvasView.tsx` | S |
| 22 | **L7**: Fix `StickyNoteNode` render-time setState | `StickyNoteNode.tsx` | S |
| 23 | **L8**: Clean up `ProjectNode` rename timer on unmount | `ProjectNode.tsx` | S |
| 24 | **L9**: Memoize `visibleItems` in `SortableTaskList` | `SortableTaskList.tsx` | S |
| 25 | **M8**: Add error handling to store mutation actions (incremental) | All stores | L |

### Phase 5 — Cleanup and Testing (1-2 sessions)

Remove dead code, improve test coverage on high-risk areas.

| # | Finding | Files | Effort |
|---|---------|-------|--------|
| 26 | **DC1**: Delete `ViewSwitcher.tsx` + CSS | `components/layout/` | S |
| 27 | **DC2**: Type-safe `DATA_KEYS`/`ALL_DATA_TABLES` pairing | `restore.ts` | S |
| 28 | **DC3**: Remove `useReactRef` alias | `use-click-outside.ts` | S |
| 29 | Add tests for `alignment.ts` (pure functions) | `test/components/` | M |
| 30 | Add tests for `use-canvas-dnd.ts` (covers C1 fix) | `test/hooks/` | L |
| 31 | Add tests for `file-storage.ts` (complex state machine) | `test/services/` | L |

### Effort Key
- **S** = Small (< 30 min, localized change)
- **M** = Medium (30-90 min, touches 2-3 files)
- **L** = Large (> 90 min, new component or significant refactor)

---

## Notes

- **No TODO/FIXME markers** were found in source code. The codebase is clean of developer debt markers.
- **No debug logging** (`console.log`) exists in production code. All logging is error-path `console.error` in catch blocks.
- **No `dangerouslySetInnerHTML`**, `innerHTML`, or `eval` usage anywhere.
- The 7 `.catch(() => {})` patterns on fire-and-forget operations (backup snapshots, storage persistence) are defensible but the 4 backup snapshot calls could benefit from at minimum logging failures, since silent backup failure means no safety net before destructive operations.
- The `buildHierarchy` depth cap of 10 in `utils/hierarchy.ts:41` is a magic number that contradicts the documented 2-level max. A named constant would clarify intent.
- `listSortBy` in `ui-store.ts:100` resets to `'priority'` on every page load (not persisted), while `isMinimapOpen` in the same store is persisted to localStorage. This may be intentional but is undocumented.
- `searchText` is intentionally excluded from `SavedView` serialization — but this asymmetry between `FilterCriteria` and `SavedViewFilters` is undocumented.
