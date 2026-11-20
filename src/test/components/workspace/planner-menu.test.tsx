import { describe, expect, it, vi } from 'vitest'
import { buildTaskMenuEntries, type TaskMenuHandlers } from '../../../components/task/task-menu-entries'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { MOVE_DO_LABEL, MOVE_FOLLOWUP_LABEL, NO_DAY_REFUSED, plannerMoveEntries } from '../../../components/workspace/planner/planner-menu'
import type { PersistedTodoItem } from '../../../models'
import { plannerWindow, type PlannerTarget } from '../../../utils/planner'
import { makeTodo } from '../../helpers'

/**
 * **Move to day ›** (`planner-menu.plannerMoveEntries`): the drag's moves
 * from a Planner row's task menu — a first line saying which date a pick
 * changes, Today and the window's days after it, No day (off, with its
 * reason, for a row placed by a date) — and where the task menu puts it.
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number, hour = 0) => new Date(2026, 10, 20 + n, hour)
const WINDOW = plannerWindow(TODAY)

const todo = (over: Partial<PersistedTodoItem> = {}) => makeTodo({ id: 1, uid: 'a', title: 'Task', ...over })

function build(task: PersistedTodoItem, window = WINDOW) {
  const onMove = vi.fn<(target: PlannerTarget) => void>()
  const [entry, ...rest] = plannerMoveEntries(task, window, onMove)
  expect(rest).toEqual([])
  const item = entry as MenuItemEntry
  const children = [...(item.children ?? [])]
  const items = children.filter((c): c is MenuItemEntry => c.kind === 'item')
  return { item, children, items, onMove, byLabel: (label: string) => items.find((i) => i.label === label)! }
}

const labels = (entries: readonly MenuEntry[]) => entries.map((e) => (e.kind === 'item' ? e.label : e.kind === 'label' ? `# ${e.text}` : `(${e.kind})`))

describe('Move to day ›', () => {
  it('lists Today, the window’s six days after it in words, then No day — under the line saying which date it changes', () => {
    const { item, children } = build(todo({ dueDate: day(2) }))
    expect(item.label).toBe('Move to day')
    expect(labels(children)).toEqual([
      `# ${MOVE_DO_LABEL}`,
      'Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26',
      '(separator)',
      'No day',
    ])
    expect(MOVE_DO_LABEL).toBe('Sets the Do day')
  })

  it('says it moves the follow-up for a row on its day by its follow-up', () => {
    expect(build(todo({ nextFollowupAt: day(0) })).children[0]).toEqual({ kind: 'label', text: MOVE_FOLLOWUP_LABEL })
    expect(build(todo({ nextFollowupAt: day(1), dueDate: day(1) })).children[0]).toEqual({ kind: 'label', text: 'Moves the follow-up' })
    // A Do day, an earlier due date, or no day at all: the Do day.
    expect(build(todo({ nextFollowupAt: day(0), doDate: day(2) })).children[0]).toEqual({ kind: 'label', text: MOVE_DO_LABEL })
    expect(build(todo({ nextFollowupAt: day(3), dueDate: day(1) })).children[0]).toEqual({ kind: 'label', text: MOVE_DO_LABEL })
    expect(build(todo({ focus: true })).children[0]).toEqual({ kind: 'label', text: MOVE_DO_LABEL })
  })

  it('checks the day the row is on — Today for a late one — and names it on the item', () => {
    const due = build(todo({ dueDate: day(2) }))
    expect(due.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Sun, Nov 22'])
    expect(due.item.note).toBe('Sun, Nov 22')
    const late = build(todo({ dueDate: day(-5) }))
    expect(late.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Today'])
    expect(late.item.note).toBe('Today')
    expect(late.byLabel('Today').note).toBe('Nov 20')
    const none = build(todo({ focus: true }))
    expect(none.items.filter((i) => i.checked).map((i) => i.label)).toEqual(['No day'])
    expect(none.item.note).toBe('No day')
  })

  it('a pick is the day’s target, as a drop on it', () => {
    const { byLabel, onMove } = build(todo({ dueDate: day(2) }))
    byLabel('Mon, Nov 23').onSelect?.()
    expect(onMove).toHaveBeenLastCalledWith({ kind: 'day', day: day(3) })
    byLabel('Today').onSelect?.()
    expect(onMove).toHaveBeenLastCalledWith({ kind: 'day', day: TODAY })
  })

  it('No day clears a Do day; it is off, with the reason, for a row placed by a date', () => {
    const planned = build(todo({ doDate: day(1), dueDate: day(4) }))
    expect(planned.byLabel('No day')).toMatchObject({ disabled: false, checked: false, title: undefined })
    planned.byLabel('No day').onSelect?.()
    expect(planned.onMove).toHaveBeenCalledWith({ kind: 'noday' })

    const due = build(todo({ dueDate: day(2) })).byLabel('No day')
    expect(due).toMatchObject({ disabled: true, title: NO_DAY_REFUSED.due })
    const followup = build(todo({ nextFollowupAt: day(0), focus: true })).byLabel('No day')
    expect(followup).toMatchObject({ disabled: true, title: NO_DAY_REFUSED.followup })
    expect(NO_DAY_REFUSED.due).toMatch(/due date/)
    expect(NO_DAY_REFUSED.followup).toMatch(/follow-up/)
  })

  it('in a shifted window: Today, then that week’s seven days', () => {
    const { children, items } = build(todo({ dueDate: day(8) }), plannerWindow(TODAY, 7))
    expect(labels(children).slice(1, 9)).toEqual(['Today', 'Fri, Nov 27', 'Sat, Nov 28', 'Sun, Nov 29', 'Mon, Nov 30', 'Tue, Dec 1', 'Wed, Dec 2', 'Thu, Dec 3'])
    expect(items.filter((i) => i.checked).map((i) => i.label)).toEqual(['Sat, Nov 28'])
  })

  it('offers nothing for a completed task', () => {
    expect(plannerMoveEntries(todo({ isCompleted: true, dueDate: day(1) }), WINDOW, vi.fn())).toEqual([])
  })
})

describe('the task menu with a surface’s entries', () => {
  const handlers: TaskMenuHandlers = {
    onOpen: vi.fn(), onToggleComplete: vi.fn(), onSetDueDate: vi.fn(), onSetFollowup: vi.fn(), onFollowedUp: vi.fn(), onSetMarker: vi.fn(), onDelete: vi.fn(),
  }
  const base = { today: TODAY, urgentRange: 3 as const, followupIntervals: [], handlers }
  const extra = plannerMoveEntries(todo({ dueDate: day(2) }), WINDOW, vi.fn())

  it('leads the dates group with them: after Open · Mark complete, before Set due date…', () => {
    const task = todo({ dueDate: day(2) })
    const entries = labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task], extra }))
    expect(entries.slice(0, 5)).toEqual(['Open', 'Mark complete', '(separator)', 'Move to day', 'Set due date…'])
  })

  it('has none without a surface that adds them, and none for several tasks', () => {
    const task = todo({ dueDate: day(2) })
    expect(labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task] }))).not.toContain('Move to day')
    const other = makeTodo({ id: 2, uid: 'b' })
    expect(labels(buildTaskMenuEntries({ ...base, todo: task, targets: [task, other], extra }))).not.toContain('Move to day')
  })
})
