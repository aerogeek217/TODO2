// The task editor's Subtasks section (cr28, T1): the stored checklist with
// its `2 of 5`, each write through the store in edit mode (add, check,
// rename, delete with the undo snackbar); create mode's pending rows, which
// go with the task; a draft's subtasks shown as pending.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { TaskEditPopupHost } from '../../components/task/TaskEditPopupHost'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { makeTodo, resetDb } from '../helpers'
import type { TaskDraft } from '../../services/task-draft'

beforeEach(async () => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  await resetDb()
  useUndoStore.getState().clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const section = () => screen.getByRole('region', { name: /Subtasks/ })
/** The checklist's last line, + Add subtask. */
const addField = () => within(section()).getByRole('textbox', { name: 'New subtask' }) as HTMLInputElement
const shown = () => within(section()).queryAllByRole('listitem').map((li) => [li.textContent ?? '', li.hasAttribute('data-done')])
const stored = async () => (await db.subtasks.where('todoId').equals(100).sortBy('sortOrder')).map((s) => [s.title, s.isCompleted])

async function openStored(titles: string[] = []) {
  const todo = makeTodo({ id: 100, title: 'Task' })
  await db.todos.add(todo)
  await db.subtasks.bulkAdd(titles.map((t, i) => ({
    todoId: 100, title: t.replace(/^\[x\] /, ''), isCompleted: t.startsWith('[x] '), sortOrder: i, createdAt: new Date(),
  })))
  useTodoStore.setState({ todos: [todo] })
  await useSubtaskStore.getState().load()
  act(() => useUIStore.getState().openEditPopup(100))
  render(<TaskEditPopupHost />)
  await act(async () => { await Promise.resolve() })
}

describe('TaskEditPopup — Subtasks (edit mode)', () => {
  it('lists the checklist with its count; ⏎ in the add row writes a subtask last and keeps the focus', async () => {
    await openStored(['[x] Send the template', 'Headcount'])
    expect(within(section()).getByText('1 of 2')).toBeInTheDocument()
    expect(shown()).toEqual([['Send the template', true], ['Headcount', false]])
    addField().focus()
    fireEvent.change(addField(), { target: { value: ' Travel actuals ' } })
    await act(async () => { fireEvent.keyDown(addField(), { key: 'Enter' }) })
    await vi.waitFor(async () => expect(await stored()).toEqual([['Send the template', true], ['Headcount', false], ['Travel actuals', false]]))
    expect(addField().value).toBe('')
    expect(document.activeElement).toBe(addField())
    expect(within(section()).getByText('1 of 3')).toBeInTheDocument()
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Add subtask “Travel actuals”')
  })

  it('a check, a rename and a delete write at once; the delete shows the undo snackbar and Undo puts it back', async () => {
    await openStored(['a', 'b'])
    await act(async () => { fireEvent.click(within(section()).getByRole('checkbox', { name: 'Check a' })) })
    await vi.waitFor(async () => expect(await stored()).toEqual([['a', true], ['b', false]]))
    expect(within(section()).getByText('1 of 2')).toBeInTheDocument()

    fireEvent.click(within(section()).getByRole('button', { name: 'Rename b' }))
    const field = within(section()).getByRole('textbox', { name: 'Subtask title' })
    fireEvent.change(field, { target: { value: 'b, renamed' } })
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    await vi.waitFor(async () => expect(await stored()).toEqual([['a', true], ['b, renamed', false]]))
    // Esc on the rename field never closed the editor.
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()

    fireEvent.click(within(section()).getByRole('button', { name: 'Subtask menu: a' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' })) })
    await vi.waitFor(async () => expect(await stored()).toEqual([['b, renamed', false]]))
    expect(useUndoStore.getState().snackbar?.description).toBe('Subtask removed')
    await act(async () => { await useUndoStore.getState().undo() })
    expect(await stored()).toEqual([['a', true], ['b, renamed', false]])
    expect(shown()).toEqual([['a', true], ['b, renamed', false]])
  })

  it('Esc while renaming cancels the rename and keeps the editor open', async () => {
    await openStored(['a'])
    fireEvent.click(within(section()).getByRole('button', { name: 'Rename a' }))
    const field = within(section()).getByRole('textbox', { name: 'Subtask title' })
    fireEvent.change(field, { target: { value: 'changed' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(within(section()).queryByRole('textbox', { name: 'Subtask title' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(await stored()).toEqual([['a', false]])
  })
})

describe('TaskEditPopup — Subtasks (create mode)', () => {
  function renderCreate(seed?: TaskDraft) {
    const onCreate = vi.fn().mockResolvedValue(42)
    render(
      <TaskEditPopup
        mode="create"
        seed={seed}
        assignedPeople={[]}
        allPeople={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
        onAssignPerson={vi.fn()}
        onUnassignPerson={vi.fn()}
      />,
    )
    return { onCreate }
  }

  it('subtasks added before Create wait in the list and go with the task; nothing is written before', async () => {
    const { onCreate } = renderCreate()
    fireEvent.change(screen.getByPlaceholderText(/New task/), { target: { value: 'Write the report' } })
    fireEvent.change(addField(), { target: { value: 'Outline' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    fireEvent.change(addField(), { target: { value: 'First draft' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    fireEvent.change(addField(), { target: { value: 'Review' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    fireEvent.click(within(section()).getByRole('checkbox', { name: 'Check Outline' }))
    fireEvent.click(within(section()).getByRole('button', { name: 'Subtask menu: Review' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Delete' }))
    expect(shown()).toEqual([['Outline', true], ['First draft', false]])
    expect(within(section()).getByText('1 of 2')).toBeInTheDocument()
    expect(await db.subtasks.count()).toBe(0)

    await act(async () => { fireEvent.click(screen.getByText('Create task')) })
    expect(onCreate).toHaveBeenCalledTimes(1)
    const partial = onCreate.mock.calls[0]?.[0] as { subtasks?: { title: string; isCompleted: boolean }[] }
    expect(partial.subtasks).toEqual([{ title: 'Outline', isCompleted: true }, { title: 'First draft', isCompleted: false }])
  })

  it('a draft’s subtasks show as pending (a note’s indented lines)', () => {
    renderCreate({
      title: 'Budget', urgent: false, important: false, focus: false, personIds: [], newPeople: [], tagIds: [], newTags: [],
      subtasks: [{ title: 'Collect numbers', isCompleted: false }, { title: 'Template out', isCompleted: true }],
    })
    expect(shown()).toEqual([['Collect numbers', false], ['Template out', true]])
    expect(within(section()).getByText('1 of 2')).toBeInTheDocument()
  })

  it('without subtasks the section shows only the add row, no count', () => {
    renderCreate()
    expect(within(section()).queryByRole('list')).toBeNull()
    expect(within(section()).queryByText(/ of /)).toBeNull()
  })

  it('+ Add subtask is the checklist’s last line, not a heading button', () => {
    renderCreate({
      title: 'Budget', urgent: false, important: false, focus: false, personIds: [], newPeople: [], tagIds: [], newTags: [],
      subtasks: [{ title: 'Collect numbers', isCompleted: false }],
    })
    expect(within(section()).queryByRole('button', { name: /Add subtask/ })).toBeNull()
    expect(addField()).toHaveAttribute('placeholder', 'Add subtask')
    const list = within(section()).getByRole('list', { name: 'Subtasks' })
    expect(list.compareDocumentPosition(addField()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a line typed and not added goes with the task: Create task, ⏎ in the title', async () => {
    for (const how of ['button', 'enter'] as const) {
      const { onCreate } = renderCreate()
      const titleField = screen.getByPlaceholderText(/New task/)
      fireEvent.change(titleField, { target: { value: 'Write the report' } })
      fireEvent.change(addField(), { target: { value: 'Outline' } })
      await act(async () => {
        if (how === 'button') fireEvent.click(screen.getByText('Create task'))
        else fireEvent.keyDown(titleField, { key: 'Enter' })
      })
      const partial = onCreate.mock.calls[0]?.[0] as { subtasks?: { title: string; isCompleted: boolean }[] }
      expect(partial.subtasks).toEqual([{ title: 'Outline', isCompleted: false }])
      cleanup()
    }
  })
})
