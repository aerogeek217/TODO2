/**
 * `dispatchTaskDrop` branch coverage. The dispatcher doesn't look at the
 * source surface (it reads `active.data.current.todo` and the drop target's
 * `data.type`), so covering each branch once pins the contract every surface
 * relies on:
 *   - calendar-day target → reschedule (which date: the entry's own, the
 *     one the calendar shows, or the user's pick when it shows both)
 *   - Eisenhower quadrant target → the quadrant's flags
 *   - any other target (or none) → not handled; the caller's own
 *     handler runs
 */

import { describe, it, expect, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  dispatchTaskDrop,
  resolveCalendarDropType,
  taskDragId,
  type TaskDropKind,
} from '../../../utils/task-dnd'
import { makeTodo } from '../../helpers'

function makeEvent(opts: {
  activeId?: string
  activeTodoId: number
  /** Extra drag data (e.g. a calendar entry's `calendarDateType`). */
  activeExtra?: Record<string, unknown>
  /** Where the drag started (viewport); the drop point adds `delta`. */
  start?: { x: number; y: number }
  delta?: { x: number; y: number }
  over?: { id: string; type: string; extra?: Record<string, unknown> } | null
}): DragEndEvent {
  const todo = makeTodo({ id: opts.activeTodoId })
  return {
    active: {
      id: opts.activeId ?? 'active',
      data: { current: { ...opts.activeExtra, type: TASK_DRAG_KIND.task, todo } },
      rect: { current: { initial: null, translated: null } },
    },
    activatorEvent: opts.start ? { clientX: opts.start.x, clientY: opts.start.y } : null,
    over: opts.over
      ? { id: opts.over.id, data: { current: { type: opts.over.type, ...(opts.over.extra ?? {}) } } }
      : null,
    delta: opts.delta ?? { x: 0, y: 0 },
  } as unknown as DragEndEvent
}

describe('dispatchTaskDrop — calendar day drops', () => {
  const dueOnly = { due: true, followup: false }

  it('a calendar entry dropped on another calendar\'s day moves its own date', async () => {
    const reschedule = vi.fn(async () => {})
    const chooseType = vi.fn(async () => 'followup' as const)
    const date = new Date(2026, 4, 15)
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: taskDragId('calendar-widget', 7, { scope: 't1', sectionKey: 'due' }),
        activeTodoId: 7,
        activeExtra: { calendarDateType: 'due' },
        over: { id: 'calday-t2-1715731200000', type: TASK_DROP_KIND.calendarDay, extra: { date, scope: 't2', dateTypes: { due: true, followup: true } } },
      }),
      { calendar: { reschedule, chooseType } },
    )
    expect(handled).toBe(true)
    expect(reschedule).toHaveBeenCalledWith(7, date, 'due')
    expect(chooseType).not.toHaveBeenCalled()
  })

  it('a list widget row dropped on a day is rescheduled', async () => {
    const reschedule = vi.fn(async () => {})
    const date = new Date(2026, 9, 20)
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeId: taskDragId('list-widget', 3, { scope: 't1', sectionKey: 'all' }),
        activeTodoId: 3,
        over: { id: 'calday-ws-0', type: TASK_DROP_KIND.calendarDay, extra: { date, dateTypes: dueOnly } },
      }),
      { calendar: { reschedule } },
    )
    expect(handled).toBe(true)
    expect(reschedule).toHaveBeenCalledWith(3, date, 'due')
  })

  it('without a calendar op the day drop falls through to the caller', async () => {
    const handled = await dispatchTaskDrop(
      makeEvent({
        activeTodoId: 3,
        over: { id: 'calday-x-0', type: TASK_DROP_KIND.calendarDay, extra: { date: new Date(2026, 0, 1), dateTypes: dueOnly } },
      }),
      {},
    )
    expect(handled).toBe(false)
  })

  it('a day target without a Date is not handled', async () => {
    const reschedule = vi.fn(async () => {})
    const handled = await dispatchTaskDrop(
      makeEvent({ activeTodoId: 3, over: { id: 'calday-x-0', type: TASK_DROP_KIND.calendarDay, extra: { dateTypes: dueOnly } } }),
      { calendar: { reschedule } },
    )
    expect(handled).toBe(false)
    expect(reschedule).not.toHaveBeenCalled()
  })

  it('a day target without the date types it shows is not handled', async () => {
    const reschedule = vi.fn(async () => {})
    const handled = await dispatchTaskDrop(
      makeEvent({ activeTodoId: 3, over: { id: 'calday-x-0', type: TASK_DROP_KIND.calendarDay, extra: { date: new Date(2026, 0, 1) } } }),
      { calendar: { reschedule } },
    )
    expect(handled).toBe(false)
    expect(reschedule).not.toHaveBeenCalled()
  })
})

describe('dispatchTaskDrop — which date a day drop sets', () => {
  const date = new Date(2026, 9, 13)
  const day = (dateTypes: { due: boolean; followup: boolean }) => ({
    id: 'calday-ws-t-1', type: TASK_DROP_KIND.calendarDay, extra: { date, scope: 'ws-t', dateTypes },
  })

  it('a calendar showing only follow-ups sets the follow-up', async () => {
    const reschedule = vi.fn(async () => {})
    const chooseType = vi.fn(async () => 'due' as const)
    await dispatchTaskDrop(makeEvent({ activeTodoId: 3, over: day({ due: false, followup: true }) }), { calendar: { reschedule, chooseType } })
    expect(reschedule).toHaveBeenCalledWith(3, date, 'followup')
    expect(chooseType).not.toHaveBeenCalled()
  })

  it('both shown: asks, at the drop point, and sets the pick', async () => {
    const reschedule = vi.fn(async () => {})
    const chooseType = vi.fn(async () => 'followup' as const)
    await dispatchTaskDrop(
      makeEvent({ activeTodoId: 3, over: day({ due: true, followup: true }), start: { x: 100, y: 50 }, delta: { x: 300, y: 120 } }),
      { calendar: { reschedule, chooseType } },
    )
    expect(chooseType).toHaveBeenCalledWith(expect.objectContaining({ date, scope: 'ws-t', at: { x: 400, y: 170 } }))
    expect(reschedule).toHaveBeenCalledWith(3, date, 'followup')
  })

  it('both shown and the choice cancelled: handled, nothing set', async () => {
    const reschedule = vi.fn(async () => {})
    const handled = await dispatchTaskDrop(
      makeEvent({ activeTodoId: 3, over: day({ due: true, followup: true }) }),
      { calendar: { reschedule, chooseType: async () => null } },
    )
    expect(handled).toBe(true)
    expect(reschedule).not.toHaveBeenCalled()
  })

  it('both shown but no chooser: the due date', async () => {
    const reschedule = vi.fn(async () => {})
    await dispatchTaskDrop(makeEvent({ activeTodoId: 3, over: day({ due: true, followup: true }) }), { calendar: { reschedule } })
    expect(reschedule).toHaveBeenCalledWith(3, date, 'due')
  })

  it('a calendar entry moves its own date, whatever the target shows, without asking', async () => {
    const reschedule = vi.fn(async () => {})
    const chooseType = vi.fn(async () => 'due' as const)
    await dispatchTaskDrop(
      makeEvent({
        activeId: taskDragId('calendar-widget', 3, { scope: 't', sectionKey: 'followup' }),
        activeTodoId: 3,
        activeExtra: { calendarDateType: 'followup' },
        over: day({ due: true, followup: false }),
      }),
      { calendar: { reschedule, chooseType } },
    )
    expect(reschedule).toHaveBeenCalledWith(3, date, 'followup')
    expect(chooseType).not.toHaveBeenCalled()
  })
})

describe('resolveCalendarDropType', () => {
  it.each([
    [{}, { due: true, followup: true }, 'choose'],
    [{}, { due: true, followup: false }, 'due'],
    [{}, { due: false, followup: true }, 'followup'],
    [{ calendarDateType: 'due' }, { due: false, followup: true }, 'due'],
    [{ calendarDateType: 'followup' }, { due: true, followup: true }, 'followup'],
    [{ calendarDateType: 'bogus' }, { due: true, followup: false }, 'due'],
  ] as const)('drag %o on a day showing %o → %s', (active, dateTypes, expected) => {
    expect(resolveCalendarDropType(active, dateTypes)).toBe(expected)
  })
})

describe('dispatchTaskDrop — every drop kind, and nothing else', () => {
  // One handled drop per TASK_DROP_KIND: a new kind without a case here
  // doesn't compile, and one the dispatcher ignores fails.
  const OVER_DATA: Record<TaskDropKind, Record<string, unknown>> = {
    'calendar-day': { date: new Date(2026, 9, 13), scope: 't1', dateTypes: { due: true, followup: false } },
    'eisenhower-quadrant': { quadrant: 'do', scope: 't2' },
  }
  const deps = () => ({
    calendar: { reschedule: vi.fn(async () => {}) },
    eisenhower: { tasksFor: () => [makeTodo({ id: 1 })], today: () => new Date(2026, 9, 10), range: () => null, apply: vi.fn(async () => {}) },
  })

  it.each(Object.values(TASK_DROP_KIND))('a drop on a %s is handled', async (kind) => {
    const d = deps()
    const handled = await dispatchTaskDrop(makeEvent({ activeTodoId: 1, over: { id: `${kind}-x`, type: kind, extra: OVER_DATA[kind] } }), d)
    expect(handled).toBe(true)
    expect(d.calendar.reschedule.mock.calls.length + d.eisenhower.apply.mock.calls.length).toBe(1)
  })

  it('over=null is not handled', async () => {
    const d = deps()
    const handled = await dispatchTaskDrop(makeEvent({ activeTodoId: 99, over: null }), d)
    expect(handled).toBe(false)
    expect(d.calendar.reschedule).not.toHaveBeenCalled()
    expect(d.eisenhower.apply).not.toHaveBeenCalled()
  })

  it('a target of any other type is not handled, so the caller\'s own drop runs', async () => {
    const d = deps()
    const handled = await dispatchTaskDrop(
      makeEvent({ activeTodoId: 1, over: { id: 'other-1', type: 'not-a-task-drop', extra: { ...OVER_DATA['calendar-day'], ...OVER_DATA['eisenhower-quadrant'] } } }),
      d,
    )
    expect(handled).toBe(false)
    expect(d.calendar.reschedule).not.toHaveBeenCalled()
    expect(d.eisenhower.apply).not.toHaveBeenCalled()
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
      over: { id: 'calday-x-0', data: { current: { type: TASK_DROP_KIND.calendarDay, date: new Date(), dateTypes: { due: true, followup: false } } } },
      delta: { x: 0, y: 0 },
    } as unknown as DragEndEvent
    const handled = await dispatchTaskDrop(event, { calendar: { reschedule } })
    expect(handled).toBe(false)
    expect(reschedule).not.toHaveBeenCalled()
  })
})

describe('dispatchTaskDrop — Eisenhower quadrant drops', () => {
  const TODAY = new Date(2026, 9, 10)
  const quadrantOver = (quadrant: string) => ({ id: `eis-t1-${quadrant}`, type: TASK_DROP_KIND.eisenhowerQuadrant, extra: { quadrant, scope: 't1' } })
  const ops = (tasks: ReturnType<typeof makeTodo>[]) => ({
    tasksFor: vi.fn(() => tasks),
    today: () => TODAY,
    range: () => 3,
    apply: vi.fn(async () => {}),
  })

  it('applies the quadrant flags to the tasks the drag moves', async () => {
    const eisenhower = ops([makeTodo({ id: 4, important: true }), makeTodo({ id: 5 })])
    const handled = await dispatchTaskDrop(makeEvent({ activeTodoId: 4, over: quadrantOver('delegate') }), { eisenhower })
    expect(handled).toBe(true)
    expect(eisenhower.tasksFor).toHaveBeenCalledWith(expect.objectContaining({ todo: expect.objectContaining({ id: 4 }) }))
    expect(eisenhower.apply).toHaveBeenCalledWith([{ todoId: 4, urgent: true, important: false }, { todoId: 5, urgent: true }])
  })

  it('a blocked drop is handled and changes nothing', async () => {
    const eisenhower = ops([makeTodo({ id: 4, dueDate: new Date(2026, 9, 12) })])
    const handled = await dispatchTaskDrop(makeEvent({ activeTodoId: 4, over: quadrantOver('drop') }), { eisenhower })
    expect(handled).toBe(true)
    expect(eisenhower.apply).not.toHaveBeenCalled()
  })

  it('a drop on its own quadrant changes nothing', async () => {
    const eisenhower = ops([makeTodo({ id: 4 })])
    expect(await dispatchTaskDrop(makeEvent({ activeTodoId: 4, over: quadrantOver('drop') }), { eisenhower })).toBe(true)
    expect(eisenhower.apply).not.toHaveBeenCalled()
  })

  it('without Eisenhower ops (or with an unknown quadrant) the drop falls through', async () => {
    expect(await dispatchTaskDrop(makeEvent({ activeTodoId: 4, over: quadrantOver('do') }), {})).toBe(false)
    const eisenhower = ops([makeTodo({ id: 4 })])
    expect(await dispatchTaskDrop(makeEvent({ activeTodoId: 4, over: quadrantOver('later') }), { eisenhower })).toBe(false)
  })
})
