// The task picker (cr28, T3): the search narrows by title, open tasks come
// first and completed ones after (muted), the excluded ids never show, ↑↓
// move the highlight and ⏎ picks it, a click picks a row. The host opens it
// for a task (Make subtask of…) or a subtask (Move to another task…).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { TaskPickerDialog } from '../../../components/task/subtasks/TaskPickerDialog'
import { TaskPickerHost } from '../../../components/overlays/TaskPickerHost'
import { db } from '../../../data/database'
import { useSettingsStore } from '../../../stores/settings-store'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { makeTodo, resetDb } from '../../helpers'

afterEach(cleanup)

const options = () => screen.getAllByRole('option').map((o) => [o.textContent, o.getAttribute('aria-selected') === 'true'])

describe('TaskPickerDialog', () => {
  beforeEach(() => {
    useTodoStore.setState({ todos: [
      makeTodo({ id: 1, title: 'Offsite', sortOrder: 0 }),
      makeTodo({ id: 2, title: 'Spring offsite recap', isCompleted: true, completedAt: new Date(2026, 3, 12), sortOrder: 1 }),
      makeTodo({ id: 3, title: 'Offsite catering', sortOrder: 2 }),
      makeTodo({ id: 4, title: 'Book travel', sortOrder: 3 }),
    ] })
    useSubtaskStore.setState({ byTodo: new Map([[1, [
      { id: 1, todoId: 1, title: 'a', isCompleted: false, sortOrder: 0, createdAt: new Date() },
      { id: 2, todoId: 1, title: 'b', isCompleted: true, sortOrder: 1, createdAt: new Date() },
    ]]]) })
  })

  it('lists tasks open first then completed, with their checklist or completion as a note; the excluded one is left out', () => {
    render(<TaskPickerDialog title="Make “Book travel” a subtask of…" excludeIds={new Set([4])} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Make “Book travel” a subtask of…' })).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Find a task' }))
    expect(options()).toEqual([['Offsite2 subtasks', true], ['Offsite catering', false], ['Spring offsite recapCompleted 04/12', false]])
    expect(screen.getByRole('option', { name: /Spring offsite recap/ })).toHaveAttribute('data-done')
  })

  it('the search narrows by title; ↑↓ move the highlight and ⏎ picks it; a click picks a row', () => {
    const onPick = vi.fn()
    render(<TaskPickerDialog title="Pick" excludeIds={new Set()} onPick={onPick} onClose={vi.fn()} />)
    const search = screen.getByRole('combobox', { name: 'Find a task' })
    fireEvent.change(search, { target: { value: 'offs' } })
    expect(options().map(([t]) => t)).toEqual(['Offsite2 subtasks', 'Offsite catering', 'Spring offsite recapCompleted 04/12'])
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(options().map(([, on]) => on)).toEqual([false, true, false])
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(options().map(([, on]) => on)).toEqual([false, false, true])
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(3)
    fireEvent.click(screen.getByRole('option', { name: /^Offsite2/ }))
    expect(onPick).toHaveBeenCalledWith(1)
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No task matches')).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledTimes(2)
  })

  it('a combobox over the list: the highlight is its active descendant, kept in view; options are no tab stops (cr31 T12)', () => {
    const scrolled: Element[] = []
    const had = 'scrollIntoView' in Element.prototype
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: function (this: Element) { scrolled.push(this) }, configurable: true, writable: true })
    try {
      render(<TaskPickerDialog title="Pick" excludeIds={new Set()} onPick={vi.fn()} onClose={vi.fn()} />)
      const search = screen.getByRole('combobox', { name: 'Find a task' })
      const list = screen.getByRole('listbox', { name: 'Tasks' })
      expect(search.getAttribute('aria-controls')).toBe(list.id)
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      const second = screen.getAllByRole('option')[1]!
      expect(search.getAttribute('aria-activedescendant')).toBe(second.id)
      expect(scrolled.at(-1)).toBe(second)
      for (const option of screen.getAllByRole('option')) expect(option.getAttribute('tabindex')).toBe('-1')
    } finally {
      if (!had) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('Esc closes it', () => {
    const onClose = vi.fn()
    render(<TaskPickerDialog title="Pick" excludeIds={new Set()} onPick={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Find a task' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('TaskPickerHost', () => {
  beforeEach(async () => {
    await resetDb()
    useUIStore.setState({ taskPicker: null })
    // New tasks get no next follow-up here, so a bare task converts without a prompt.
    useSettingsStore.setState({ autoFollowup: false })
  })

  it('opens the picker for a task, without the task itself; a pick closes it and converts the task', async () => {
    const a = await useTodoStore.getState().add('Book travel')
    const b = await useTodoStore.getState().add('Offsite')
    render(<TaskPickerHost />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useUIStore.getState().openTaskPicker({ kind: 'make-subtask', todoId: a }))
    const dialog = screen.getByRole('dialog', { name: 'Make “Book travel” a subtask of…' })
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Offsite'])
    await act(async () => { fireEvent.click(within(dialog).getByRole('option', { name: 'Offsite' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(async () => expect(await db.todos.get(a)).toBeUndefined())
    expect((await db.subtasks.where('todoId').equals(b).toArray()).map((s) => s.title)).toEqual(['Book travel'])
  })

  it('opens the picker for a subtask, without its own task; a pick moves it there', async () => {
    const a = await useTodoStore.getState().add('Offsite')
    const b = await useTodoStore.getState().add('Q4 budget')
    const sub = await useSubtaskStore.getState().add(a, 'Book the venue')
    render(<TaskPickerHost />)
    act(() => useUIStore.getState().openTaskPicker({ kind: 'move-subtask', subtaskId: sub!.id }))
    const dialog = screen.getByRole('dialog', { name: 'Move “Book the venue” to…' })
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Q4 budget'])
    await act(async () => { fireEvent.click(within(dialog).getByRole('option', { name: 'Q4 budget' })) })
    await vi.waitFor(async () => expect((await db.subtasks.get(sub!.id))?.todoId).toBe(b))
    expect(useUIStore.getState().taskPicker).toBeNull()
  })

  it('closes on its own when what it was opened for is gone', async () => {
    const a = await useTodoStore.getState().add('Gone soon')
    render(<TaskPickerHost />)
    act(() => useUIStore.getState().openTaskPicker({ kind: 'make-subtask', todoId: a }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => { await useTodoStore.getState().remove(a) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useUIStore.getState().taskPicker).toBeNull()
  })
})
