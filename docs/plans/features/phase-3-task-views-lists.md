# Phase 3 — Task Views & Lists

**Status: Complete** (2026-04-13)

Task row, detail, and list view improvements.

---

## 1. Toggle `isAssigned` from TaskRow

**Problem:** The `isAssigned` delegation flag can only be toggled from the TaskEditPopup ("Assigned"/"Assign" button in `TaskEditMetadata.tsx:208-214`). TaskRow shows a green highlight (`--color-assigned-bg` + `--color-assigned-border`) when assigned, but there's no inline way to set/unset it. (Note: people/org/tag assignment chips and `@`/`#` dropdowns already exist on TaskRow — this item is specifically about the `isAssigned` boolean delegation marker, which is a separate concept.)

**Solution:** Add an assign toggle button to TaskRow with full undo support, following the `toggleStar`/`bulkSetStarred` pattern.

### Files to change

**`src/data/todo-repository.ts`** — new repository method
- Add `toggleAssigned(id: number, assigned: boolean)` following the `toggleStar` pattern (line 66-68):
  ```typescript
  async toggleAssigned(id: number, assigned: boolean): Promise<void> {
    await db.todos.update(id, { isAssigned: assigned || undefined, modifiedAt: new Date() })
  },
  ```
- Uses `assigned || undefined` so that `false` is stored as `undefined` (matching existing pattern — `isAssigned` is optional on the model, and TaskEditPopup stores `undefined` when clearing at line 155).

**`src/stores/todo-store.ts`** — new store methods with undo

Add `toggleAssigned(id)` after `toggleStar` (~line 239), following the identical pattern:
```typescript
async toggleAssigned(id: number) {
  const todo = get().todos.find((t) => t.id === id)
  if (!todo) return
  const assigned = !todo.isAssigned
  const label = assigned ? 'Assign' : 'Unassign'
  return optimistic(
    set,
    () => set({
      todos: get().todos.map((t) =>
        t.id === id ? { ...t, isAssigned: assigned || undefined, modifiedAt: new Date() } : t
      ),
    }),
    () => todoRepository.toggleAssigned(id, assigned),
    () => set({
      todos: get().todos.map((t) =>
        t.id === id ? { ...t, isAssigned: !assigned || undefined } : t
      ),
    }),
    'Failed to toggle assigned',
    {
      description: `${label} "${todo.title}"`,
      redo: () => get().toggleAssigned(id),
      undo: () => get().toggleAssigned(id),
    },
  )
},
```

Add `bulkSetAssigned(ids, assigned)` after `bulkSetStarred` (~line 408), following the identical pattern:
```typescript
async bulkSetAssigned(ids: number[], assigned: boolean) {
  const prevStates = get().todos
    .filter((t) => ids.includes(t.id))
    .map((t) => ({ id: t.id, wasAssigned: !!t.isAssigned }))
  const idSet = new Set(ids)

  return optimistic(
    set,
    () => {
      const now = new Date()
      set({
        todos: get().todos.map((t) =>
          idSet.has(t.id) ? { ...t, isAssigned: assigned || undefined, modifiedAt: now } : t
        ),
      })
    },
    () => Promise.all(ids.map((id) => todoRepository.toggleAssigned(id, assigned))).then(() => {}),
    () => {
      const prevMap = new Map(prevStates.map(s => [s.id, s.wasAssigned]))
      set({
        todos: get().todos.map((t) =>
          prevMap.has(t.id) ? { ...t, isAssigned: prevMap.get(t.id)! || undefined } : t
        ),
      })
    },
    'Failed to toggle assigned',
    {
      description: `${assigned ? 'Assign' : 'Unassign'} ${ids.length} tasks`,
      redo: () => get().bulkSetAssigned(ids, assigned),
      undo: async () => {
        for (const { id, wasAssigned } of prevStates) {
          if (wasAssigned !== assigned) {
            await todoRepository.toggleAssigned(id, wasAssigned)
          }
        }
        const revertIds = prevStates.filter(s => s.wasAssigned !== assigned).map(s => s.id)
        if (revertIds.length > 0) {
          const revertSet = new Set(revertIds)
          const stateMap = new Map(prevStates.map(s => [s.id, s.wasAssigned]))
          set({
            todos: get().todos.map((t) =>
              revertSet.has(t.id) ? { ...t, isAssigned: stateMap.get(t.id)! || undefined, modifiedAt: new Date() } : t
            ),
          })
        }
      },
    },
  )
},
```

**`src/hooks/use-bulk-actions.ts`** — new `toggleAssigned` callback
- Add after `toggleStar` (~line 87), following the exact same dispatch pattern:
  ```typescript
  const toggleAssigned = useCallback((todoId: number) => {
    const ids = getTargetIds(todoId)
    const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
    if (!todo) return
    const targetAssigned = !todo.isAssigned
    if (ids.length > 1) {
      useTodoStore.getState().bulkSetAssigned(ids, targetAssigned)
    } else {
      useTodoStore.getState().toggleAssigned(todoId)
    }
  }, [])
  ```
- Add `toggleAssigned` to the returned object (line 168-180).

**`src/components/task/TaskRow.tsx`** — UI button
- Destructure `toggleAssigned` from `useBulkActions()` (alongside existing `toggleStar`, `remove`, etc.).
- Add a `handleToggleAssigned` handler matching the `handleToggleStar` pattern.
- Add the button just before the star button (~line 472). Skip render when `ghost` is true (consistent with other interactive elements):
  ```tsx
  {!ghost ? (
    <button
      className={`${styles.assignButton} ${todo.isAssigned ? styles.assignActive : styles.assignInactive}`}
      onClick={(e) => { e.stopPropagation(); handleToggleAssigned() }}
      aria-label={todo.isAssigned ? 'Unassign task' : 'Assign task'}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="5" r="3" />
        <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
        {todo.isAssigned && <path d="M11 8l1.5 1.5L16 6" stroke="currentColor" strokeWidth="1.5" fill="none" />}
      </svg>
    </button>
  ) : null}
  ```
- The icon is a person silhouette with a checkmark overlay when active — visually distinct from the `@` trigger for people chip assignment.

**`src/components/task/TaskRow.module.css`** — button styles
- Add after the `.starButton` block (~line 666):
  ```css
  .assignButton {
    background: transparent;
    border: none;
    font-size: 16px;
    padding: 0 4px;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, opacity 0.15s;
  }

  .assignActive {
    color: var(--color-assigned-text);
  }

  .assignInactive {
    color: var(--color-text-muted);
    opacity: 0;
  }

  .assignInactive:hover {
    color: var(--color-text-secondary);
  }

  .row:hover .assignInactive {
    opacity: 1;
  }
  ```
- Inactive state is hidden until row hover (like `.deleteButton` pattern at lines 669-686). Active state is always visible (like `.starred` at line 657).

### Visual layout (left to right at end of row)
```
... [tag chips] [due date] [assign icon] [follow-up icon] [× delete]
```

### Filter interaction — important behavioral note

The default filter is `assignedFilter: 'unassigned-only'` (`filter-store.ts:64`), which hides assigned tasks on canvas and in lists (`filter-store.ts:93`). Toggling `isAssigned` ON will cause the task to disappear from the current view if this default filter is active.

This is **correct and consistent** with setting `isAssigned` from the popup — the behavior should not differ based on where the toggle lives. The undo snackbar (auto-shown by `optimistic()`) provides recovery if the user toggles by mistake.

Do NOT add a confirmation dialog or guard for this — it would be inconsistent with how every other filter-affecting toggle works (e.g., completing a task also hides it under the default `incomplete-only` filter, with no warning).

### Auto-clear semantic — intentional difference from popup

`TaskEditPopup` auto-clears `isAssigned` when all people and orgs are removed (lines 151-157). The TaskRow toggle does **not** replicate this guard because:
- The popup auto-clear is a convenience for the popup's own workflow (user removes all assignees → delegation flag becomes meaningless in that context).
- The TaskRow toggle is a deliberate user action. A user may mark a task as "to be assigned" before choosing who to assign it to.
- The `isAssigned` flag is valid without people — it is used independently by filters and the dashboard "Assigned" section.

### Mobile — not included

`MobileTaskRow` does not get this toggle. Its design is deliberately minimal (star + chevron-to-popup). Users toggle `isAssigned` via the popup, accessed through the chevron. This is consistent with MobileTaskRow having no other inline toggle actions beyond star.

---

## 2. List grouping by People: orgs first

**Problem:** In `ListView.tsx`, `buildPeopleSections()` (lines 110-173) builds sections in this order:
1. One section per person (lines 130-143)
2. One section per org for person-unassigned tasks (lines 147-165)
3. "Unassigned" section (lines 166-169)

The user wants orgs to appear **before** individual people.

**Solution:** Reorder the section-building logic so org sections come first.

### Files to change

**`src/views/ListView.tsx` — `buildPeopleSections()`**

Current output order:
```
[person sections] → [org sections (person-unassigned tasks only)] → [Unassigned]
```

Target output order:
```
[org sections (person-unassigned tasks only)] → [person sections] → [Unassigned]
```

**Approach:** Swap display order only — no logic changes. The existing code builds person sections first (lines 130-143), then org sections (lines 147-165), then pushes the unassigned remainder. Refactor to collect the person sections and org sections into separate arrays, then return them in swapped order.

### Implementation

Refactor `buildPeopleSections()` to accumulate into two arrays instead of one:

```typescript
const personSections: Section[] = []
const assignedTodoIds = new Set<number>()

// --- existing person loop (lines 130-143), push into personSections ---

const unassigned = todos.filter((t) => !assignedTodoIds.has(t.id))
const orgSections: Section[] = []

// --- existing org sub-grouping loop (lines 147-165), push into orgSections ---

// Remaining truly unassigned
const unassignedSection: Section[] = []
if (remaining.length > 0) {
  unassignedSection.push({ key: 'unassigned', label: 'Unassigned', todos: remaining })
}

return [...orgSections, ...personSections, ...unassignedSection]
```

The task-to-section assignment stays identical — person sections still claim tasks first, org sections get the person-unassigned leftovers. Only the final array concatenation order changes.

---

## 3. Task detail: sort project selector alphabetically

**Problem:** In `TaskEditMetadata.tsx` (lines 160-177), the project dropdown lists projects filtered by search text but **not sorted**. They appear in whatever order passed from the parent component (database `sortOrder`, which is insertion order).

**Solution:** Sort the filtered projects alphabetically by name before rendering.

### Files to change

**`src/components/task/TaskEditMetadata.tsx`**

Change line 160-161 from:
```tsx
{projects
  .filter(p => !projectSearch || p.name.toLowerCase().includes(projectSearch.toLowerCase()))
  .map(p => (
```

To:
```tsx
{projects
  .filter(p => !projectSearch || p.name.toLowerCase().includes(projectSearch.toLowerCase()))
  .toSorted((a, b) => a.name.localeCompare(b.name))
  .map(p => (
```

### Notes
- `.toSorted()` is already used elsewhere in this file (lines 220-221 for people/orgs in ChipSelector).
- This only affects the dropdown list; it does not change canvas sort order or project store order.
- The "No project" option remains at the top (it's rendered separately before the loop, line 145-158).

---

## 4. Plain text export: allow selecting text in popup

**Problem:** `PlainTextExportPopup.module.css` line 51 has `user-select: all`, which means any click inside the `<pre>` element selects **all** text. The user wants to be able to select specific portions (e.g., a single section).

**Solution:** Change `user-select: all` to `user-select: text`.

### Files to change

**`src/components/overlays/PlainTextExportPopup.module.css`**

Change line 51:
```css
user-select: all;
```
To:
```css
user-select: text;
```

### Notes
- `user-select: text` is the browser default for text content and allows normal click-drag selection.
- The "Copy to clipboard" button still copies all text via `navigator.clipboard.writeText()` — that's unaffected.
- The clipboard fallback (lines 74-81 in PlainTextExportPopup.tsx) that selects all text via `document.createRange()` still works as a fallback for the copy button.

---

## 5. Show last modified date on stale tasks (dashboard)

**Problem:** The "Stale" section in DashboardView shows tasks sorted by oldest `modifiedAt`, but the TaskRow doesn't display this date. For the other sections (Mine, Follow-up, Assigned), the sort criteria are self-evident (priority/due date). For Stale, the key information — *how long since last touched* — is invisible.

**Solution:** Show a relative "last modified" label on stale task rows.

### Approach options

**(a) Add a prop to TaskRow for an extra label.** TaskRow gains an optional `extraLabel?: string` prop that renders a small muted text element (e.g., "Modified 3w ago") in the row. DashboardView passes this only for the stale section.

**(b) Show modified date in the Stale section header or as a subtitle per task.** Wrap TaskRow in a container that appends the date below or beside it.

**(c) Show modified date as a tooltip on hover.** Least intrusive but less discoverable.

**Recommended: option (a)** — it's the most visible and consistent with the existing row layout.

### Files to change

**`src/components/task/TaskRow.tsx`**
- Add optional prop `extraLabel?: string` to `TaskRowProps`.
- Render it as a small muted span after the tag chip group (or near the due date area), styled like `--color-text-muted`, `--font-size-meta`.

**`src/components/task/TaskRow.module.css`**
- Add `.extraLabel` class: small, muted, non-interactive.

**`src/views/DashboardView.tsx`**
- For the `stale` list only, compute a relative time label from `todo.modifiedAt` using `formatRelativeTime()` from `utils/date.ts`.
- Pass it as `extraLabel` to TaskRow.

### Example rendering
```
[P] [✓] Fix login bug   @Alice  #backend   Modified 3w ago   [★] [×]
```

### Notes
- `formatRelativeTime` already exists in `utils/date.ts` — verify it handles the expected range (days/weeks/months).
- Only the Stale section needs this; other dashboard sections don't pass `extraLabel`.

---

## 6. Add text export button to projects (canvas)

**Problem:** The ListView has an "Export" button that opens `PlainTextExportPopup` with all visible sections. Canvas project nodes have no equivalent. The user wants to export a single project's tasks as plain text.

**Solution:** Add an export button to the ProjectNode title bar (or context menu) that opens PlainTextExportPopup scoped to that project's tasks.

### Files to change

**`src/components/canvas/ProjectNode.tsx`**

Option A — **Title bar button** (like the existing sort ↕ button):
- Add a small export icon button in the title bar, between the sort button and the color picker.
- Clicking it opens a local state `showExport` that renders PlainTextExportPopup in a portal.

Option B — **Context menu item** (less cluttered):
- Add an "Export as text" item to the existing right-click context menu (lines 178-184).
- Clicking it opens the export popup.

**Recommended: context menu (Option B)** — the title bar is already crowded with collapse, sort, color picker, and delete. A context menu item keeps it clean.

### Implementation

1. Add state: `const [showExport, setShowExport] = useState(false)`

2. Add context menu item after "Collapse"/"Expand":
   ```tsx
   { label: 'Export as text', action: () => setShowExport(true) },
   ```

3. Build a single-project section for PlainTextExportPopup:
   ```tsx
   {showExport && createPortal(
     <PlainTextExportPopup
       sections={[{ key: `project-${project.id}`, label: project.name, todos }]}
       assignedPeopleMap={assignedPeopleMap}
       assignedTagsMap={assignedTagsMap ?? new Map()}
       statusMap={statusMap}
       onClose={() => setShowExport(false)}
     />,
     document.body,
   )}
   ```

4. ProjectNode needs access to `statusMap`. Options:
   - Read statuses from store directly: `const statuses = useStatusStore(s => s.statuses)` and build the map locally.
   - Or pass it down through `ProjectNodeData`. Reading from store is simpler and avoids changing the data flow.

### Dependencies
- `PlainTextExportPopup` already accepts a `sections` array — it works for any number of sections, including one.
- Need to import `PlainTextExportPopup`, `createPortal`, and `useStatusStore`.
- The `assignedTagsMap` prop on ProjectNodeData is already optional (`assignedTagsMap?: Map<number, Tag[]>`), so it may be undefined — use `?? new Map()` fallback.

---

## Implementation order

These items are independent and can be done in any order. Suggested order by complexity (simplest first):

1. **Item 4** — CSS one-liner (`user-select: all` → `user-select: text`)
2. **Item 3** — One-line `.toSorted()` addition
3. **Item 2** — Reorder sections array output in `buildPeopleSections()`
4. **Item 5** — Add `extraLabel` prop to TaskRow + wire up in DashboardView
5. **Item 1** — New assign toggle button on TaskRow + bulk action + CSS
6. **Item 6** — Export button on ProjectNode + state + portal rendering

Total estimate: 6 small-to-medium changes, no new files needed, no architectural changes.
