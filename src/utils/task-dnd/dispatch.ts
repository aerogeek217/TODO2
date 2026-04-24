import type { DragEndEvent } from '@dnd-kit/core'
import type { PersistedTodoItem, Taskboard, TaskboardEntry } from '../../models'
import { parseTaskboardEntryId } from './ids'
import { TASK_DRAG_KIND, TASK_DROP_KIND } from './kinds'

/**
 * Shape of the taskboard-store surface consumed by {@link dispatchTaskDrop}.
 * Kept narrow — just the methods needed to reorder entries, remove an entry,
 * and add at an index — so callers can pass `useTaskboardStore.getState()`
 * directly or mock the adapter in tests.
 */
export interface TaskboardOps {
  readonly board: Taskboard | null
  getEntries: () => TaskboardEntry[]
  ensureLoaded: () => Promise<Taskboard>
  has: (todoId: number) => boolean
  reorder: (fromIndex: number, toIndex: number) => Promise<void>
  removeEntry: (todoId: number) => Promise<void>
  addAt: (todoId: number, index: number) => Promise<void>
  addMultipleAt: (todoIds: number[], index: number) => Promise<void>
}

/**
 * Narrow reschedule surface consumed by the calendar-day branch of
 * {@link dispatchTaskDrop}. Callers supply whatever store plumbing they want
 * (typically `useTodoStore` + `buildRescheduleUpdate`); the dispatch only
 * cares about the single callback.
 */
export interface CalendarOps {
  reschedule: (todoId: number, targetDate: Date) => Promise<void>
}

export interface TaskDropDispatchDeps {
  taskboard: TaskboardOps
  /** Optional — required by surfaces that host calendar day droppables
   * (canvas rails/floating strips, the `/calendar` route). When omitted,
   * calendar-day drops fall through to the caller's own handler. */
  calendar?: CalendarOps
  /** Multi-drag selection (when present with >1 ids, `addMultipleAt` fires
   * instead of `addAt`). Canvas supplies this from its selection ref;
   * dashboard passes `null` because it doesn't support multi-drag today. */
  multiDragIds?: ReadonlySet<number> | null
}

/**
 * Map a hover-over-sortable-entry into its slot in the *full* entries array.
 * dnd-kit sortable data gives a visible index only; if the taskboard has
 * hidden/completed entries filtered out, we need to map the visible position
 * back to the full array before calling `addAt`. Returns `fullEntries.length`
 * (append) when the parse fails — matches the "safe append" fallback baked
 * into `addAt` / `addMultipleAt`.
 */
function fullIndexForSortableDrop(
  overId: string,
  fullEntries: readonly { todoId: number }[],
): number {
  const parsed = parseTaskboardEntryId(overId)
  if (parsed == null) return fullEntries.length
  const idx = fullEntries.findIndex((e) => e.todoId === parsed.todoId)
  return idx === -1 ? fullEntries.length : idx
}

/**
 * Shared drop dispatcher for task-shaped drags that target a taskboard. Owns
 * the three taskboard-specific branches for `use-canvas-dnd.ts:handleDragEnd`:
 *
 *   1. Taskboard entry dragged onto another entry → reorder.
 *   2. Taskboard entry dragged onto the panel's outer drop zone → move to end.
 *   3. Taskboard entry dropped anywhere else → remove from the board.
 *   4. External task dropped onto a taskboard (entry or panel) → add at the
 *      insertion index implied by dnd-kit's sortable data.
 *
 * Returns `true` when the drop was handled (the caller should stop
 * processing), `false` when the drag/drop has nothing to do with a taskboard
 * (the caller should continue with its route-specific logic — e.g. canvas
 * project placement).
 *
 * Phase 5 of the DnD unification extracted this from the two call sites;
 * Phase 6 replaced the DOM-based insertion index with dnd-kit's native
 * sortable index so indicator + drop always agree and the "missing DOM →
 * prepend" failure mode from F3 disappears.
 */
export async function dispatchTaskDrop(
  event: DragEndEvent,
  deps: TaskDropDispatchDeps,
): Promise<boolean> {
  const { active, over } = event
  const activeTodo = active.data.current?.todo as PersistedTodoItem | undefined
  if (!activeTodo) return false

  const activeType = active.data.current?.type
  const overData = over?.data.current
  const tb = deps.taskboard

  // ── Calendar day drop → reschedule ──
  // Handled before the taskboard-entry branch so dragging an entry onto a
  // calendar day reschedules the underlying todo (and keeps the entry on
  // the board) instead of falling into the "dropped anywhere else → remove"
  // path below.
  if (overData?.type === TASK_DROP_KIND.calendarDay && deps.calendar) {
    const date = overData.date as Date | undefined
    if (date instanceof Date) {
      await deps.calendar.reschedule(activeTodo.id, date)
      return true
    }
  }

  // ── Taskboard entry being dragged ──
  if (activeType === TASK_DRAG_KIND.taskboardTask) {
    if (overData?.type === TASK_DROP_KIND.taskboardTask && over?.id != null) {
      // `over.id` is the sortable id (e.g. `tbp-42` or `tb-7-42`); parse it
      // into its todo id so we can resolve the full-array target index
      // regardless of which taskboard panel owns the over entry. A malformed
      // id (e.g. `tbp-NaN`) means this isn't a real taskboard drop — bail out
      // so the caller can fall through to its route-specific handler.
      const parsed = parseTaskboardEntryId(String(over.id))
      if (parsed == null) return false
      const entries = tb.getEntries()
      const fromIndex = entries.findIndex((e) => e.todoId === activeTodo.id)
      const toIndex = entries.findIndex((e) => e.todoId === parsed.todoId)
      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        await tb.reorder(fromIndex, toIndex)
      }
      return true
    }
    if (overData?.type === TASK_DROP_KIND.taskboard) {
      const entries = tb.getEntries()
      const fromIndex = entries.findIndex((e) => e.todoId === activeTodo.id)
      if (fromIndex !== -1 && fromIndex !== entries.length - 1) {
        await tb.reorder(fromIndex, entries.length - 1)
      }
      return true
    }
    // Dropped anywhere else → remove from the singleton board.
    if (tb.has(activeTodo.id)) await tb.removeEntry(activeTodo.id)
    return true
  }

  // ── External task → taskboard add ──
  if (overData?.type === TASK_DROP_KIND.taskboard || overData?.type === TASK_DROP_KIND.taskboardTask) {
    if (!tb.board) await tb.ensureLoaded()
    const entries = tb.getEntries()
    const targetIndex = overData?.type === TASK_DROP_KIND.taskboardTask && over?.id != null
      ? fullIndexForSortableDrop(String(over.id), entries)
      : entries.length
    const ids = deps.multiDragIds
    if (ids && ids.size > 1) {
      await tb.addMultipleAt([...ids], targetIndex)
    } else {
      await tb.addAt(activeTodo.id, targetIndex)
    }
    return true
  }

  return false
}
