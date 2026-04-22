import { describe, it, expect, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  dispatchTaskDrop,
  type TaskboardOps,
} from '../../../utils/task-dnd'
import { makeTodo } from '../../helpers'

function noopTaskboard(): TaskboardOps {
  return {
    board: null,
    getEntries: () => [],
    ensureLoaded: async () => ({ id: 1, entries: [], createdAt: new Date(), updatedAt: new Date() }),
    has: () => false,
    reorder: vi.fn(async () => {}),
    removeEntry: vi.fn(async () => {}),
    addAt: vi.fn(async () => {}),
    addMultipleAt: vi.fn(async () => {}),
  }
}

function makeEvent(opts: {
  activeTodoId: number
  activeType?: string
  overType?: string
  overData?: Record<string, unknown>
}): DragEndEvent {
  const todo = makeTodo({ id: opts.activeTodoId })
  return {
    active: {
      id: 'active',
      data: { current: { type: opts.activeType ?? TASK_DRAG_KIND.task, todo } },
      rect: { current: { initial: null, translated: null } },
    },
    over: opts.overType
      ? {
        id: 'over',
        data: { current: { type: opts.overType, ...opts.overData } },
      }
      : null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent
}

describe('dispatchTaskDrop — calendar-day branch', () => {
  it('calls calendar.reschedule with the todo id and target date when over is a calendar-day', async () => {
    const reschedule = vi.fn(async () => {})
    const date = new Date(2026, 3, 22)
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 11,
        activeType: TASK_DRAG_KIND.task,
        overType: TASK_DROP_KIND.calendarDay,
        overData: { date },
      }),
      {
        taskboard: noopTaskboard(),
        calendar: { reschedule },
      },
    )
    expect(handled).toBe(true)
    expect(reschedule).toHaveBeenCalledTimes(1)
    expect(reschedule).toHaveBeenCalledWith(11, date)
  })

  it('taskboard-task dropped onto calendar-day reschedules (does NOT remove from board)', async () => {
    const reschedule = vi.fn(async () => {})
    const tb = noopTaskboard()
    const date = new Date(2026, 3, 23)
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 42,
        activeType: TASK_DRAG_KIND.taskboardTask,
        overType: TASK_DROP_KIND.calendarDay,
        overData: { date },
      }),
      {
        taskboard: tb,
        calendar: { reschedule },
      },
    )
    expect(handled).toBe(true)
    expect(reschedule).toHaveBeenCalledWith(42, date)
    expect(tb.removeEntry).not.toHaveBeenCalled()
  })

  it('ignores calendar-day drop when no calendar op is supplied', async () => {
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 7,
        activeType: TASK_DRAG_KIND.task,
        overType: TASK_DROP_KIND.calendarDay,
        overData: { date: new Date(2026, 3, 22) },
      }),
      { taskboard: noopTaskboard() },
    )
    // Falls through → false so the caller's own handler can take it.
    expect(handled).toBe(false)
  })

  it('ignores calendar-day drop when overData.date is malformed', async () => {
    const reschedule = vi.fn(async () => {})
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 5,
        overType: TASK_DROP_KIND.calendarDay,
        overData: { date: 'not-a-date' },
      }),
      {
        taskboard: noopTaskboard(),
        calendar: { reschedule },
      },
    )
    expect(reschedule).not.toHaveBeenCalled()
    expect(handled).toBe(false)
  })
})
