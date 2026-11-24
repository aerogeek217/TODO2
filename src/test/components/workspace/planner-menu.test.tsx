import { describe, expect, it, vi } from 'vitest'
import { buildTaskMenuEntries, type TaskMenuHandlers } from '../../../components/task/task-menu-entries'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { plannerMenuEntries, type PlannerMenuActions } from '../../../components/workspace/planner/planner-menu'
import type { PersistedTodoItem } from '../../../models'
import { plannerWindow } from '../../../utils/planner'
import { makeTodo } from '../../helpers'

/**
 * A Planner row's entries in its task menu (`planner-menu.plannerMenuEntries`):
 * **Plan for day ›** — Today and
 * the window's days after it, Pick a date…; a day picked is planned
 * outright —, **Snooze** and
 * — on a row with a plan only — **Unplan**, or **Remove from Planner** when
 * clearing the plan takes the task out of the Planner; and where the task
 * menu puts them.
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const WINDOW = plannerWindow(TODAY)

const todo = (over: Partial<PersistedTodoItem> = {}) => makeTodo({ id: 1, uid: 'a', title: 'Task', ...over })

function build(task: PersistedTodoItem, window = WINDOW) {
  const actions = { move: vi.fn<PlannerMenuActions['move']>(), snooze: vi.fn(), unplan: vi.fn() }
  const entries = plannerMenuEntries(task, window, actions)
  const item = (label: string) => (entries as MenuItemEntry[]).find((e) => e.label === label)
  const move = item('Plan for day')!
  /** Absent on a row in Unplanned. */
  const snooze = item('Snooze')
  /** Only with a plan: Unplan, or Remove from Planner. */
  const unplan = item('Unplan') ?? item('Remove from Planner')
  expect(entries).toHaveLength(1 + (snooze ? 1 : 0) + (unplan ? 1 : 0))
  // No separate Clear plan entry.
  expect(item('Clear plan')).toBeUndefined()
  const children = [...(move.children ?? [])]
  const items = children.filter((c): c is MenuItemEntry => c.kind === 'item')
  return { entries, move, snooze, unplan, children, items, actions, byLabel: (label: string) => items.find((i) => i.label === label)! }
}

const labels = (entries: readonly MenuEntry[]) => entries.map((e) => (e.kind === 'item' ? e.label : e.kind === 'label' ? `# ${e.text}` : `(${e.kind})`))

describe('Plan for day ›', () => {
  it('lists Today and the window’s six days after it in words, then Pick a date… — no No day', () => {
    const { move, children } = build(todo({ dueDate: day(2) }))
    expect(move.label).toBe('Plan for day')
    expect(labels(children)).toEqual([
      'Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26',
      '(separator)', 'Pick a date…',
    ])
  })

  it('has no explaining line, whatever put the row on its day', () => {
    for (const over of [{ nextFollowupAt: day(0) }, { nextFollowupAt: day(1), dueDate: day(1) }, { doDate: day(2) }, { focus: true }, { focus: true, doDate: day(1) }]) {
      expect(build(todo(over)).children.some((e) => e.kind === 'label')).toBe(false)
    }
  })

  it('checks the planned day — not a day the row sits on by its own date — and names where it is on the item', () => {
    const due = build(todo({ dueDate: day(2) }))
    expect(due.items.filter((i) => i.checked)).toEqual([])
    expect(due.move.note).toBe('Sun, Nov 22')
    expect(due.byLabel('Sun, Nov 22').note).toBe('due')
    const late = build(todo({ dueDate: day(-5) }))
    expect(late.items.filter((i) => i.checked)).toEqual([])
    expect(late.move.note).toBe('Today')
    expect(late.byLabel('Today').note).toBe('Nov 20')
    const planned = build(todo({ dueDate: day(2), doDate: day(4) }))
    expect(planned.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Tue, Nov 24'])
    expect(planned.move.note).toBe('Tue, Nov 24')
    // In a tray: no day checked, the tray named.
    const focus = build(todo({ focus: true }))
    expect(focus.items.filter((i) => i.checked)).toEqual([])
    expect(focus.move.note).toBe('Unplanned')
    const missed = build(todo({ doDate: day(-1) }))
    expect(missed.items.filter((i) => i.checked)).toEqual([])
    expect(missed.move.note).toBe('Delayed')
  })

  it('a pick is the day as a pick — planned outright, its own date’s day too', () => {
    const { byLabel, actions } = build(todo({ dueDate: day(2) }))
    byLabel('Mon, Nov 23').onSelect?.()
    expect(actions.move).toHaveBeenLastCalledWith({ kind: 'day', day: day(3), pick: true })
    byLabel('Today').onSelect?.()
    expect(actions.move).toHaveBeenLastCalledWith({ kind: 'day', day: TODAY, pick: true })
    byLabel('Sun, Nov 22').onSelect?.()
    expect(actions.move).toHaveBeenLastCalledWith({ kind: 'day', day: day(2), pick: true })
    expect(actions.snooze).not.toHaveBeenCalled()
    expect(actions.unplan).not.toHaveBeenCalled()
  })

  it('in a shifted window: Today, then that week’s seven days', () => {
    const { children, items } = build(todo({ dueDate: day(8), doDate: day(9) }), plannerWindow(TODAY, 7))
    expect(labels(children).slice(0, 8)).toEqual(['Today', 'Fri, Nov 27', 'Sat, Nov 28', 'Sun, Nov 29', 'Mon, Nov 30', 'Tue, Dec 1', 'Wed, Dec 2', 'Thu, Dec 3'])
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Sun, Nov 29'])
  })
})

describe('Snooze', () => {
  it('names the day it plans for: the day after the row’s, tomorrow from Delayed or a late row', () => {
    expect(build(todo({ dueDate: day(2) })).snooze).toMatchObject({ label: 'Snooze', note: 'Mon, Nov 23' })
    expect(build(todo({ doDate: day(4) })).snooze?.note).toBe('Wed, Nov 25')
    expect(build(todo({ dueDate: day(-5) })).snooze?.note).toBe('Sat, Nov 21')
    expect(build(todo({ doDate: day(-2) })).snooze?.note).toBe('Sat, Nov 21')
  })

  it('is not offered on a row in Unplanned: nothing there is planned to put off', () => {
    expect(build(todo({ focus: true })).snooze).toBeUndefined()
  })

  it('a pick snoozes', () => {
    const { snooze, actions } = build(todo({ dueDate: day(2) }))
    snooze?.onSelect?.()
    expect(actions.snooze).toHaveBeenCalledTimes(1)
    expect(actions.move).not.toHaveBeenCalled()
  })
})

describe('Unplan', () => {
  it('is offered only on a row with a plan — on a day or in Delayed —, a pick unplans; it comes last', () => {
    for (const over of [{ doDate: day(1), dueDate: day(4) }, { doDate: day(-2), dueDate: day(2) }, { focus: true, doDate: day(2) }]) {
      const { entries, unplan, actions } = build(todo(over))
      expect(unplan).toMatchObject({ label: 'Unplan' })
      expect(unplan?.disabled).toBeFalsy()
      expect(entries.at(-1)).toBe(unplan)
      unplan?.onSelect?.()
      expect(actions.unplan).toHaveBeenCalledTimes(1)
    }
  })

  it('reads Remove from Planner when clearing the plan takes the task out of the Planner', () => {
    for (const over of [{ doDate: day(2) }, { doDate: day(-1) }, { doDate: day(2), dueDate: day(20) }]) {
      const { entries, unplan, actions } = build(todo(over))
      expect(unplan?.label).toBe('Remove from Planner')
      expect(entries.at(-1)).toBe(unplan)
      unplan?.onSelect?.()
      expect(actions.unplan).toHaveBeenCalledTimes(1)
    }
  })

  it('is not offered on a row with no plan: on a day by its own date, or in Unplanned — never a disabled entry', () => {
    for (const over of [{ dueDate: day(2) }, { nextFollowupAt: day(0) }, { focus: true }]) {
      expect(build(todo(over)).unplan).toBeUndefined()
    }
  })
})

describe('a completed task', () => {
  it('is offered nothing', () => {
    expect(plannerMenuEntries(todo({ isCompleted: true, dueDate: day(1) }), WINDOW, { move: vi.fn(), snooze: vi.fn(), unplan: vi.fn() })).toEqual([])
  })
})

describe('the task menu with a surface’s entries', () => {
  const handlers: TaskMenuHandlers = {
    onOpen: vi.fn(), onToggleComplete: vi.fn(), onSetDueDate: vi.fn(), onSetFollowup: vi.fn(), onFollowedUp: vi.fn(), onSetMarker: vi.fn(), onDelete: vi.fn(),
  }
  const base = { today: TODAY, urgentRange: 3 as const, followupIntervals: [], handlers }
  const extra = plannerMenuEntries(todo({ doDate: day(1), dueDate: day(2) }), WINDOW, { move: vi.fn(), snooze: vi.fn(), unplan: vi.fn() })

  it('leads the dates group with them: after Open · Mark complete, before Set due date…', () => {
    const task = todo({ doDate: day(1), dueDate: day(2) })
    const entries = labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task], extra }))
    expect(entries.slice(0, 7)).toEqual(['Open', 'Mark complete', '(separator)', 'Plan for day', 'Snooze', 'Unplan', 'Set due date…'])
  })

  it('has none without a surface that adds them, and none for several tasks', () => {
    const task = todo({ doDate: day(1), dueDate: day(2) })
    const without = labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task] }))
    for (const label of ['Plan for day', 'Snooze', 'Unplan']) expect(without).not.toContain(label)
    const other = makeTodo({ id: 2, uid: 'b' })
    const several = labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task, other], extra }))
    for (const label of ['Plan for day', 'Snooze', 'Unplan']) expect(several).not.toContain(label)
  })
})
