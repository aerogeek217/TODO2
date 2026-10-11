/**
 * `dispatchTaskDrop` branch coverage. The dispatcher doesn't look at the
 * source surface (it reads `active.data.current.todo` and the drop target's
 * `data.type`), so covering each branch once pins the contract every surface
 * relies on:
 *   - calendar-day target → reschedule
 *   - any other target (or none) → not handled; the caller's own route-level
 *     handler runs
 */

import { describe, it, expect, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  dispatchTaskDrop,
  taskDragId,
} from '../../../utils/task-dnd'
import { makeTodo } from '../../helpers'

function makeEvent(opts: {
  activeId?: string
  activeTodoId: number
  over?: { id: string; type: string; extra?: Record<string, unknown> } | null
}): DragEndEvent {
  const todo = makeTodo({ id: opts.activeTodoId })
  return {
    active: {
      id: opts.activeId ?? 'active',
      data: { current: { type: TASK_DRAG_KIND.task, todo } },
      rect: { current: { initial: null, translated: null } },
    },
    over: opts.over
      ? { id: opts.over.id, data: { current: { type: opts.over.type, ...(opts.over.extra ?? {}) } } }
      : null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent
}

describe('dispatchTaskDrop — calendar day drops', () => {
  it('reschedules when dragged from one calendar surface onto another', async () => {
    const reschedule = vi.fn(async () => {})
    const date = new Date(2026, 4, 15)
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: taskDragId('calendar-strip', 7),
        activeTodoId: 7,
        over: { id: 'calday-view-1715731200000', type: TASK_DROP_KIND.calendarDay, extra: { date } },
      }),
      { calendar: { reschedule } },
    )
    expect(handled).toBe(true)
    expect(reschedule).toHaveBeenCalledWith(7, date)
  })

  it('a list widget row dropped on a day is rescheduled', async () => {
    const reschedule = vi.fn(async () => {})
    const date = new Date(2026, 9, 20)
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: taskDragId('list-widget', 3, { scope: 't1', sectionKey: 'all' }),
        activeTodoId: 3,
        over: { id: 'calday-ws-0', type: TASK_DROP_KIND.calendarDay, extra: { date } },
      }),
      { calendar: { reschedule } },
    )
    expect(handled).toBe(true)
    expect(reschedule).toHaveBeenCalledWith(3, date)
  })

  it('without a calendar op the day drop falls through to the caller', async () => {
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 3,
        over: { id: 'calday-x-0', type: TASK_DROP_KIND.calendarDay, extra: { date: new Date(2026, 0, 1) } },
      }),
      {},
    )
    expect(handled).toBe(false)
  })

  it('a day target without a Date is not handled', async () => {
    const reschedule = vi.fn(async () => {})
    const handled = await dispatchTaskDrop(
      makeEvent({ activeTodoId: 3, over: { id: 'calday-x-0', type: TASK_DROP_KIND.calendarDay } }),
      { calendar: { reschedule } },
    )
    expect(handled).toBe(false)
    expect(reschedule).not.toHaveBeenCalled()
  })
})

describe('dispatchTaskDrop — other targets fall through', () => {
  it('over=null is not handled', async () => {
    const reschedule = vi.fn(async () => {})
    const handled = await dispatchTaskDrop(makeEvent({ activeTodoId: 99, over: null }), { calendar: { reschedule } })
    expect(handled).toBe(false)
    expect(reschedule).not.toHaveBeenCalled()
  })

  it('a ListView section drop returns false so ListView\'s own section-reassign runs', async () => {
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 1,
        over: { id: 'list-section-project-5', type: TASK_DROP_KIND.listSection, extra: { sectionKey: 'project:5' } },
      }),
      { calendar: { reschedule: vi.fn(async () => {}) } },
    )
    expect(handled).toBe(false)
  })
})

describe('dispatchTaskDrop — degenerate inputs', () => {
  it('returns false when active has no todo', async () => {
    const reschedule = vi.fn(async () => {})
    const event = {
      active: {
        id: 'active',
        data: { current: { type: TASK_DRAG_KIND.task } }, // no todo
        rect: { current: { initial: null, translated: null } },
      },
      over: { id: 'calday-x-0', data: { current: { type: TASK_DROP_KIND.calendarDay, date: new Date() } } },
      delta: { x: 0, y: 0 },
    } as unknown as DragEndEvent
    const handled = await dispatchTaskDrop(event, { calendar: { reschedule } })
    expect(handled).toBe(false)
    expect(reschedule).not.toHaveBeenCalled()
  })
})
