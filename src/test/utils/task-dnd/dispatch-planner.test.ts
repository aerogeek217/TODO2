/**
 * `dispatchTaskDrop`'s Planner branch: a task dropped on a Planner's day
 * tile or group is handed to the Planner's one drop — once, with what its
 * droppable says (the Planner, the day, its window, a group's rows) —
 * whatever row was dragged (the Planner's own, a list's, a calendar entry),
 * and never to the calendar's ops. Data that isn't a Planner target's is
 * not handled.
 */

import { describe, expect, it, vi } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  TASK_DRAG_KIND,
  TASK_DROP_KIND,
  dispatchTaskDrop,
  isPlannerDropData,
  plannerDropId,
  taskDragId,
  type PlannerDropData,
} from '../../../utils/task-dnd'
import { makeTodo } from '../../helpers'

const TODAY = new Date(2026, 10, 20)
const WINDOW = { today: TODAY, last: new Date(2026, 10, 26) }
const MONDAY = new Date(2026, 10, 23)

const TILE: PlannerDropData = { type: TASK_DROP_KIND.plannerDay, scope: 'plan', target: { kind: 'day', day: MONDAY }, window: WINDOW }
const GROUP: PlannerDropData = {
  type: TASK_DROP_KIND.plannerGroup,
  scope: 'plan',
  target: { kind: 'day', day: MONDAY },
  window: WINDOW,
  group: { key: '2026-11-23', rows: ['d', 'e'], shown: ['a', 'b', 'd', 'e'] },
}
const NO_DAY: PlannerDropData = {
  type: TASK_DROP_KIND.plannerGroup,
  scope: 'plan',
  target: { kind: 'noday' },
  window: WINDOW,
  group: { key: 'none', rows: ['f'], shown: ['a', 'f'] },
}

const todo = makeTodo({ id: 7, uid: 'a' })

function event(over: Record<string, unknown> | null, activeExtra: Record<string, unknown> = {}, id = 'planner-x'): DragEndEvent {
  return {
    active: {
      id: 'active',
      data: { current: { ...activeExtra, type: TASK_DRAG_KIND.task, todo } },
      rect: { current: { initial: null, translated: null } },
    },
    activatorEvent: null,
    over: over ? { id, data: { current: over } } : null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent
}

/** The drags a Planner target takes: one of its own rows, a list's row, another Planner's row, a calendar entry. */
const SOURCES: Array<[string, Record<string, unknown>]> = [
  ['a row of that Planner', { listTabId: 'plan', sectionKey: '2026-11-20', rowKey: '2026-11-20|7' }],
  ['a list widget’s row', { listTabId: 'list-1', sectionKey: 'all', rowKey: 'all|7' }],
  ['another Planner’s row', { listTabId: 'plan-2', sectionKey: 'none', rowKey: 'none|7' }],
  ['a calendar entry', { calendarDateType: 'due' }],
  ['any other task drag', {}],
]

describe('dispatchTaskDrop — a Planner’s tile or group', () => {
  it.each(SOURCES)('%s dropped on a tile: the Planner’s one drop, with the day and its window', async (_name, extra) => {
    const drop = vi.fn(async () => {})
    const reschedule = vi.fn(async () => {})
    const chooseType = vi.fn(async () => 'due' as const)
    const handled = await dispatchTaskDrop(event({ ...TILE }, extra), { calendar: { reschedule, chooseType }, planner: { drop } })
    expect(handled).toBe(true)
    expect(drop).toHaveBeenCalledTimes(1)
    expect(drop).toHaveBeenCalledWith({ todo, tabId: 'plan', target: { kind: 'day', day: MONDAY }, window: WINDOW, group: null })
    // Never the calendar's write, never its chooser: a Planner drop asks nothing.
    expect(reschedule).not.toHaveBeenCalled()
    expect(chooseType).not.toHaveBeenCalled()
  })

  it.each(SOURCES)('%s dropped in a group: one drop, with the group’s rows for the hand order', async (_name, extra) => {
    const drop = vi.fn(async () => {})
    const reschedule = vi.fn(async () => {})
    const handled = await dispatchTaskDrop(event({ ...GROUP }, extra), { calendar: { reschedule }, planner: { drop } })
    expect(handled).toBe(true)
    expect(drop).toHaveBeenCalledTimes(1)
    expect(drop).toHaveBeenCalledWith({ todo, tabId: 'plan', target: { kind: 'day', day: MONDAY }, window: WINDOW, group: GROUP.group })
    expect(reschedule).not.toHaveBeenCalled()
  })

  it('Focus, no day is a target like any group', async () => {
    const drop = vi.fn(async () => {})
    await dispatchTaskDrop(event({ ...NO_DAY }), { planner: { drop } })
    expect(drop).toHaveBeenCalledWith({ todo, tabId: 'plan', target: { kind: 'noday' }, window: WINDOW, group: NO_DAY.group })
  })

  it('makes the drop before it returns to the page: the hand order and the landing are set in the drop’s own turn', () => {
    // dnd-kit calls the page's handler in the drop's event: what the drop sets synchronously shows in the drop's render.
    const drop = vi.fn()
    void dispatchTaskDrop(event({ ...GROUP }), { planner: { drop } })
    expect(drop).toHaveBeenCalledTimes(1)
  })

  it('waits for the drop’s write', async () => {
    let written = false
    const drop = vi.fn(() => new Promise<void>((resolve) => setTimeout(() => { written = true; resolve() }, 5)))
    await dispatchTaskDrop(event({ ...TILE }), { planner: { drop } })
    expect(written).toBe(true)
  })

  it('is not handled where no Planner drop is given (the caller’s own handler runs)', async () => {
    const reschedule = vi.fn(async () => {})
    expect(await dispatchTaskDrop(event({ ...TILE }), { calendar: { reschedule } })).toBe(false)
    expect(reschedule).not.toHaveBeenCalled()
  })

  it('takes no drop without a task', async () => {
    const drop = vi.fn(async () => {})
    const noTask = { ...event({ ...TILE }), active: { id: 'x', data: { current: { type: 'workspace-tab' } } } } as unknown as DragEndEvent
    expect(await dispatchTaskDrop(noTask, { planner: { drop } })).toBe(false)
    expect(drop).not.toHaveBeenCalled()
  })

  it.each([
    ['no scope', { ...TILE, scope: undefined }],
    ['no target', { ...TILE, target: undefined }],
    ['a day target without a date', { ...TILE, target: { kind: 'day', day: '2026-11-23' } }],
    ['an unknown target', { ...TILE, target: { kind: 'week' } }],
    ['no window', { ...TILE, window: undefined }],
    ['a window without dates', { ...TILE, window: { today: 1, last: 2 } }],
    ['a group without its rows', { ...GROUP, group: undefined }],
    ['a group whose rows aren’t uids', { ...GROUP, group: { key: 'k', rows: [1, 2], shown: [] } }],
  ])('data that isn’t a Planner target’s (%s) is not handled, and writes nothing', async (_name, data) => {
    const drop = vi.fn(async () => {})
    expect(isPlannerDropData(data)).toBe(false)
    expect(await dispatchTaskDrop(event(data as Record<string, unknown>), { planner: { drop } })).toBe(false)
    expect(drop).not.toHaveBeenCalled()
  })
})

describe('Planner drop targets', () => {
  it('reads a tile’s and a group’s data', () => {
    expect(isPlannerDropData(TILE)).toBe(true)
    expect(isPlannerDropData(GROUP)).toBe(true)
    expect(isPlannerDropData(NO_DAY)).toBe(true)
    expect(isPlannerDropData(null)).toBe(false)
    expect(isPlannerDropData({ type: TASK_DROP_KIND.calendarDay, date: MONDAY, scope: 'c', dateTypes: { due: true, followup: true } })).toBe(false)
  })

  it('gives each tile and group of each Planner its own drop id, apart from a row’s drag id', () => {
    const ids = [
      plannerDropId('plan', 'tile', '2026-11-20'),
      plannerDropId('plan', 'group', '2026-11-20'),
      plannerDropId('plan', 'group', 'none'),
      plannerDropId('plan-2', 'tile', '2026-11-20'),
      taskDragId('list-widget', 7, { scope: 'plan', sectionKey: '2026-11-20' }),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})
