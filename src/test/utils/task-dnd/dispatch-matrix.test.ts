/**
 * Phase 10 regression suite — `dispatchTaskDrop` branch coverage.
 *
 * The per-surface (source, target) cells in `dnd-audit.md §7` all funnel
 * through `dispatchTaskDrop` post-Phase 5. The dispatcher doesn't look at the
 * source surface (it reads `active.data.current.type`), so matrix coverage at
 * the unit layer collapses to covering every branch of the dispatcher — once
 * per branch is enough to pin the contract every surface relies on.
 *
 * Branches covered below:
 *   - calendar-day target (plain task + taskboard-task rescheduling keeps the
 *     entry on the board)
 *   - taskboard-task reorder on the same panel (singleton ↔ singleton)
 *   - taskboard-task reorder *across* surfaces (singleton ↔ floating, Phase 8)
 *   - taskboard-task dropped onto the outer taskboard container (move to end)
 *   - taskboard-task dropped anywhere else (remove from board)
 *   - external task → taskboard entry (sortable index in full array)
 *   - external task → taskboard panel (append to end)
 *   - external task → taskboard with multi-drag (addMultipleAt)
 *   - F3 target-panel-unmount-mid-drag scenarios (no silent prepend)
 *   - visible-to-full index mapping respects hidden entries (no shift-up)
 */

import { describe, it, expect, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  TASKBOARD_SINGLETON_DROP_ID,
  dispatchTaskDrop,
  taskDragId,
  taskboardFloatDropId,
  type TaskboardOps,
} from '../../../utils/task-dnd'
import { makeTodo } from '../../helpers'
import type { Taskboard, TaskboardEntry } from '../../../models'

// ─── Helpers ─────────────────────────────────────────────────────────

/** Shorthand: entries are usually passed as `{ todoId }` only. This promotes
 * a bare-id array into the full `TaskboardEntry` shape with ascending
 * sortOrders so the list type-checks against the store's interface. */
function entriesFromIds(ids: number[]): TaskboardEntry[] {
  return ids.map((todoId, idx) => ({ todoId, sortOrder: (idx + 1) * 1000 }))
}

/** A taskboard with a fixed-order entry list. Mirrors `useTaskboardStore`'s
 * adapter shape — callers mutate the backing array directly to simulate
 * addAt/reorder/removeEntry behavior. */
function taskboardOps(initial: number[] = []): TaskboardOps & {
  entries: TaskboardEntry[]
} {
  const entries: TaskboardEntry[] = entriesFromIds(initial)
  const board: Taskboard = {
    id: 1,
    entries,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Taskboard
  return {
    entries,
    get board() { return board },
    getEntries: () => entries,
    ensureLoaded: vi.fn(async () => board),
    has: (todoId: number) => entries.some((e) => e.todoId === todoId),
    reorder: vi.fn(async (from: number, to: number) => {
      const [moved] = entries.splice(from, 1)
      entries.splice(to, 0, moved!)
    }),
    removeEntry: vi.fn(async (todoId: number) => {
      const idx = entries.findIndex((e) => e.todoId === todoId)
      if (idx !== -1) entries.splice(idx, 1)
    }),
    addAt: vi.fn(async (todoId: number, index: number) => {
      const sortOrder = (entries.length + 1) * 1000
      entries.splice(index, 0, { todoId, sortOrder })
    }),
    addMultipleAt: vi.fn(async (todoIds: number[], index: number) => {
      const base = entries.length
      entries.splice(
        index,
        0,
        ...todoIds.map((todoId, i) => ({ todoId, sortOrder: (base + i + 1) * 1000 })),
      )
    }),
  }
}

function makeEvent(opts: {
  activeId?: string
  activeTodoId: number
  activeType?: string
  over?: { id: string; type: string; extra?: Record<string, unknown> } | null
}): DragEndEvent {
  const todo = makeTodo({ id: opts.activeTodoId })
  return {
    active: {
      id: opts.activeId ?? 'active',
      data: { current: { type: opts.activeType ?? TASK_DRAG_KIND.task, todo } },
      rect: { current: { initial: null, translated: null } },
    },
    over: opts.over
      ? { id: opts.over.id, data: { current: { type: opts.over.type, ...(opts.over.extra ?? {}) } } }
      : null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent
}

// ─── External-task → taskboard (add) ─────────────────────────────────

describe('dispatchTaskDrop — external task → taskboard add', () => {
  it('dropped on a taskboard entry: inserts at that entry\'s full-array index', async () => {
    // Target panel has entries [10, 20, 30]. Drop 42 over the middle entry
    // (sortable id tbp-20). Expectation: 42 lands at index 1.
    const tb = taskboardOps([10, 20, 30])
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 42,
        over: { id: 'tbp-20', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(true)
    expect(tb.addAt).toHaveBeenCalledWith(42, 1)
    expect(tb.addMultipleAt).not.toHaveBeenCalled()
  })

  it('dropped on the taskboard panel container: appends to end', async () => {
    const tb = taskboardOps([10, 20])
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 42,
        over: { id: TASKBOARD_SINGLETON_DROP_ID, type: TASK_DROP_KIND.taskboard },
      }),
      { taskboard: tb },
    )
    // Insertion index === entries.length (append).
    expect(tb.addAt).toHaveBeenCalledWith(42, 2)
  })

  it('dropped on a floating taskboard entry: routes through the same reducer (Phase 8)', async () => {
    const tb = taskboardOps([10, 20])
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 77,
        over: { id: taskDragId('taskboard-float', 10, { floatingId: 7 }), type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(tb.addAt).toHaveBeenCalledWith(77, 0)
  })

  it('multi-drag → addMultipleAt at entry index', async () => {
    const tb = taskboardOps([10, 20, 30])
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 40,
        over: { id: 'tbp-20', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb, multiDragIds: new Set([40, 41, 42]) },
    )
    expect(tb.addMultipleAt).toHaveBeenCalledWith([40, 41, 42], 1)
    expect(tb.addAt).not.toHaveBeenCalled()
  })

  it('single-id selection set falls through to addAt (not addMultipleAt)', async () => {
    const tb = taskboardOps([10])
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 40,
        over: { id: TASKBOARD_SINGLETON_DROP_ID, type: TASK_DROP_KIND.taskboard },
      }),
      { taskboard: tb, multiDragIds: new Set([40]) },
    )
    expect(tb.addAt).toHaveBeenCalledWith(40, 1)
    expect(tb.addMultipleAt).not.toHaveBeenCalled()
  })

  it('ensureLoaded fires before computing target index when board is null', async () => {
    const tb: TaskboardOps = {
      board: null,
      getEntries: () => [],
      ensureLoaded: vi.fn(async () => ({
        id: 1, entries: [], createdAt: new Date(), updatedAt: new Date(),
      })),
      has: () => false,
      reorder: vi.fn(async () => {}),
      removeEntry: vi.fn(async () => {}),
      addAt: vi.fn(async () => {}),
      addMultipleAt: vi.fn(async () => {}),
    }
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 5,
        over: { id: TASKBOARD_SINGLETON_DROP_ID, type: TASK_DROP_KIND.taskboard },
      }),
      { taskboard: tb },
    )
    expect(tb.ensureLoaded).toHaveBeenCalledTimes(1)
  })
})

// ─── Taskboard entry drags ───────────────────────────────────────────

describe('dispatchTaskDrop — taskboard entry drags', () => {
  it('reorders within the singleton panel', async () => {
    // entries: [10, 20, 30]. Drag id tbp-10 onto tbp-30 → reorder(0, 2).
    const tb = taskboardOps([10, 20, 30])
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-10',
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: { id: 'tbp-30', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(true)
    expect(tb.reorder).toHaveBeenCalledWith(0, 2)
    expect(tb.removeEntry).not.toHaveBeenCalled()
  })

  it('no-ops when dragged onto itself (same index)', async () => {
    const tb = taskboardOps([10, 20])
    await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-10',
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: { id: 'tbp-10', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(tb.reorder).not.toHaveBeenCalled()
  })

  it('cross-taskboard reorder: floating-node entry dropped on singleton entry (Phase 8)', async () => {
    // Phase 8 claim: cross-taskboard (singleton ↔ floating) drops are free
    // after Phase 6 because both surfaces are `kind: 'taskboard-task'` in the
    // same singleton store. `dispatchTaskDrop` parses the todoId out of either
    // prefix; the reorder operates on the one shared entry list.
    const tb = taskboardOps([10, 20, 30])
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: taskDragId('taskboard-float', 10, { floatingId: 7 }),
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: { id: 'tbp-30', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(true)
    expect(tb.reorder).toHaveBeenCalledWith(0, 2)
  })

  it('cross-taskboard reorder: singleton entry dropped on floating entry (Phase 8)', async () => {
    const tb = taskboardOps([10, 20, 30])
    await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-30',
        activeTodoId: 30,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: { id: taskDragId('taskboard-float', 10, { floatingId: 7 }), type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(tb.reorder).toHaveBeenCalledWith(2, 0)
  })

  it('moves to end when dropped on the taskboard panel container', async () => {
    const tb = taskboardOps([10, 20, 30])
    await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-10',
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: { id: taskboardFloatDropId(7), type: TASK_DROP_KIND.taskboard },
      }),
      { taskboard: tb },
    )
    // Move the source entry to entries.length - 1 (end).
    expect(tb.reorder).toHaveBeenCalledWith(0, 2)
  })

  it('removes from board when dropped anywhere else (no over)', async () => {
    const tb = taskboardOps([10, 20])
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-10',
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: null,
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(true)
    expect(tb.removeEntry).toHaveBeenCalledWith(10)
  })

  it('remove-on-drop-off is a no-op when the entry isn\'t on the board', async () => {
    const tb = taskboardOps([20]) // no 10
    await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-10',
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: null,
      }),
      { taskboard: tb },
    )
    expect(tb.removeEntry).not.toHaveBeenCalled()
  })

  it('taskboard-task reorder with unparseable over.id returns false (no silent no-op)', async () => {
    // L12 / M6: the reorder branch used to parse the over.id into a todo id
    // and coalesce a failed parse to `NaN`, silently no-op'ing the reorder
    // and returning `true` — swallowing the drop entirely. Post-M6 a malformed
    // id (e.g. `tbp-NaN`) falls through to `return false` so the caller's
    // route-specific handler can run instead.
    const tb = taskboardOps([10, 20, 30])
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-10',
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: { id: 'tbp-NaN', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(false)
    expect(tb.reorder).not.toHaveBeenCalled()
    expect(tb.removeEntry).not.toHaveBeenCalled()
  })
})

// ─── F3: target panel unmount mid-drag ───────────────────────────────

describe('dispatchTaskDrop — F3 target-panel-unmount regression', () => {
  // F3 in dnd-audit: pre-Phase 6, a missing taskboard DOM element caused
  // `computeTaskboardInsertIndex` to return 0 → silent prepend. Phase 6
  // replaced that DOM query with dnd-kit's native sortable data, so a target
  // panel that unmounts mid-drag produces `over: null` (no silent prepend).
  //
  // These tests codify the post-Phase-6 contract:
  //   1. Plain `kind: 'task'` drag onto nothing → dispatcher returns false
  //      (caller keeps its own route-level fallback; no taskboard mutation).
  //   2. `kind: 'taskboard-task'` drag onto nothing → remove from board
  //      (explicit, not a silent prepend).

  it('plain task drag with over=null does NOT add to the taskboard silently', async () => {
    const tb = taskboardOps([10])
    const handled = await dispatchTaskDrop(
      makeEvent({ activeTodoId: 99, over: null }),
      { taskboard: tb },
    )
    expect(handled).toBe(false)
    expect(tb.addAt).not.toHaveBeenCalled()
    expect(tb.addMultipleAt).not.toHaveBeenCalled()
    expect(tb.reorder).not.toHaveBeenCalled()
  })

  it('plain task drag onto a non-taskboard over falls through', async () => {
    const tb = taskboardOps()
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 99,
        // Simulate ListView's `list-section` droppable — dispatcher does not
        // own that branch; caller handles it.
        over: { id: 'list-section-project-5', type: 'list-section' },
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(false)
    expect(tb.addAt).not.toHaveBeenCalled()
  })

  it('taskboard-task with over=null removes (never prepends)', async () => {
    const tb = taskboardOps([10])
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-10',
        activeTodoId: 10,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: null,
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(true)
    expect(tb.removeEntry).toHaveBeenCalledWith(10)
    expect(tb.addAt).not.toHaveBeenCalled()
    expect(tb.reorder).not.toHaveBeenCalled()
  })

  it('external task dropped on a taskboard-task with a stale over.id falls back to append', async () => {
    // Simulates a target entry that was removed between drag-over and drop
    // (e.g. the panel reflowed / hid a completed entry). The over.id still
    // points at it; full-index lookup fails; dispatcher appends rather than
    // prepending silently — mirrors fullIndexForSortableDrop fallback.
    const tb = taskboardOps([10, 20])
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 99,
        over: { id: 'tbp-999', type: TASK_DROP_KIND.taskboardTask }, // 999 not in entries
      }),
      { taskboard: tb },
    )
    // append at entries.length, not prepend at 0.
    expect(tb.addAt).toHaveBeenCalledWith(99, 2)
  })

  it('external task dropped on an unparseable taskboard-task id falls back to append', async () => {
    const tb = taskboardOps([10, 20])
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 99,
        over: { id: 'not-a-taskboard-entry-id', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(tb.addAt).toHaveBeenCalledWith(99, 2)
  })
})

// ─── Indicator/drop invariants ──────────────────────────────────────

describe('dispatchTaskDrop — visible vs full entry mapping', () => {
  // After Phase 6 the insertion index comes from dnd-kit's sortable data,
  // which knows about ALL entries in the sortable — not just visible ones.
  // But the full array stored by the taskboard may include completed or
  // hidden-status rows that the UI filters out. `fullIndexForSortableDrop`
  // maps the over.id back to its slot in the full array so the drop lands
  // exactly at the indicated row, even when completed entries sit above it.

  it('dropping on an entry below a hidden/completed entry resolves to its full-array index', async () => {
    // Full: [10 (visible), 20 (hidden), 30 (visible)]
    // User drags 99 over the second visible row (todo 30). over.id is tbp-30.
    // Pre-Phase-6 this returned a visible index of 1; addAt(99, 1) inserted
    // ABOVE the hidden entry 20, landing 99 between 10 and 20. Post-Phase-6
    // the dispatcher maps tbp-30 → full index 2 so 99 lands between 20 and
    // 30, matching the indicator.
    const tb = taskboardOps([10, 20, 30])
    await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 99,
        over: { id: 'tbp-30', type: TASK_DROP_KIND.taskboardTask },
      }),
      { taskboard: tb },
    )
    expect(tb.addAt).toHaveBeenCalledWith(99, 2)
    expect(tb.entries.map((e) => e.todoId)).toEqual([10, 20, 99, 30])
  })
})

// ─── Phase 8 ListView droppable pass-through ─────────────────────────

describe('dispatchTaskDrop — ListView section drops (Phase 8)', () => {
  // Phase 8 renamed ListView's section droppable from `type: 'section'` to
  // `TASK_DROP_KIND.listSection = 'list-section'`. Intra-list rebucket is
  // still handled by ListView itself (section-reassign mutates
  // projectId/statusId/person assignment), not by `dispatchTaskDrop`. The
  // dispatcher must return false so ListView's handler runs.
  it('returns false so ListView\'s own section-reassign runs', async () => {
    const tb = taskboardOps()
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 1,
        over: { id: 'list-section-project-5', type: TASK_DROP_KIND.listSection, extra: { sectionKey: 'project:5' } },
      }),
      { taskboard: tb },
    )
    expect(handled).toBe(false)
    expect(tb.addAt).not.toHaveBeenCalled()
  })
})

// ─── Calendar extra: strip source ───────────────────────────────────

describe('dispatchTaskDrop — calendar cross-surface drops', () => {
  // CalendarStrip row dragged onto a CalendarView day (matrix §7 — pre-Phase 7
  // failed because the view read from an internal ref the strip couldn't set;
  // post-Phase 7 both live on `kind: 'task'` with `calendar-day` droppables so
  // this works through the shared dispatcher without a per-surface branch).
  it('reschedules when dragged from one calendar surface onto another', async () => {
    const reschedule = vi.fn(async () => {})
    const date = new Date(2026, 4, 15)
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: taskDragId('calendar-strip', 7),
        activeTodoId: 7,
        over: { id: 'calday-view-1715731200000', type: TASK_DROP_KIND.calendarDay, extra: { date } },
      }),
      {
        taskboard: taskboardOps(),
        calendar: { reschedule },
      },
    )
    expect(handled).toBe(true)
    expect(reschedule).toHaveBeenCalledWith(7, date)
  })

  it('taskboard-task dragged on a calendar day: reschedule, no remove-from-board', async () => {
    // Proves the calendar-day branch runs BEFORE the taskboard-task branch
    // so an entry dragged onto the mini-calendar is rescheduled, not removed.
    const reschedule = vi.fn(async () => {})
    const tb = taskboardOps([7])
    await dispatchTaskDrop(
      makeEvent({
        activeId: 'tbp-7',
        activeTodoId: 7,
        activeType: TASK_DRAG_KIND.taskboardTask,
        over: { id: 'calday-view-0', type: TASK_DROP_KIND.calendarDay, extra: { date: new Date(2026, 0, 1) } },
      }),
      {
        taskboard: tb,
        calendar: { reschedule },
      },
    )
    expect(reschedule).toHaveBeenCalled()
    expect(tb.removeEntry).not.toHaveBeenCalled()
  })
})

// ─── Edge cases ──────────────────────────────────────────────────────

describe('dispatchTaskDrop — degenerate inputs', () => {
  it('returns false when active has no todo', async () => {
    const event = {
      active: {
        id: 'active',
        data: { current: { type: TASK_DRAG_KIND.task } }, // no todo
        rect: { current: { initial: null, translated: null } },
      },
      over: { id: TASKBOARD_SINGLETON_DROP_ID, data: { current: { type: TASK_DROP_KIND.taskboard } } },
      delta: { x: 0, y: 0 },
    } as unknown as DragEndEvent
    const tb = taskboardOps()
    const handled = await dispatchTaskDrop(event, { taskboard: tb })
    expect(handled).toBe(false)
    expect(tb.addAt).not.toHaveBeenCalled()
  })
})
