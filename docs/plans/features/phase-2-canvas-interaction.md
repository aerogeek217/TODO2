# Phase 2 — Canvas Interaction

Status: **Complete**

Two items: (1) list inset height control with corner resize handle, and (2) taskboard drag-out removal.

---

## Item 1: List inset height adjustor + corner drag handle

### Current state

- `ListInsetNode.tsx` has a **right-edge resize handle** for width only (`cursor: ew-resize`)
- The `ListInset` model has a `height: number` field persisted in IndexedDB
- The store creates insets with default height 300 (`list-inset-store.ts:47,67`), but **height is never applied to the DOM** — only `width` is set as an inline style (`ListInsetNode.tsx:150`)
- CSS `.body` uses a hardcoded `max-height: 500px` — scrolling works via `overflow-y: auto` but the user can't control it
- The `onResize(id, width, height)` callback path is fully wired: `ListInsetNodeData.onResize` → `CanvasPage.handleResizeInset` → `useListInsetStore.update` → `listInsetRepository.update`
- The existing width resize handler already passes `inset.height` through on mouseup (`ListInsetNode.tsx:208`), so width-only resizes preserve the stored height value
- **Note:** `TaskboardNode` has a similar width-only resize pattern, but stores its dimensions in **localStorage** (not IndexedDB) with a default height of **400** (`CanvasPage.tsx:54-56`)

### Plan

#### Step 1: Apply persisted height to the body (MUST ship with Step 2 atomically)

In `ListInsetNode.tsx`, set the body's `max-height` to the inset's stored height instead of the CSS hardcoded 500px:

```tsx
// In the body div, replace fixed CSS max-height with inline style
<div
  className={`${inset.isCollapsed ? styles.collapsedBody : styles.body} nopan nodrag nowheel`}
  style={!inset.isCollapsed ? { maxHeight: inset.height } : undefined}
>
```

In `ListInsetNode.module.css`, remove the hardcoded `max-height: 500px` from `.body` (keep `overflow-y: auto` and `min-height`).

**Why atomic:** Removing the CSS `max-height` without applying the inline style causes the body to grow unboundedly. The collapsed state is unaffected — it uses a separate `.collapsedBody` class with `display: none`.

#### Step 2: Add a corner resize handle (bottom-right)

Add a new CSS class `.cornerHandle` positioned at the bottom-right corner with `cursor: nwse-resize`. This handle resizes both width and height simultaneously.

**CSS:**
```css
.cornerHandle {
  position: absolute;
  bottom: -4px;
  right: -4px;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 1;
}

.cornerHandle::after {
  content: '';
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  border-right: 2px solid var(--color-accent);
  border-bottom: 2px solid var(--color-accent);
  border-radius: 0 0 var(--radius-sm) 0;
}

.inset:hover .cornerHandle {
  opacity: 1;
}
```

**JS handler** (follows the same pattern as the existing width resize):
- Track `startX`, `startY`, `startW`, `startH`
- On mousemove: compute `newW = max(220, startW + deltaX / zoom)` and `newH = max(100, startH + deltaY / zoom)`
- Apply both to the DOM live (via element style)
- On mouseup: call `onResize(inset.id, newW, newH)` to persist

#### Step 3: Keep existing right-edge handle (width-only, no changes)

The existing right-edge handle stays for width-only resize. No changes needed.

#### Step 4: Add a bottom-edge handle for height-only resize

Add a `.bottomHandle` positioned along the bottom edge with `cursor: ns-resize`. This handle resizes height only.

**CSS:**
```css
.bottomHandle {
  position: absolute;
  bottom: -4px;
  left: 0;
  width: calc(100% - 12px); /* leave room for corner handle */
  height: 8px;
  cursor: ns-resize;
  opacity: 0;
  transition: opacity 0.15s;
}

.bottomHandle::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 3px;
  border-radius: var(--radius-sm);
  background: var(--color-accent);
}

.inset:hover .bottomHandle {
  opacity: 1;
}
```

**JS handler:**
- Track `startY`, `startH`
- On mousemove: compute `newH = max(100, startH + deltaY / zoom)`
- Apply to body maxHeight live
- On mouseup: persist via `onResize(inset.id, inset.width, newH)`

#### Step 5: Handle snap for width resize (optional, aligns with Phase 1 fix)

Phase 1 has a TODO "Canvas list views don't snap on width change." The project nodes already have snap-on-resize via `findResizeSnap`. To add snapping for list inset width resize:

- Pass `onResizeSnap` and `onSetAlignmentLines` into `ListInsetNodeData` (same pattern as `ProjectNodeData`)
- During width resize, call the snap function and apply the snapped width
- This is optional for Phase 2 but would close the Phase 1 item simultaneously

### Files to modify

| File | Changes |
|------|---------|
| `src/components/canvas/ListInsetNode.tsx` | Apply height to body style; add corner + bottom resize handlers |
| `src/components/canvas/ListInsetNode.module.css` | Remove hardcoded `max-height: 500px` from `.body`; add `.cornerHandle`, `.bottomHandle` classes |

### Design notes

- **Height minimum**: 100px (enough for 2-3 task rows + "No tasks" empty state)
- **Width minimum**: 220px (existing)
- **Default height**: 300px (existing default in store, now actually applied)
- **No height snap**: Vertical snap for height resize is not implemented for project nodes either; keeping parity. Can be added later if needed.

---

## Item 2: Dragging item from taskboard onto canvas removes it from taskboard

### Current state

The `TaskboardNode` has a **nested `DndContext`** for internal sortable reordering:

```
Outer DndContext (CanvasPage, pointerWithin collision detection)
├── SortableTaskList items → useSortable({ id: `todo-${id}`, data: { type: 'task', todo } })
├── ListInsetNode items → useDraggable({ id: `inset-${insetId}-${todoId}`, data: { type: 'task', todo } })
├── TaskboardNode (useDroppable: 'taskboard-drop', data: { type: 'taskboard' })
│   └── Nested DndContext (closestCenter collision detection, PointerSensor + KeyboardSensor)
│       └── SortableContext → SortableTaskboardEntry
│           useSortable({ id: entryId }) ← raw numeric ID, NO data property
│           These are captured by the nested context and CANNOT escape to the outer one
```

The nested context isolates taskboard items. They can only reorder internally. Existing outer handleDragEnd (`use-canvas-dnd.ts:380-389`) handles drops **onto** the taskboard (adding tasks) via `overData?.type === 'taskboard'`.

### Root cause

The nested `DndContext` in `TaskboardNode` captures all pointer events for its children, preventing cross-context interaction. This was originally the correct pattern for a standalone sortable component, but now prevents drag-to-remove.

### Approach: Merge into outer DndContext

Remove the nested `DndContext` from `TaskboardNode` and register taskboard items with the outer context. This matches how `SortableTaskList` already works — it uses `SortableContext` without its own `DndContext`, relying on the ancestor context in `CanvasPage.tsx`.

**New architecture:**
```
Outer DndContext (CanvasPage, pointerWithin collision detection)
├── SortableTaskList items → useSortable({ id: `todo-${id}`, data: { type: 'task', todo } })
├── ListInsetNode items → useDraggable({ id: `inset-${insetId}-${todoId}`, data: { type: 'task', todo } })
├── TaskboardNode (useDroppable: 'taskboard-drop', data: { type: 'taskboard' })
│   └── SortableContext (NO nested DndContext)
│       └── SortableTaskboardEntry → useSortable({ id: `tb-${entryId}`, data: { type: 'taskboard-task', todo, entryId } })
```

### Plan

#### Step 1: Update TaskboardNode — remove nested DndContext, add data to sortable

In `TaskboardNode.tsx`:
1. **Remove** the `DndContext` wrapper, the `sensors`, `handleDragEnd`, and `reorderKey` state
2. **Keep** the `SortableContext` — it registers with the nearest ancestor DndContext automatically
3. **Namespace sortable IDs** to `tb-${entry.id}` to avoid collisions with project task IDs (`todo-${todoId}`)
4. **Add data** to `useSortable` so the outer context can identify and process these drags

**Before (`TaskboardNode.tsx:137`):**
```tsx
<DndContext key={reorderKey} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
    ...
  </SortableContext>
</DndContext>
```

**After:**
```tsx
<SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
  ...
</SortableContext>
```

Where `entryIds` changes from `visibleEntries.map(e => e.id!)` to `visibleEntries.map(e => \`tb-${e.id}\`)`.

**SortableTaskboardEntry (`TaskboardNode.tsx:55`):**

Before:
```tsx
const { ... } = useSortable({ id: entryId })
```

After:
```tsx
const { ... } = useSortable({
  id: `tb-${entryId}`,
  data: { type: 'taskboard-task', todo, entryId },
})
```

The `todo` prop is already available on `SortableTaskboardEntry` (passed at line 147). The `data.todo` is critical — without it, `handleDragStart` cannot set `activeDragTodo` and the DragOverlay renders nothing.

#### Step 2: Update handleDragStart in `use-canvas-dnd.ts`

The current guard (`use-canvas-dnd.ts:237-238`) reads `active.data.current?.todo`. Since the revised Step 1 adds `todo` to the taskboard sortable's `data`, this guard will succeed for taskboard drags too — `activeDragTodo` will be set correctly.

No code change needed in `handleDragStart` itself. The existing logic at line 237 (`const todo = active.data.current?.todo`) extracts the todo from any drag source that provides it in `data`.

However, verify that multi-selection and child detection behave correctly: taskboard items won't have children (they're flat entries), and multi-selection of taskboard entries should be treated as single drags (taskboard entries aren't in `selectedTodoIds`). The existing code handles this naturally — `sel.has(todo.id)` will be false, and `todos.filter(t => t.parentId === todo.id)` will return an empty array.

#### Step 3: Update handleDragMove in `use-canvas-dnd.ts`

When active type is `taskboard-task`:
- **Over another `taskboard-task` or `taskboard` zone**: Clear insert preview. The `SortableContext` handles visual reorder transforms automatically.
- **Over a `task` or `project`**: Show insert preview (reuse existing preview logic). This lets the user see where the task would land if they wanted to reposition it.
- **Over nothing**: Clear insert preview.

```ts
// In handleDragMove, after reading activeTodo and overData:
const activeType = event.active.data.current?.type

// Hovering over taskboard or taskboard entries — clear insert preview
if (overData?.type === 'taskboard' || overData?.type === 'taskboard-task') {
  setInsertTodoId(null)
  setInsertIndentLevel(0)
  setInsertAtEnd(false)
  setInsertProjectId(null)
  return
}
// ...rest of existing preview logic applies for task/project targets
```

#### Step 4: Update handleDragEnd in `use-canvas-dnd.ts`

This is the most complex change. The current handler at line 375 has a guard: `if (!activeTodo) return`. Since Step 1 adds `todo` to taskboard drag data, this guard passes.

**The critical issue:** The existing `overData?.type === 'taskboard'` check at line 380 currently handles "canvas task dropped onto taskboard → add to taskboard." After our changes, a *taskboard entry* dropped back onto the taskboard zone would also match this check and incorrectly try to `add()` (which would be a silent no-op since the task already exists, but the user's intended reorder would be lost).

**Solution:** Check the *active* drag source type first, before the *over* target type.

```ts
const activeTodo = active.data.current?.todo as PersistedTodoItem | undefined
if (!activeTodo) return

const activeType = active.data.current?.type
const overData = over?.data.current

// ── Taskboard entry being dragged ──
if (activeType === 'taskboard-task') {
  const activeEntryId = active.data.current?.entryId as number

  if (overData?.type === 'taskboard-task') {
    // Dropped on another taskboard entry → reorder
    const overEntryId = overData.entryId as number
    const entries = useTaskboardStore.getState().entries
    const fromIndex = entries.findIndex(e => e.id === activeEntryId)
    const toIndex = entries.findIndex(e => e.id === overEntryId)
    if (fromIndex !== -1 && toIndex !== -1) {
      useTaskboardStore.getState().reorder(fromIndex, toIndex)
    }
    return
  }

  if (overData?.type === 'taskboard') {
    // Dropped on the taskboard zone but not on a specific entry → no-op
    // (pointer landed in a gap between entries or below all entries)
    return
  }

  // Dropped anywhere else (project, task, empty canvas) → remove from taskboard
  await useTaskboardStore.getState().remove(activeTodo.id)
  return
}

// ── Regular task/inset being dragged (existing logic, unchanged) ──
if (overData?.type === 'taskboard') {
  const { add } = useTaskboardStore.getState()
  if (dragIds) {
    for (const id of dragIds) await add(id)
  } else {
    await add(activeTodo.id)
  }
  return
}

// ...rest of existing drop logic (resolveDropTarget, executeDrop)
```

Key design decisions:
- **Drop on `taskboard-task`**: Reorder. Uses `entryId` from both active and over data to find indices in the full entries array (same as the current `handleDragEnd` inside TaskboardNode).
- **Drop on `taskboard` zone (no specific entry)**: No-op. With `pointerWithin` collision detection, this happens when the pointer is in a gap between entries. Treating this as a no-op is safe — the user can retry with a more precise drop. The alternative (computing position from pointer Y) adds complexity for a rare edge case.
- **Drop on anything else** (empty canvas, project, task): Remove from taskboard. The task already belongs to a project on the canvas; dragging it out of the taskboard just removes it from the work queue.

#### Step 5: DragOverlay — no changes needed

The DragOverlay in `CanvasPage.tsx:516-536` renders when `dnd.activeDragTodo` is truthy. Since Step 1 adds `todo` to the taskboard sortable data, and Step 2 confirms `handleDragStart` extracts it via `active.data.current?.todo`, the overlay will render correctly for taskboard drags.

The only prerequisite is that Step 1's `data: { type: 'taskboard-task', todo, entryId }` is correctly implemented. If `todo` is missing from the data, the overlay renders nothing and the user sees the dragged item vanish.

#### Step 6: No reorderKey replacement needed

The current `reorderKey` state (`setReorderKey(k => k + 1)`) forces the nested `DndContext` to remount after each reorder, resetting dnd-kit's internal state. This was needed because the nested context's internal transform tracking could get stale.

With the nested context removed, `SortableContext` computes transforms from its `items` array on each render. When the store's `reorder()` updates the entries (causing a re-render with a new items array), `SortableContext` recomputes correctly. This is the same pattern used by `SortableTaskList` for project tasks — no key-based reset is used there, and reordering works reliably.

If testing reveals stale transform issues, the fallback is to add a `key` prop to the `SortableContext` itself (not a DndContext), derived from the entries order.

### Files to modify

| File | Changes |
|------|---------|
| `src/components/canvas/TaskboardNode.tsx` | Remove nested `DndContext`, `sensors`, `reorderKey`, `handleDragEnd`; namespace sortable IDs to `tb-${id}`; add `data: { type: 'taskboard-task', todo, entryId }` to `useSortable` |
| `src/hooks/use-canvas-dnd.ts` | Add `taskboard-task` active type branch at top of `handleDragEnd` (before existing taskboard drop logic); update `handleDragMove` to clear preview for `taskboard-task` over targets |

### Risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `pointerWithin` resolves to `'taskboard-drop'` zone when pointer is in a gap between entries (instead of nearest entry like `closestCenter` would) | Medium | Treat drop-on-zone as no-op for taskboard-task drags. User retries with more precise drop. Taskboard entries have minimal gaps in practice. |
| SortableContext reorder animation breaks without nested DndContext | Low | SortableContext works with ancestor DndContext — proven by SortableTaskList. If transform issues appear, add `key` to SortableContext. |
| ID collisions between taskboard entries and project tasks | Low | Namespace IDs: `tb-${entryId}` vs `todo-${todoId}`. Different string prefixes guarantee uniqueness. |
| Dragging a taskboard item shows project insert previews when hovering over taskboard entries | Low | In `handleDragMove`, clear insert preview when `overData?.type` is `'taskboard-task'` or `'taskboard'`. |
| Existing `overData?.type === 'taskboard'` handler in `handleDragEnd` triggers for taskboard-entry drags | High | Check `activeType === 'taskboard-task'` **first** and return early before reaching the existing taskboard add logic. Order of branches matters. |
| KeyboardSensor lost for taskboard reordering | Low | The outer context only has `PointerSensor`. Keyboard reordering of taskboard entries stops working. Acceptable — not a core interaction. Can add `KeyboardSensor` to outer context later if needed. |
| `handleDragStart` edge panning starts for taskboard drags | Low | Edge panning during taskboard drags is harmless (only triggers near viewport edges) and may actually help if the user drags to a distant project. No mitigation needed. |

---

## Implementation order

1. **Item 1 first** — self-contained CSS/component change, no DnD architecture changes
2. **Item 2 second** — DnD architecture change that touches the drag handler pipeline

## Testing

- Item 1: Create a list inset, resize height via bottom handle, resize both via corner handle, verify persistence across page reload, verify scrolling with many tasks, verify collapsed state unaffected
- Item 2:
  - **Drag out**: Add tasks to taskboard, drag one off the taskboard onto the canvas background → verify removed from taskboard, task still in its project
  - **Reorder**: Drag a taskboard entry onto another entry → verify reorder persists
  - **Drop in gap**: Drag a taskboard entry to a gap between entries → verify no-op (item returns to original position)
  - **Drag to taskboard**: Drag a project task onto the taskboard → verify still adds to taskboard (existing behavior preserved)
  - **DragOverlay**: While dragging a taskboard entry, verify the ghost TaskRow overlay renders correctly
  - **Multi-drag**: Select multiple tasks, drag one to taskboard → verify multi-add still works
