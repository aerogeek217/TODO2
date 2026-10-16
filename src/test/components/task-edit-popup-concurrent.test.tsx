// The task editor while the same task changes elsewhere (a bulk edit, a
// calendar drop, undo): fields the user hasn't touched show the new values,
// a field being typed keeps the user's text, and saving writes only the
// fields the user changed — so nothing changed elsewhere is written back.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskEditPopupHost } from '../../components/task/TaskEditPopupHost'
import { db } from '../../data/database'
import { todoRepository } from '../../data'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useStatusStore } from '../../stores/status-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

const due = new Date(2026, 5, 15)

async function addTodo(title: string): Promise<number> {
  const now = new Date()
  return db.todos.add({ uid: `uid-${title}`, title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
}

const titleInput = () => screen.getByPlaceholderText('Task title') as HTMLInputElement
const inDb = async (id: number) => (await todoRepository.getById(id))!

beforeEach(async () => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  await resetDb()
  for (const store of [useTodoStore, useUIStore, useStatusStore]) store.setState(store.getInitialState(), true)
  useUndoStore.getState().clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openEditor(id: number) {
  await useTodoStore.getState().loadAll()
  act(() => useUIStore.getState().openEditPopup(id))
  render(<TaskEditPopupHost />)
}

describe('TaskEditPopup with concurrent changes to its task', () => {
  it('an editor opened before a bulk status / due-date change saves its title edit without reverting the bulk change', async () => {
    const id = await addTodo('Old title')
    const other = await addTodo('Other')
    const statusId = await useStatusStore.getState().add('Blocked')
    await openEditor(id)
    const save = vi.spyOn(todoRepository, 'update')

    fireEvent.change(titleInput(), { target: { value: 'New title' } })
    await act(async () => {
      await useTodoStore.getState().bulkSetStatus([id, other], statusId)
      await useTodoStore.getState().bulkSetDeadline([id, other], due)
    })
    await act(async () => { fireEvent.blur(titleInput()) })

    expect(save).toHaveBeenCalledWith(id, { title: 'New title' }, expect.any(Date))
    await vi.waitFor(async () => expect((await inDb(id)).title).toBe('New title'))
    expect(await inDb(id)).toMatchObject({ statusId, dueDate: due })
    expect(useTodoStore.getState().todos.find((t) => t.id === id)).toMatchObject({ title: 'New title', statusId, dueDate: due })
  })

  it('a title being typed survives a store change; the untouched due date shows the new value', async () => {
    const id = await addTodo('Old title')
    await openEditor(id)

    fireEvent.change(titleInput(), { target: { value: 'Half-typed tit' } })
    await act(async () => {
      await useTodoStore.getState().bulkSetDeadline([id], due)
    })

    expect(titleInput().value).toBe('Half-typed tit')
    expect(screen.getByTitle(/^Due: /)).toBeTruthy()
    // The title wasn't saved yet: the store still has the old one.
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.title).toBe('Old title')
  })

  it('a store change to a field the user has not touched replaces what the editor shows', async () => {
    const id = await addTodo('Old title')
    await openEditor(id)

    await act(async () => {
      await useTodoStore.getState().update(id, { title: 'Renamed elsewhere' })
    })
    expect(titleInput().value).toBe('Renamed elsewhere')

    // Blur without typing: nothing to save.
    const save = vi.spyOn(todoRepository, 'update')
    await act(async () => { fireEvent.blur(titleInput()) })
    expect(save).not.toHaveBeenCalled()
  })

  it('progress typed while the title changes elsewhere: each keeps its own change', async () => {
    const id = await addTodo('Old title')
    await openEditor(id)
    const progress = screen.getByPlaceholderText('e.g. 50% done, Waiting on review...') as HTMLInputElement

    fireEvent.change(progress, { target: { value: 'half done' } })
    await act(async () => {
      await useTodoStore.getState().update(id, { title: 'Renamed elsewhere' })
    })
    expect(progress.value).toBe('half done')
    expect(titleInput().value).toBe('Renamed elsewhere')
    await act(async () => { fireEvent.blur(progress) })

    await vi.waitFor(async () => expect(await inDb(id)).toMatchObject({ title: 'Renamed elsewhere', progress: 'half done' }))
  })
})
