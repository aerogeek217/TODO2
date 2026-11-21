import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { PLAN_FOR_DAY_LABEL, planForDayEntries } from '../../../components/task/plan-menu'
import { TaskMenu } from '../../../components/task/TaskMenu'
import { TaskMenuExtrasContext } from '../../../components/task/task-menu-extras'
import type { TaskMenuHandlers } from '../../../components/task/task-menu-entries'
import type { PersistedTodoItem } from '../../../models'
import { useTodoStore } from '../../../stores/todo-store'
import { makeTodo } from '../../helpers'

/**
 * **Plan for day ›** outside a Planner (`task/plan-menu.planForDayEntries`):
 * every task menu and the task editor's ⋯ — this week's days, Unplanned
 * (any open task joins the Planner there) and, with a plan state, Clear
 * plan or Remove from Planner. Each a plan write only.
 */

// Fri 20 Nov 2026.
const TODAY = new Date(2026, 10, 20)
const day = (n: number) => new Date(2026, 10, 20 + n)

const todo = (over: Partial<PersistedTodoItem> = {}) => makeTodo({ id: 1, uid: 'a', title: 'Task', ...over })
const labels = (entries: readonly MenuEntry[]) => entries.map((e) => (e.kind === 'item' ? e.label : e.kind === 'label' ? `# ${e.text}` : `(${e.kind})`))

function entry(task: PersistedTodoItem) {
  const entries = planForDayEntries(task, TODAY)
  expect(entries).toHaveLength(1)
  const item = entries[0] as MenuItemEntry
  const children = [...(item.children ?? [])]
  const pick = (label: string) => children.find((c): c is MenuItemEntry => c.kind === 'item' && c.label === label)!
  return { item, children, pick }
}

function watchPlans(tasks: PersistedTodoItem[]) {
  const setPlan = vi.fn(() => Promise.resolve(true))
  const update = vi.fn(() => Promise.resolve(true))
  useTodoStore.setState({ todos: tasks, setPlan, update })
  return { setPlan, update }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 20, 9))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Plan for day ›', () => {
  it('lists this week’s days, then Unplanned — no Clear plan for a task with no plan state', () => {
    const { item, children } = entry(todo())
    expect(item.label).toBe('Plan for day')
    expect(item.note).toBeUndefined()
    expect(labels(children)).toEqual([
      `# ${PLAN_FOR_DAY_LABEL}`,
      'Today', 'Sat, Nov 21', 'Sun, Nov 22', 'Mon, Nov 23', 'Tue, Nov 24', 'Wed, Nov 25', 'Thu, Nov 26',
      '(separator)', 'Unplanned',
    ])
  })

  it('names and checks where the task sits in the Planner', () => {
    const due = entry(todo({ dueDate: day(2) }))
    expect(due.item.note).toBe('Sun, Nov 22')
    expect(due.children.filter((c) => c.kind === 'item' && c.checked).map((c) => (c as MenuItemEntry).label)).toEqual(['Sun, Nov 22'])
    const held = entry(todo({ unplanned: true }))
    expect(held.item.note).toBe('Unplanned')
    expect(held.pick('Unplanned').checked).toBe(true)
  })

  it('offers Remove from Planner when clearing takes the task out of it, else Clear plan', () => {
    expect(labels(entry(todo({ unplanned: true })).children).at(-1)).toBe('Remove from Planner')
    expect(labels(entry(todo({ doDate: day(3) })).children).at(-1)).toBe('Remove from Planner')
    // Its date (or Focus) keeps it in the Planner.
    expect(labels(entry(todo({ unplanned: true, dueDate: day(2) })).children).at(-1)).toBe('Clear plan')
    expect(labels(entry(todo({ doDate: day(3), focus: true })).children).at(-1)).toBe('Clear plan')
  })

  it('offers nothing for a completed task', () => {
    expect(planForDayEntries(todo({ isCompleted: true }), TODAY)).toEqual([])
  })

  it('a day plans the task, Unplanned holds any open task, Remove clears it — plan writes only', async () => {
    const task = todo()
    const { setPlan, update } = watchPlans([task])
    entry(task).pick('Mon, Nov 23').onSelect?.()
    await waitFor(() => expect(setPlan).toHaveBeenLastCalledWith([1], { day: day(3) }))
    entry(task).pick('Unplanned').onSelect?.()
    await waitFor(() => expect(setPlan).toHaveBeenLastCalledWith([1], 'unplanned'))
    const held = todo({ unplanned: true })
    useTodoStore.setState({ todos: [held] })
    entry(held).pick('Remove from Planner').onSelect?.()
    await waitFor(() => expect(setPlan).toHaveBeenLastCalledWith([1], null, 'Removed “Task” from the Planner', true))
    expect(update).not.toHaveBeenCalled()
  })

  it('a pick of the task’s own date’s day clears its plan rather than planning it there', async () => {
    const task = todo({ dueDate: day(2), doDate: day(4) })
    const { setPlan } = watchPlans([task])
    entry(task).pick('Sun, Nov 22').onSelect?.()
    await waitFor(() => expect(setPlan).toHaveBeenLastCalledWith([1], null))
  })
})

describe('the task menu', () => {
  const handlers: TaskMenuHandlers = {
    onToggleComplete: vi.fn(), onSetFollowup: vi.fn(), onFollowedUp: vi.fn(), onSetMarker: vi.fn(), onDelete: vi.fn(),
  }
  const items = () => within(screen.getByRole('menu', { name: 'Task actions' })).getAllByRole('menuitem').map((m) => m.getAttribute('data-menu-label'))

  it('offers Plan for day › for one task, first in the dates group', () => {
    const task = todo()
    useTodoStore.setState({ todos: [task] })
    render(<TaskMenu todo={task} point={{ x: 10, y: 10 }} selectionAware={false} handlers={handlers} onClose={() => {}} />)
    expect(items().slice(0, 3)).toEqual(['Mark complete', 'Copy', 'Plan for day'])
  })

  it('a surface’s own entries replace it (a Planner row’s)', () => {
    const task = todo()
    useTodoStore.setState({ todos: [task] })
    const own: MenuEntry[] = [{ kind: 'item', label: 'Surface entry', onSelect: () => {} }]
    render(
      <TaskMenuExtrasContext.Provider value={() => own}>
        <TaskMenu todo={task} point={{ x: 10, y: 10 }} selectionAware={false} handlers={handlers} onClose={() => {}} />
      </TaskMenuExtrasContext.Provider>,
    )
    expect(items()).toContain('Surface entry')
    expect(items()).not.toContain('Plan for day')
  })
})
