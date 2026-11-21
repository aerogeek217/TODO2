import { describe, expect, it, vi } from 'vitest'
import { buildTaskMenuEntries, type TaskMenuHandlers } from '../../../components/task/task-menu-entries'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { MOVE_PLAN_LABEL, plannerMenuEntries, UNPLAN_OFF, type PlannerMenuActions } from '../../../components/workspace/planner/planner-menu'
import type { PersistedTodoItem } from '../../../models'
import { plannerWindow } from '../../../utils/planner'
import { makeTodo } from '../../helpers'

/**
 * A Planner row's entries in its task menu (`planner-menu.plannerMenuEntries`):
 * **Move to day ›** — the drag's moves, a first line saying a pick plans
 * the task, Today and the window's days after it —, **Snooze** and
 * **Unplan** (off, with its reason, where there is nothing to unplan) — and
 * where the task menu puts them.
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const WINDOW = plannerWindow(TODAY)

const todo = (over: Partial<PersistedTodoItem> = {}) => makeTodo({ id: 1, uid: 'a', title: 'Task', ...over })

function build(task: PersistedTodoItem, window = WINDOW) {
  const actions = { move: vi.fn<PlannerMenuActions['move']>(), snooze: vi.fn(), unplan: vi.fn() }
  const entries = plannerMenuEntries(task, window, actions)
  expect(entries).toHaveLength(3)
  const [move, snooze, unplan] = entries as [MenuItemEntry, MenuItemEntry, MenuItemEntry]
  const children = [...(move.children ?? [])]
  const items = children.filter((c): c is MenuItemEntry => c.kind === 'item')
  return { move, snooze, unplan, children, items, actions, byLabel: (label: string) => items.find((i) => i.label === label)! }
}

const labels = (entries: readonly MenuEntry[]) => entries.map((e) => (e.kind === 'item' ? e.label : e.kind === 'label' ? `# ${e.text}` : `(${e.kind})`))

describe('Move to day ›', () => {
  it('lists Today and the window’s six days after it in words, under the line saying a pick plans the task — no No day', () => {
    const { move, children } = build(todo({ dueDate: day(2) }))
    expect(move.label).toBe('Move to day')
    expect(labels(children)).toEqual([
      `# ${MOVE_PLAN_LABEL}`,
      'Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26',
    ])
    expect(MOVE_PLAN_LABEL).toBe('Plans it for that day')
  })

  it('says the same whatever put the row on its day: nothing moves a follow-up or a due date', () => {
    for (const over of [{ nextFollowupAt: day(0) }, { nextFollowupAt: day(1), dueDate: day(1) }, { doDate: day(2) }, { focus: true }, { unplanned: true as const, dueDate: day(1) }]) {
      expect(build(todo(over)).children[0]).toEqual({ kind: 'label', text: 'Plans it for that day' })
    }
  })

  it('checks the day the row sits on — Today for a late one — and names where it is on the item', () => {
    const due = build(todo({ dueDate: day(2) }))
    expect(due.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Sun, Nov 22'])
    expect(due.move.note).toBe('Sun, Nov 22')
    const late = build(todo({ dueDate: day(-5) }))
    expect(late.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Today'])
    expect(late.move.note).toBe('Today')
    expect(late.byLabel('Today').note).toBe('Nov 20')
    const planned = build(todo({ dueDate: day(2), doDate: day(4) }))
    expect(planned.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Tue, Nov 24'])
    expect(planned.move.note).toBe('Tue, Nov 24')
    // In a tray: no day checked, the tray named.
    const focus = build(todo({ focus: true }))
    expect(focus.items.filter((i) => i.checked)).toEqual([])
    expect(focus.move.note).toBe('Unplanned')
    expect(build(todo({ unplanned: true, dueDate: day(2) })).move.note).toBe('Unplanned')
    const missed = build(todo({ doDate: day(-1) }))
    expect(missed.items.filter((i) => i.checked)).toEqual([])
    expect(missed.move.note).toBe('Delayed')
  })

  it('a pick is the day’s target, as a drop on it', () => {
    const { byLabel, actions } = build(todo({ dueDate: day(2) }))
    byLabel('Mon, Nov 23').onSelect?.()
    expect(actions.move).toHaveBeenLastCalledWith({ kind: 'day', day: day(3) })
    byLabel('Today').onSelect?.()
    expect(actions.move).toHaveBeenLastCalledWith({ kind: 'day', day: TODAY })
    expect(actions.snooze).not.toHaveBeenCalled()
    expect(actions.unplan).not.toHaveBeenCalled()
  })

  it('in a shifted window: Today, then that week’s seven days', () => {
    const { children, items } = build(todo({ dueDate: day(8) }), plannerWindow(TODAY, 7))
    expect(labels(children).slice(1, 9)).toEqual(['Today', 'Fri, Nov 27', 'Sat, Nov 28', 'Sun, Nov 29', 'Mon, Nov 30', 'Tue, Dec 1', 'Wed, Dec 2', 'Thu, Dec 3'])
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Sat, Nov 28'])
  })
})

describe('Snooze', () => {
  it('names the day it plans for: the day after the row’s, tomorrow from a tray or a late row', () => {
    expect(build(todo({ dueDate: day(2) })).snooze).toMatchObject({ label: 'Snooze', note: 'Mon, Nov 23' })
    expect(build(todo({ doDate: day(4) })).snooze.note).toBe('Wed, Nov 25')
    expect(build(todo({ dueDate: day(-5) })).snooze.note).toBe('Sat, Nov 21')
    expect(build(todo({ doDate: day(-2) })).snooze.note).toBe('Sat, Nov 21')
    expect(build(todo({ focus: true })).snooze.note).toBe('Sat, Nov 21')
    expect(build(todo({ unplanned: true, dueDate: day(3) })).snooze.note).toBe('Sat, Nov 21')
  })

  it('a pick snoozes', () => {
    const { snooze, actions } = build(todo({ dueDate: day(2) }))
    snooze.onSelect?.()
    expect(actions.snooze).toHaveBeenCalledTimes(1)
    expect(actions.move).not.toHaveBeenCalled()
  })
})

describe('Unplan', () => {
  it('is on for a row on a day or in Delayed; a pick unplans', () => {
    for (const over of [{ dueDate: day(2) }, { doDate: day(1), dueDate: day(4) }, { doDate: day(-2) }, { focus: true, doDate: day(2) }]) {
      const { unplan, actions } = build(todo(over))
      expect(unplan).toMatchObject({ label: 'Unplan', disabled: false, title: undefined })
      unplan.onSelect?.()
      expect(actions.unplan).toHaveBeenCalledTimes(1)
    }
  })

  it('is off, with the reason, for a row in Unplanned already', () => {
    expect(build(todo({ focus: true })).unplan).toMatchObject({ disabled: true, title: UNPLAN_OFF })
    expect(build(todo({ unplanned: true, dueDate: day(2) })).unplan).toMatchObject({ disabled: true, title: UNPLAN_OFF })
    expect(UNPLAN_OFF).toMatch(/Unplanned already/)
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
  const extra = plannerMenuEntries(todo({ dueDate: day(2) }), WINDOW, { move: vi.fn(), snooze: vi.fn(), unplan: vi.fn() })

  it('leads the dates group with them: after Open · Mark complete, before Set due date…', () => {
    const task = todo({ dueDate: day(2) })
    const entries = labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task], extra }))
    expect(entries.slice(0, 7)).toEqual(['Open', 'Mark complete', '(separator)', 'Move to day', 'Snooze', 'Unplan', 'Set due date…'])
  })

  it('has none without a surface that adds them, and none for several tasks', () => {
    const task = todo({ dueDate: day(2) })
    const without = labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task] }))
    for (const label of ['Move to day', 'Snooze', 'Unplan']) expect(without).not.toContain(label)
    const other = makeTodo({ id: 2, uid: 'b' })
    const several = labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task, other], extra }))
    for (const label of ['Move to day', 'Snooze', 'Unplan']) expect(several).not.toContain(label)
  })
})
