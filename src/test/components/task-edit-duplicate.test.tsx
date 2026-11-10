// Duplicate in the task editor switches it to the copy: a status update or a
// subtask typed but not yet added goes to the task it was typed for, never to
// the copy the editor shows next.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskEditPopupHost } from '../../components/task/TaskEditPopupHost'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

async function addTodo(title: string): Promise<number> {
  const now = new Date()
  return db.todos.add({ uid: `uid-${title}`, title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
}

beforeEach(async () => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const updatesOf = async (todoId: number) =>
  (await db.statusUpdates.where('todoId').equals(todoId).toArray()).map((u) => u.text)
const subtasksOf = async (todoId: number) =>
  (await db.subtasks.where('todoId').equals(todoId).toArray()).map((s) => s.title)

describe('TaskEditPopup Duplicate with a line still being typed', () => {
  it('writes the typed status update and subtask to the original task, not the copy', async () => {
    const id = await addTodo('Original')
    await useTodoStore.getState().loadAll()
    await useStatusUpdateStore.getState().load()
    await useSubtaskStore.getState().load()
    act(() => useUIStore.getState().openEditPopup(id))
    render(<TaskEditPopupHost />)

    fireEvent.change(screen.getByRole('textbox', { name: 'New status update' }), { target: { value: 'typed for A' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'New subtask' }), { target: { value: 'step for A' } })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' })) })

    // The editor now shows the copy.
    await vi.waitFor(() => expect(useUIStore.getState().selectedTodoId).not.toBe(id))
    const copyId = useUIStore.getState().selectedTodoId!
    expect((screen.getByRole('textbox', { name: 'New status update' }) as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('textbox', { name: 'New subtask' }) as HTMLInputElement).value).toBe('')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })) })

    await vi.waitFor(async () => expect(await updatesOf(id)).toEqual(['typed for A']))
    await vi.waitFor(async () => expect(await subtasksOf(id)).toEqual(['step for A']))
    expect(await updatesOf(copyId)).toEqual([])
    expect(await subtasksOf(copyId)).toEqual([])
  })
})
