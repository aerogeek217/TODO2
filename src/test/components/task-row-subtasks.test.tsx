// The desktop row's `2/5` count (cr28, T2): after the title when the task has
// subtasks, the accent when every one is done; a click opens the checklist
// popover, whose checks write through the store (the count follows); Esc
// closes it and hands the focus back to the count. The phone row's chip opens
// the sheet.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { TaskRow } from '../../components/task/TaskRow'
import { MobileTaskRow } from '../../components/task/MobileTaskRow'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { makeTodo, resetDb } from '../helpers'

afterEach(cleanup)

beforeEach(async () => {
  await resetDb()
})

/** Task 1 with the subtasks `titles` (a `[x] ` prefix marks one done), stored and loaded. */
async function seed(titles: string[]): Promise<void> {
  const todo = makeTodo({ id: 1, title: 'Q4 budget', modifiedAt: new Date(2026, 0, 1) })
  await db.todos.add(todo)
  await db.subtasks.bulkAdd(titles.map((t, i) => ({
    todoId: 1, title: t.replace(/^\[x\] /, ''), isCompleted: t.startsWith('[x] '), sortOrder: i, createdAt: new Date(),
  })))
  useTodoStore.setState({ todos: [todo] })
  await useSubtaskStore.getState().load()
}

const todo = () => useTodoStore.getState().todos[0]!
const count = () => screen.queryByRole('button', { name: /subtasks? done, show them/ })
const popover = () => screen.getByRole('dialog', { name: 'Subtasks of Q4 budget' })

describe('TaskRow — the subtask count', () => {
  it('shows nothing without subtasks', async () => {
    await seed([])
    render(<TaskRow todo={todo()} />)
    expect(count()).toBeNull()
    expect(document.querySelector('[data-subtask-count]')).toBeNull()
  })

  it('shows `1/3` after the title, named in words; all done takes the accent', async () => {
    await seed(['[x] a', 'b', 'c'])
    const { unmount } = render(<TaskRow todo={todo()} />)
    expect(count()).toHaveTextContent('1/3')
    expect(count()).toHaveAttribute('aria-label', '1 of 3 subtasks done, show them')
    expect(count()).not.toHaveAttribute('data-all-done')
    expect(count()).toHaveAttribute('data-row-cell', 'subtasks')
    unmount()
    await resetDb()
    await seed(['[x] a'])
    render(<TaskRow todo={todo()} />)
    expect(count()).toHaveTextContent('1/1')
    expect(count()).toHaveAttribute('data-all-done')
  })

  it('the drag ghost shows the count with nothing to press', async () => {
    await seed(['[x] a', 'b'])
    render(<TaskRow todo={todo()} ghost />)
    expect(count()).toBeNull()
    expect(document.querySelector('[data-subtask-count]')).toHaveTextContent('1/2')
  })

  it('a click opens the popover with the first open subtask focused; a check writes and the count follows; Esc closes it and the focus goes back', async () => {
    await seed(['[x] a', 'b', 'c'])
    render(<TaskRow todo={todo()} />)
    fireEvent.click(count()!)
    expect(popover()).toBeInTheDocument()
    expect(count()).toHaveAttribute('aria-expanded', 'true')
    expect(count()).toHaveAttribute('data-open')
    const b = within(popover()).getByRole('checkbox', { name: 'Check b' })
    expect(document.activeElement).toBe(b)
    expect(within(popover()).getByText('1 of 3')).toBeInTheDocument()

    await act(async () => { fireEvent.click(b) })
    expect((await db.subtasks.where('todoId').equals(1).sortBy('sortOrder')).map((s) => s.isCompleted)).toEqual([true, true, false])
    expect(count()).toHaveTextContent('2/3')
    expect(within(popover()).getByText('2 of 3')).toBeInTheDocument()
    // The check stamped the task (activity), stored and shown.
    expect((await db.todos.get(1))?.modifiedAt.getTime()).toBeGreaterThan(new Date(2026, 0, 1).getTime())
    expect(todo().modifiedAt.getTime()).toBeGreaterThan(new Date(2026, 0, 1).getTime())

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Subtasks of Q4 budget' })).toBeNull()
    expect(document.activeElement).toBe(count())
  })

  it('⏎ in the popover’s add row adds a subtask last; every subtask done focuses the add row', async () => {
    await seed(['[x] a'])
    render(<TaskRow todo={todo()} />)
    fireEvent.click(count()!)
    const add = within(popover()).getByRole('textbox', { name: 'New subtask' })
    expect(document.activeElement).toBe(add)
    fireEvent.change(add, { target: { value: 'b' } })
    await act(async () => { fireEvent.keyDown(add, { key: 'Enter' }) })
    expect((await db.subtasks.where('todoId').equals(1).sortBy('sortOrder')).map((s) => s.title)).toEqual(['a', 'b'])
    expect(count()).toHaveTextContent('1/2')
    expect(within(popover()).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b'])
  })
})

describe('TaskRow — Add subtask… without a checklist', () => {
  it('opens the popover at the row on its add field; the first subtask makes the count appear', async () => {
    await seed([])
    render(<TaskRow todo={todo()} />)
    fireEvent.contextMenu(document.querySelector('[data-todo-id]')!, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add subtask…' }))
    const dialog = popover()
    const add = within(dialog).getByRole('textbox', { name: 'New subtask' })
    expect(document.activeElement).toBe(add)
    // Placed by the anchor hook, at the row (never at its off-screen start).
    expect(dialog.style.position).toBe('fixed')
    fireEvent.change(add, { target: { value: 'First line' } })
    await act(async () => { fireEvent.keyDown(add, { key: 'Enter' }) })
    await vi.waitFor(() => expect(count()).toHaveTextContent('0/1'))
    expect((await db.subtasks.where('todoId').equals(1).toArray()).map((s) => s.title)).toEqual(['First line'])
  })
})

describe('MobileTaskRow — the subtasks chip', () => {
  it('shows `1/3 subtasks` and opens the checklist as a sheet, whose checks write', async () => {
    await seed(['[x] a', 'b', 'c'])
    render(<MobileTaskRow todo={todo()} />)
    const chip = screen.getByRole('button', { name: '1 of 3 subtasks done, show them' })
    expect(chip).toHaveTextContent('1/3 subtasks')
    fireEvent.click(chip)
    const sheet = screen.getByRole('dialog', { name: 'Subtasks of Q4 budget' })
    expect(sheet).toHaveAttribute('data-subtasks-sheet')
    await act(async () => { fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Check c' })) })
    expect((await db.subtasks.where('todoId').equals(1).sortBy('sortOrder')).map((s) => s.isCompleted)).toEqual([true, false, true])
    expect(chip).toHaveTextContent('2/3 subtasks')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Subtasks of Q4 budget' })).toBeNull()
  })

  it('shows no chip without subtasks', async () => {
    await seed([])
    render(<MobileTaskRow todo={todo()} />)
    expect(screen.queryByRole('button', { name: /subtasks? done/ })).toBeNull()
  })
})
