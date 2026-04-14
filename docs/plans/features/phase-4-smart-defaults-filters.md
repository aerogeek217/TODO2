# Phase 4: Smart Defaults & Filters

**Status: Complete**

## Overview
Three features focused on intelligent task creation defaults and advanced filtering.

---

## Feature 1: Infer Metadata from Active Filters on Task Creation

### Problem
When a user is viewing a filtered list (e.g., filtered to person "Alice" and tag "urgent"), creating a new task starts blank. The user must manually re-assign the same metadata that defines their current context. The new task may not even appear in their current view until they assign the right attributes.

### Current State
- **No filter-to-creation integration exists.** `useTaskEditCallbacks` (`src/hooks/use-task-edit-callbacks.ts`) does not read `useFilterStore`.
- **TaskEditPopup** (`src/components/task/TaskEditPopup.tsx`) initializes create mode with empty `pendingPersonIds`, `pendingTagIds`, `pendingOrgIds` (lines 92-94). The only defaults it reads are `defaultProjectId` and `defaultStatusId` from settings (lines 70-71, 78, 86).
- **Canvas inline creation** (`CanvasPage.tsx:221-236`, `238-260`) has no filter awareness. It uses NLP parsing only.
- All views (`CanvasPage`, `ListView`, `CalendarView`, `DashboardView`) render `TaskEditPopup` with `taskEdit.onCreate` from `useTaskEditCallbacks` — this is the single point of task creation via popup.

### Design

#### What to infer
From the active `FilterCriteria` state:

| Filter field | Inferred task metadata | Condition |
|---|---|---|
| `personIds` | Pre-assign those people | Non-null, after removing `0` (None) |
| `tagIds` | Pre-assign those tags | Non-null, after removing `0` (None) |
| `orgIds` | Pre-assign those orgs (direct assignment) | Non-null, after removing `0` (Unaffiliated) |
| `statusIds` | Set status | Non-null, exactly 1 non-zero value |
| `priorities` | Set priority | Non-null, exactly 1 value |
| `followupFilter` | Set `isStarred` | Value is `'followup'` |
| `assignedFilter` | Set `isAssigned` | Value is `'assigned'` |

**Multi-value entity filters:** When the person filter has multiple IDs selected (e.g., Alice and Bob), assign all of them. The user sees pre-populated chips in the create popup and can remove any before submitting. For inline creation (no popup UI), also assign all — consistency across both paths.

#### Priority order
When metadata comes from multiple sources:
1. **Explicit UI selection** in TaskEditPopup (user manually added/removed) — highest
2. **NLP parsing** from title text (`@person`, `#tag`, `p1`, etc.)
3. **Filter inference** — pre-populated defaults, lowest priority

In practice this means: filter values pre-populate the create popup, then NLP and manual edits layer on top.

#### Three creation paths

**Path 1: TaskEditPopup (create mode)**
- When popup opens in create mode, read `useFilterStore.getState().filters`
- Initialize `pendingPersonIds`, `pendingTagIds`, `pendingOrgIds` from filter values (excluding `0`)
- Initialize `priority`, `statusId`, `isStarred`, `isAssigned` from filter values
- User sees pre-populated chips and can edit before creating
- This covers: `Ctrl+Space` hotkey, any "new task" button across all views, command palette "New Task"
- **View scoping:** Only infer defaults when the current view has filter UI (Canvas, List, Calendar). On DashboardView, skip filter inference — the filter store is global Zustand state and may hold stale values from a previous view, which would be confusing since Dashboard doesn't display filter controls.

**Path 2: Canvas inline creation**
Three distinct handlers in `CanvasPage.tsx`, all following the same pattern (parseTaskInput + addTodo + applyNlpMetadata):
- `handleAddTask` (line 221) — bottom-of-project "add task" input. No positioning args.
- `handleInsertTask` (line 238) — InsertTrigger "+" between tasks (also triggered by Insert hotkey). Has beforeTodoId/parentId positioning.
- `handleConvertNoteLines` (line 334) — sticky note line-to-task conversion via StickyNoteNode.

For all three: after NLP parsing, if NLP didn't resolve a given entity type, fall back to filter-inferred values. Assign all filtered entities (same behavior as popup path, for consistency). Apply via the existing `applyNlpMetadata` + `assignPerson`/`assignTag`/`assignOrg` calls.

#### Paths that do NOT get filter defaults
- **Task duplication** (`todo-store.ts:520-573`) — copies source task metadata; filter inference would corrupt the copy
- **Undo restore** (`todo-store.ts:575-594`) — restores exact previous state
- **Import/restore** (`data/restore.ts`) — bulk database replacement
- **Drag-and-drop** — only moves/reorders existing tasks, never creates new ones

### Implementation Steps

#### Step 1: Create filter inference utility
Create a pure function (no hook needed) that extracts defaults from `FilterCriteria`:

**File:** `src/utils/filter-defaults.ts` (new)

```typescript
interface FilterDefaults {
  personIds: number[]
  tagIds: number[]
  orgIds: number[]
  statusId: number | undefined
  priority: Priority | undefined
  isStarred: boolean
  isAssigned: boolean
}

function getFilterDefaults(filters: FilterCriteria): FilterDefaults
```

- Strips `0` from all entity ID sets
- Returns `undefined` for statusId/priority when multiple values or no filter active

#### Step 2: Pre-populate TaskEditPopup create mode
**File:** `src/components/task/TaskEditPopup.tsx`

Modify the initial state setup (lines 77-94):
- Import `useFilterStore`, `useUIStore` (for `activeView`), and `getFilterDefaults`
- When `mode === 'create'`, check if the current view has filter UI (`activeView` is Canvas, List, or Calendar — NOT Dashboard or Settings). If so, call `getFilterDefaults(filters)` once. If not, skip filter inference entirely.
- Use returned values as initial state for `pendingPersonIds`, `pendingTagIds`, `pendingOrgIds`, `priority`, `statusId`, `isStarred`, `isAssigned`
- Settings defaults (`defaultStatusId`, `defaultProjectId`) take precedence when set — filter inference fills in what settings don't cover
- Priority: settings default `statusId` > filter-inferred `statusId`; filter-inferred `priority` > default `Priority.Normal`

#### Step 3: Apply filter defaults in canvas inline creation
**File:** `src/views/CanvasPage.tsx`

Modify all three canvas creation handlers:
- `handleAddTask` (line 221) — bottom-of-project add
- `handleInsertTask` (line 238) — InsertTrigger between tasks
- `handleConvertNoteLines` (line 334) — sticky note line conversion

For each: after `parseTaskInput`, check if `resolved.personIds`, `resolved.tagIds`, `resolved.orgIds` are empty. If empty, supplement with `getFilterDefaults(filters)` values. Apply the supplemented metadata through the existing `applyNlpMetadata` flow.

#### Step 4: Tests
**File:** `src/test/utils/filter-defaults.test.ts` (new)

Test cases:
- No active filters returns empty defaults
- Single person filter → returns that person ID
- Multiple person filters → returns all
- `0` values stripped from results
- Single priority → returns that priority; multiple → returns undefined
- Single status → returns that status; `0` → returns undefined
- `followupFilter: 'followup'` → `isStarred: true`
- `assignedFilter: 'assigned'` → `isAssigned: true`
- Combination of multiple filter types

### Files Changed
| File | Change |
|---|---|
| `src/utils/filter-defaults.ts` | **New** — pure function extracting defaults from filters |
| `src/components/task/TaskEditPopup.tsx` | Pre-populate create mode state from filter defaults |
| `src/views/CanvasPage.tsx` | Apply filter defaults to inline creation when NLP doesn't resolve |
| `src/test/utils/filter-defaults.test.ts` | **New** — unit tests for filter defaults logic |

### Edge Cases
- **DashboardView:** Filter inference is skipped entirely (view has no filter UI). The filter store may hold stale values from a previous view — applying them silently would confuse users.
- **SettingsPage:** Filter inference is skipped (no filter UI, no task creation UI).
- CalendarView with date filter only: no entity inference, just date-related defaults
- Saved view applied: filter state reflects saved view, so inference works naturally
- NLP tokens override filter defaults (e.g., typing `@Bob` overrides filter-inferred people)
- `defaultStatusId` from settings takes priority over filter-inferred status
- Task duplication: does NOT get filter defaults (copies source task metadata)

---

## Feature 2: Org Filter — Direct-Only Mode

### Problem
The org filter currently matches tasks in two ways:
1. Direct org assignment (task tagged with the org via `todoOrgs` table)
2. Indirect via person membership (task assigned to a person who belongs to the org via `personOrgs` table)

Users want an option to filter to only tasks with **direct** org assignment, ignoring person membership. Use case: "Show me tasks that are the org's responsibility, not just tasks assigned to someone who happens to be in the org."

### Current State

**Filter logic:** `todoMatchesFilter()` in `src/stores/filter-store.ts:123-133`
```
if orgIds filter active:
  if task has no org at all → match only if 0 (unaffiliated) in filter
  else → match if ANY person-org OR direct-org matches
```

This OR logic combines both paths with no way to separate them.

**Views passing org data to filter:**
- `CanvasPage.tsx:189` — passes both `pOrgIds` (person-org) and `dOrgIds` (direct-org) to `matchesFilter` ✓
- `ListView.tsx:580-581` — passes `personOrgMap` and `assignedOrgsMap` to `applyFilter` ✓
- `TaskboardPanel.tsx:77-87` — passes both ✓
- `CalendarView.tsx:127` — **BUG: only passes `personOrgMap`, missing `assignedOrgsMap`**. Direct org filtering is completely broken in CalendarView.
- `ListInsetNode.tsx:94` — passes both ✓
- `DashboardView.tsx` — unfiltered, not affected

**Saved views:** `SavedViewFilters` (`src/models/saved-view.ts`) serializes `orgIds` but has no concept of org filter mode. The serialize/deserialize functions are in `src/stores/saved-view-store.ts:23-62`.

### Design

#### New filter field
Add `orgFilterMode` to `FilterCriteria`:

```typescript
export type OrgFilterMode = 'include-people' | 'direct-only'
```

- `'include-people'` — current behavior (default)
- `'direct-only'` — match only direct org assignment

#### Filter logic change
In `todoMatchesFilter()`, when `filters.orgFilterMode === 'direct-only'`:
- Skip `assignedPersonOrgIds` entirely
- Match only on `directOrgIds`
- **"None" (0) semantics change:** In `include-people` mode, "None" matches tasks with no org connection at all (no person-org, no direct-org). In `direct-only` mode, "None" matches tasks with no *direct* org assignment — even if the task is assigned to a person who belongs to an org. This is the correct behavior: the mode asks "which org is this task directly tagged with?" and "None" means "not directly tagged with any org."

When `'include-people'` (or undefined for backward compat): current behavior unchanged.

#### UI placement
Inside the org `FilterDropdown` in `TopBar.tsx` (line 639-658), add a toggle below the dropdown header:

```
[ @ Org ▾ ]
┌─────────────────────────┐
│  ○ Include people in org │ ← radio/toggle
│  ○ Direct org only       │
│  ─────────────────────── │
│  ☐ None                  │
│  ☑ Engineering           │
│  ☑ Product               │
└─────────────────────────┘
```

This keeps the mode tightly colocated with the org filter. Use a segmented control at the top of the dropdown.

#### Saved view serialization
Add `orgFilterMode?: OrgFilterMode` to `SavedViewFilters` in `src/models/saved-view.ts`. Optional for backward compat — defaults to `'include-people'` when missing.

### Implementation Steps

#### Step 1: Fix CalendarView org filter bug
**File:** `src/views/CalendarView.tsx`

- Destructure `assignedOrgsMap` from `useOrgStore` (currently not imported)
- Add `loadAssignments` call (may already be called — verify)
- Pass `assignedOrgsMap` as 5th argument to `applyFilter` at line 127
- Add `assignedOrgsMap` to the `useMemo` dependency array at line 128

This is a standalone bug fix that should go in its own commit before the feature.

#### Step 2: Add filter mode to FilterCriteria
**File:** `src/stores/filter-store.ts`

- Add `OrgFilterMode` type export
- Add `orgFilterMode: OrgFilterMode` to `FilterCriteria` interface (line 20 area)
- Add default `orgFilterMode: 'include-people'` to `defaultFilters` (line 61) — this ensures `clearAll()` (line 236-238) resets the mode correctly, since it spreads `defaultFilters`
- Add `setOrgFilterMode(mode: OrgFilterMode)` action to `FilterState` interface and implementation
- **Do not** include `orgFilterMode` in `isFilterActive()` — it's a modifier, not a standalone filter
- `setAllFilters()` (line 232) naturally handles the new field since it spreads the entire `FilterCriteria` object
- Update `todoMatchesFilter()` org block (lines 123-133):

```typescript
if (filters.orgIds !== null) {
  const directOnly = filters.orgFilterMode === 'direct-only'
  const hasPersonOrg = !directOnly && assignedPersonOrgIds && assignedPersonOrgIds.length > 0
  const hasDirectOrg = directOrgIds && directOrgIds.length > 0
  if (!hasPersonOrg && !hasDirectOrg) {
    if (!filters.orgIds.has(0)) return false
  } else {
    const personOrgMatch = !directOnly && (assignedPersonOrgIds?.some((orgId) => filters.orgIds!.has(orgId)) ?? false)
    const directOrgMatch = directOrgIds?.some((orgId) => filters.orgIds!.has(orgId)) ?? false
    if (!personOrgMatch && !directOrgMatch) return false
  }
}
```

#### Step 3: Saved view serialization and import validation
**File:** `src/models/saved-view.ts`
- Add `orgFilterMode?: string` to `SavedViewFilters`

**File:** `src/stores/saved-view-store.ts`
- Add `orgFilterMode` to `filtersToSerializable()` (line 36 area)
- Add `orgFilterMode` to `savedFiltersToRuntime()` with fallback to `'include-people'` (line 54 area)

**File:** `src/data/import-validation.ts`
- Add validation for `orgFilterMode` in the `SavedViewFilters` validation block (line 250-268 area). Accept `undefined`, `'include-people'`, or `'direct-only'`; reject other values.

#### Step 4: TopBar UI toggle
**File:** `src/components/layout/TopBar.tsx`

- Import `setOrgFilterMode` from filter store
- Inside the org `FilterDropdown` children (line 650-657), add a segmented control above the entity list:
  - Two options: "Include people" / "Direct only"
  - Reads `filters.orgFilterMode`
  - Calls `setOrgFilterMode()` on change

**File:** `src/components/layout/TopBar.module.css`
- Add styles for the org mode segmented control

#### Step 5: Mobile FilterSheet
**File:** `src/components/overlays/FilterSheet.tsx`

- Add the same org mode toggle in the Orgs section of the mobile filter sheet

#### Step 6: Tests
**File:** `src/test/stores/filter-store.test.ts`

New test cases:
- `orgFilterMode: 'include-people'` matches person-org and direct-org (current behavior preserved)
- `orgFilterMode: 'direct-only'` ignores person-org, matches only direct-org
- `orgFilterMode: 'direct-only'` with task having only person-org → excluded
- `orgFilterMode: 'direct-only'` with task having both → matches on direct
- Default (undefined) mode behaves as `'include-people'`

### Files Changed
| File | Change |
|---|---|
| `src/views/CalendarView.tsx` | **Bug fix** — pass `assignedOrgsMap` to `applyFilter` |
| `src/stores/filter-store.ts` | Add `orgFilterMode` field, setter, update filter logic |
| `src/models/saved-view.ts` | Add `orgFilterMode` to `SavedViewFilters` |
| `src/stores/saved-view-store.ts` | Serialize/deserialize `orgFilterMode` |
| `src/data/import-validation.ts` | Validate `orgFilterMode` in saved view filter validation |
| `src/components/layout/TopBar.tsx` | Add mode toggle in org filter dropdown |
| `src/components/layout/TopBar.module.css` | Styles for org mode toggle |
| `src/components/overlays/FilterSheet.tsx` | Add mode toggle in mobile filter sheet |
| `src/test/stores/filter-store.test.ts` | Tests for direct-only org filter mode |

### Edge Cases
- Saved views without `orgFilterMode` default to `'include-people'` (backward compat)
- When `orgIds` filter is null (all orgs), `orgFilterMode` has no effect (filter isn't active)
- "None/Unaffiliated" (0) semantics differ by mode: in `include-people`, "None" = no org at all; in `direct-only`, "None" = no direct org assignment (task may still have person-org connections)
- Import validation: accept `undefined`, `'include-people'`, or `'direct-only'`; reject unknown values
- Canvas TaskboardNode does not apply org filtering (pre-existing; not changed by this feature)

---

## Feature 3: Manual Completed Task Cleanup Button

### Problem
The existing auto-purge (`purgeExpiredCompleted`) only runs at app startup. If a user changes the retention setting or wants to immediately clean up old tasks, they must close and reopen the app. The settings page shows stats about expired tasks but offers no way to act on them.

### Current State

**Auto-purge:** `useTodoStore.purgeExpiredCompleted(retentionDays)` (`src/stores/todo-store.ts:601-616`)
- Filters `isCompleted === true AND modifiedAt < cutoff`
- Creates backup via `backupScheduler.snapshotBeforeDestructive()`
- Calls `todoRepository.bulkDelete(ids)` (transaction-safe, clears join tables)
- Returns count of deleted tasks
- **Not undoable** — uses direct repo call, not the undoable `bulkRemove`

**Settings page:** `src/views/SettingsPage.tsx:315-351`
- "Completed Tasks" section (desktop only)
- Retention dropdown: Keep forever / 7 / 14 / 30 / 60 / 90 days
- Stats display: expired count, expiring-this-week count, total completed count
- Stats already computed in `retentionStats` memo (lines 95-114)

**Existing confirmation pattern:** `BulkConfirmDialog` supports `action: 'custom'` with custom message, labels, and `onConfirm` handler (via `useUIStore.showBulkConfirmation`).

### Design

#### Button placement
Add a "Clean Up Now" button in the existing "Completed Tasks" section, next to or below the retention stats:

```
Completed Tasks
  Auto-delete completed tasks after [ 30 days ▾ ]
  12 completed tasks past retention (will be purged on next startup)
  3 more will expire in the next 7 days
  [ Clean Up Now ]    ← new button
```

The button should:
- Be enabled only when `completedRetentionDays` is set AND `retentionStats.expired > 0`
- Be disabled (grayed) otherwise, with tooltip explaining why
- Show the count: "Clean Up 12 Tasks" (dynamic label)

#### Flow
1. User clicks "Clean Up Now"
2. Confirmation dialog: "Delete {N} completed tasks older than {retentionDays} days? A backup will be created first."
3. On confirm: call `purgeExpiredCompleted(completedRetentionDays)`
4. Show result: update the stats display (the `retentionStats` memo will recompute automatically since `todos` changes)
5. Optional: brief success feedback (snackbar or inline message)

#### No custom threshold
Keep it simple — the button uses the same `completedRetentionDays` setting that the dropdown controls. If the user wants a different threshold, they change the dropdown first, then click the button. This avoids a second input mechanism and keeps the UI clean.

### Implementation Steps

#### Step 1: Add cleanup button with local confirmation to Settings page
**File:** `src/views/SettingsPage.tsx`

Use local state for confirmation rather than routing through BulkConfirmDialog/App.tsx. Reasons: (1) `App.tsx:46` calls `customHandler()` without `await`, so async `onConfirm` handlers fire-and-forget with no error handling; (2) local state avoids needing to import `useUIStore`; (3) SettingsPage already has inline transient-message patterns via `track()` + `setTimeout`.

- Access `purgeExpiredCompleted` from `useTodoStore` (already imported at line 5; add selector for the action)
- Add local state: `const [confirmingCleanup, setConfirmingCleanup] = useState(false)`
- Add a `handleCleanup` callback:
  ```typescript
  const handleCleanup = useCallback(async () => {
    if (!completedRetentionDays || !retentionStats || retentionStats.expired === 0) return
    const count = await purgeExpiredCompleted(completedRetentionDays)
    setConfirmingCleanup(false)
    // retentionStats will recompute automatically since todos state changes
  }, [completedRetentionDays, retentionStats, purgeExpiredCompleted])
  ```
- Add confirm/cancel UI inline in the retention info section (after line 349):
  - Default state: "Clean Up N Tasks" button
  - After click: replace button with confirmation text ("Delete N tasks? A backup will be created.") + "Delete" / "Cancel" buttons
  - This follows the same pattern as other destructive settings actions
  ```tsx
  {!confirmingCleanup ? (
    <button
      className={`${styles.button} ${styles.buttonDanger}`}
      disabled={!completedRetentionDays || !retentionStats || retentionStats.expired === 0}
      onClick={() => setConfirmingCleanup(true)}
    >
      {retentionStats && retentionStats.expired > 0
        ? `Clean Up ${retentionStats.expired} Task${retentionStats.expired !== 1 ? 's' : ''}`
        : 'Clean Up Now'}
    </button>
  ) : (
    <div className={styles.confirmRow}>
      <span>Delete {retentionStats!.expired} task{retentionStats!.expired !== 1 ? 's' : ''}? A backup will be created.</span>
      <button className={`${styles.button} ${styles.buttonDanger}`} onClick={handleCleanup}>Delete</button>
      <button className={styles.button} onClick={() => setConfirmingCleanup(false)}>Cancel</button>
    </div>
  )}
  ```

#### Step 2: Add danger button and confirm row styles
**File:** `src/views/SettingsPage.module.css`

Add a `.buttonDanger` style (red-tinted variant of existing `.button`):
- Uses `var(--color-priority-high)` for the red color (no `--color-danger` token exists; `--color-priority-high` is `#ee7d77` dark / `#d94a43` light, already used by `.backupBtnDanger` in this file)
- Disabled state: muted opacity, no hover effect

Add a `.confirmRow` style for the inline confirmation layout (flex row, gap, aligned items).

#### Step 3: Test manually
- Set retention to 30 days
- Verify button shows correct count
- Click button, verify inline confirmation appears
- Confirm, verify tasks deleted and stats update
- Verify button disabled when no expired tasks
- Verify button disabled when retention is "Keep forever"
- Verify cancel returns to default button state

### Files Changed
| File | Change |
|---|---|
| `src/views/SettingsPage.tsx` | Add "Clean Up Now" button with confirmation flow |
| `src/views/SettingsPage.module.css` | Add danger button style (if not already present) |

### Edge Cases
- Retention not set ("Keep forever"): button disabled, since there's no threshold to apply
- Zero expired tasks: button disabled
- Concurrent file sync: `purgeExpiredCompleted` deletes from IndexedDB; Dexie hooks will sync to file if file storage is connected (confirmed: `fileStorageService` installs `deleting` hooks on all `ALL_DATA_TABLES`)
- Retention changed between clicking button and confirming: `purgeExpiredCompleted` recomputes the expired set from current `get().todos` state at execution time, so the actual count deleted may differ from the inline confirmation text. Acceptable — the backup protects against data loss.
- No undo snackbar: the operation is not undoable (no `undoable()` call — deliberate, since it can involve dozens/hundreds of tasks). The pre-destructive backup snapshot is the safety net. Showing an undo snackbar would be misleading.

---

## Suggested Commit Order

1. **Bug fix: CalendarView org filter** — standalone fix, no feature dependency
2. **Feature 3: Manual cleanup button** — smallest scope, independent of other features
3. **Feature 2: Org filter direct-only mode** — builds on CalendarView fix
4. **Feature 1: Filter-inferred defaults** — largest scope, independent but benefits from org filter mode being settled

Each feature can be a single commit or split into sub-commits (e.g., utility + UI + tests).

## Resolved Decisions

1. **Feature 1 — Multi-value inference**: Assign all filtered entities for both popup and inline creation paths.
2. **Feature 1 — View scoping**: Only infer filter defaults on views with filter UI (Canvas, List, Calendar). Skip on Dashboard and Settings to avoid stale filter state confusion.
3. **Feature 1 — Sticky note conversion**: Include `handleConvertNoteLines` as a third canvas creation path that gets filter defaults.
4. **Feature 2 — UI for mode toggle**: Segmented control inside the org filter dropdown.
5. **Feature 2 — "None" semantics**: In `direct-only` mode, "None" means "no direct org assignment" (task may still have person-org connections). This is the correct interpretation for the mode's intent.
6. **Feature 3 — Confirmation approach**: Use local state inline confirmation instead of BulkConfirmDialog, to avoid the async `onConfirm` gap in App.tsx and keep the flow self-contained in SettingsPage.
7. **Feature 3 — Danger color token**: Use `var(--color-priority-high)` (existing), not `var(--color-danger)` (doesn't exist).
8. **Feature 3 — Mobile**: Desktop only, matching existing "Completed Tasks" section scope.
