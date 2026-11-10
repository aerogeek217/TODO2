// The desktop row's `2/5` count (cr28, T2): after the title when the task has
// subtasks, the accent when every one is done; a click opens the checklist
// popover, whose checks write through the store (the count follows); Esc
// closes it and hands the focus back to the count. The phone row shows the
// count on its details line; its task menu's Add subtask… opens the sheet.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { TaskRow } from '../../components/task/TaskRow'
import { MobileTaskRow } from '../../components/task/MobileTaskRow'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { makeTodo, resetDb } from '../helpers'
import { RowPopoverHost } from '../../components/overlays/RowPopoverHost'

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
    render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
    expect(count()).toBeNull()
    expect(document.querySelector('[data-subtask-count]')).toBeNull()
  })

  it('shows `1/3` after the title, named in words; all done takes the accent', async () => {
    await seed(['[x] a', 'b', 'c'])
    const { unmount } = render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
    expect(count()).toHaveTextContent('1/3')
    expect(count()).toHaveAttribute('aria-label', '1 of 3 subtasks done, show them')
    expect(count()).not.toHaveAttribute('data-all-done')
    expect(count()).toHaveAttribute('data-row-cell', 'subtasks')
    unmount()
    await resetDb()
    await seed(['[x] a'])
    render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
    expect(count()).toHaveTextContent('1/1')
    expect(count()).toHaveAttribute('data-all-done')
  })

  it('the drag ghost shows the count with nothing to press', async () => {
    await seed(['[x] a', 'b'])
    render(<><TaskRow todo={todo()} ghost /><RowPopoverHost /></>)
    expect(count()).toBeNull()
    expect(document.querySelector('[data-subtask-count]')).toHaveTextContent('1/2')
  })

  it('a click opens the popover with the first open subtask focused; a check writes and the count follows; Esc closes it and the focus goes back', async () => {
    await seed(['[x] a', 'b', 'c'])
    render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
    fireEvent.click(count()!)
    expect(popover()).toBeInTheDocument()
    expect(count()).toHaveAttribute('aria-expanded', 'true')
    expect(count()).toHaveAttribute('data-open')
    const b = within(popover()).getByRole('checkbox', { name: 'Check b' })
    expect(document.activeElement).toBe(b)
    expect(within(popover()).getByText('1 of 3')).toBeInTheDocument()

    await act(async () => { fireEvent.click(b) })
    expect((await db.subtasks.where('todoId').equals(1).sortBy('sortOrder')).map((s) => s.isCompleted)).toEqual([true, true, false])
    // The store follows the stored row: wait on what it drives, not one read.
    await waitFor(() => expect(count()).toHaveTextContent('2/3'))
    expect(within(popover()).getByText('2 of 3')).toBeInTheDocument()
    // The check stamped the task (activity), stored and shown.
    expect((await db.todos.get(1))?.modifiedAt.getTime()).toBeGreaterThan(new Date(2026, 0, 1).getTime())
    await waitFor(() => expect(todo().modifiedAt.getTime()).toBeGreaterThan(new Date(2026, 0, 1).getTime()))

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Subtasks of Q4 budget' })).toBeNull()
    expect(document.activeElement).toBe(count())
  })

  it('⏎ in the popover’s add row adds a subtask last; every subtask done focuses the add row', async () => {
    await seed(['[x] a'])
    render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
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
    render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
    fireEvent.contextMenu(document.querySelector('[data-todo-id]')!, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add subtask…' }))
    const dialog = popover()
    const add = within(dialog).getByRole('textbox', { name: 'New subtask' })
    expect(document.activeElement).toBe(add)
    // Placed by the anchor hook, at the row's add mark (never at its off-screen start).
    expect(dialog.style.position).toBe('fixed')
    fireEvent.change(add, { target: { value: 'First line' } })
    await act(async () => { fireEvent.keyDown(add, { key: 'Enter' }) })
    await vi.waitFor(() => expect(count()).toHaveTextContent('0/1'))
    expect((await db.subtasks.where('todoId').equals(1).toArray()).map((s) => s.title)).toEqual(['First line'])
  })
})

describe('TaskRow — the add-subtasks mark without a checklist', () => {
  const add = () => screen.queryByRole('button', { name: 'Add subtasks' })

  it('stands after the title of an open task with no subtasks, hidden until the row is hovered (CSS); a click opens the empty checklist on its add field', async () => {
    await seed([])
    render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
    const mark = add()!
    expect(mark).toHaveAttribute('data-row-cell', 'subtasks')
    expect(mark.className).toMatch(/subtaskAdd/)
    expect(mark.closest('[data-task-title]')).not.toBeNull()
    fireEvent.click(mark)
    const dialog = popover()
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'New subtask' }))
    expect(mark).toHaveAttribute('aria-expanded', 'true')
    expect(mark).toHaveAttribute('data-open')
    fireEvent.change(document.activeElement!, { target: { value: 'First line' } })
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }) })
    // The first subtask: the count takes the mark's place.
    await vi.waitFor(() => expect(count()).toHaveTextContent('0/1'))
    expect(add()).toBeNull()
  })

  it('is absent on a task with subtasks, a completed task and the drag ghost', async () => {
    await seed(['a'])
    const { unmount } = render(<><TaskRow todo={todo()} /><RowPopoverHost /></>)
    expect(add()).toBeNull()
    unmount()
    await resetDb()
    await seed([])
    const done = render(<TaskRow todo={{ ...todo(), isCompleted: true, completedAt: new Date() }} />)
    expect(add()).toBeNull()
    done.unmount()
    render(<TaskRow todo={todo()} ghost />)
    expect(add()).toBeNull()
  })

  it('the Stacked zoom shows it in the details line', async () => {
    await seed([])
    render(<><TaskRow todo={todo()} stacked /><RowPopoverHost /></>)
    expect(add()!.closest('[data-stacked-details]')).not.toBeNull()
  })
})

describe('MobileTaskRow — the subtask count', () => {
  const rowCount = () => document.querySelector('[data-row-details] [data-subtask-count]')

  it('shows `1/3` on the details line with nothing to press; the menu’s Add subtask… opens the checklist as a sheet, whose checks write', async () => {
    await seed(['[x] a', 'b', 'c'])
    render(<><MobileTaskRow todo={todo()} /><RowPopoverHost /></>)
    expect(rowCount()).toHaveTextContent('1/3')
    expect(rowCount()!.tagName).toBe('SPAN')
    fireEvent.contextMenu(document.querySelector('[data-todo-id]')!, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add subtask…' }))
    const sheet = screen.getByRole('dialog', { name: 'Subtasks of Q4 budget' })
    expect(sheet).toHaveAttribute('data-subtasks-sheet')
    await act(async () => { fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Check c' })) })
    expect((await db.subtasks.where('todoId').equals(1).sortBy('sortOrder')).map((s) => s.isCompleted)).toEqual([true, false, true])
    await waitFor(() => expect(rowCount()).toHaveTextContent('2/3'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Subtasks of Q4 budget' })).toBeNull()
  })

  it('shows no count without subtasks', async () => {
    await seed([])
    render(<><MobileTaskRow todo={todo()} /><RowPopoverHost /></>)
    expect(rowCount()).toBeNull()
  })
})
