import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useUIStore } from '../../stores/ui-store'
import { addTask } from '../add-task'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.setState(useUndoStore.getInitialState(), true)
  useUIStore.setState(useUIStore.getInitialState(), true)
})

const mem = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!

describe('setMarkerFlags', () => {
  it('writes per-task flag changes as one undo step with the snackbar', async () => {
    const a = await addTask('A')
    const b = await addTask('B')
    await useTodoStore.getState().bulkSetImportant([a], true)

    await useTodoStore.getState().setMarkerFlags(
      [{ todoId: a, urgent: true, important: false }, { todoId: b, urgent: true }],
      'Marked urgent · 2 tasks',
    )
    expect(mem(a)).toMatchObject({ urgent: true })
    expect(mem(a).important).toBeUndefined()
    expect('important' in (await db.todos.get(a))!).toBe(false)
    expect((await db.todos.get(b))!.urgent).toBe(true)
    expect(useUndoStore.getState().snackbar?.description).toBe('Marked urgent · 2 tasks')

    await useUndoStore.getState().undo()
    expect(mem(a).important).toBe(true)
    expect(mem(a).urgent).toBeUndefined()
    expect((await db.todos.get(a))!.important).toBe(true)
    expect('urgent' in (await db.todos.get(b))!).toBe(false)

    await useUndoStore.getState().redo()
    expect(mem(b).urgent).toBe(true)
    expect(mem(a).important).toBeUndefined()
  })

  it('does nothing for tasks that are gone', async () => {
    await useTodoStore.getState().setMarkerFlags([{ todoId: 999, urgent: true }], 'x')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})
