import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data'
import { droppedFields } from '../../services/subtask-convert'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

/**
 * A task's Do day (`doDate`, schema v85 — the Planner's): `setDoDate` sets or
 * clears it as one undo step, and planning is not an edit — the write, its
 * undo and its redo leave `modifiedAt` as it is, stored and in the store,
 * and log no history event. Completing a repeating task clears it on the
 * next occurrence; Duplicate and Make subtask of… leave it behind.
 */

const T0 = new Date(2026, 9, 1, 9, 0) // when the tasks were last touched
const NOW = new Date(2026, 10, 10, 12, 0)
const FRI = new Date(2026, 10, 13)
const MON = new Date(2026, 10, 16)

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Tasks last modified at `T0`, stored and shown, with an empty undo stack. */
async function tasks(...titles: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const title of titles) ids.push(await addTask(title))
  for (const id of ids) await patch(id, { modifiedAt: T0 })
  useUndoStore.getState().clear()
  return ids
}

/** Writes fields to a task, stored and shown, with no undo step and no stamp. */
async function patch(id: number, fields: Record<string, unknown>): Promise<void> {
  await db.todos.update(id, fields)
  useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, ...fields } : t)) })
}

/** The task's Do day and `modifiedAt` — stored and shown, which must agree. */
async function planned(id: number): Promise<{ doDate: Date | undefined; modifiedAt: Date | undefined }> {
  const stored = await db.todos.get(id)
  const shown = useTodoStore.getState().todos.find((t) => t.id === id)
  expect(shown?.doDate?.getTime()).toBe(stored?.doDate?.getTime())
  expect(shown?.modifiedAt.getTime()).toBe(stored?.modifiedAt.getTime())
  return { doDate: stored?.doDate, modifiedAt: stored?.modifiedAt }
}

const later = (minutes: number) => { vi.setSystemTime(new Date(NOW.getTime() + minutes * 60_000)) }
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const eventCount = (todoId: number) => db.todoEvents.where('todoId').equals(todoId).count()

describe('setDoDate', () => {
  it('sets the day at local midnight, stored and shown, as one quiet undo step', async () => {
    const [id] = await tasks('Quote') as [number]
    later(1)
    await useTodoStore.getState().setDoDate([id], new Date(2026, 10, 13, 15, 45))
    expect(await planned(id)).toEqual({ doDate: FRI, modifiedAt: T0 })
    expect(undoNames()).toEqual(['Set Do day of “Quote”'])
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('never stamps the task: not on the write, its undo or its redo', async () => {
    const [id] = await tasks('Quote') as [number]
    later(1)
    await useTodoStore.getState().setDoDate([id], FRI)
    expect(await planned(id)).toEqual({ doDate: FRI, modifiedAt: T0 })
    later(2)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual({ doDate: undefined, modifiedAt: T0 })
    expect('doDate' in (await db.todos.get(id))!).toBe(false)
    later(3)
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual({ doDate: FRI, modifiedAt: T0 })
    later(4)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual({ doDate: undefined, modifiedAt: T0 })
  })

  it('clears it with undefined; the undo puts the day back', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    later(1)
    await useTodoStore.getState().setDoDate([id], undefined)
    expect(await planned(id)).toEqual({ doDate: undefined, modifiedAt: T0 })
    expect(undoNames()).toEqual(['Cleared Do day of “Quote”'])
    later(2)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual({ doDate: FRI, modifiedAt: T0 })
    later(3)
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual({ doDate: undefined, modifiedAt: T0 })
  })

  it('moves several tasks in one step, named by their count; each gets its own day back', async () => {
    const [a, b, c] = await tasks('A', 'B', 'C') as [number, number, number]
    await patch(a, { doDate: FRI })
    later(1)
    await useTodoStore.getState().setDoDate([a, b], MON)
    expect(undoNames()).toEqual(['Set Do day of 2 tasks'])
    expect((await planned(a)).doDate).toEqual(MON)
    expect((await planned(b)).doDate).toEqual(MON)
    expect((await planned(c)).doDate).toBeUndefined()
    await useUndoStore.getState().undo()
    expect(await planned(a)).toEqual({ doDate: FRI, modifiedAt: T0 })
    expect(await planned(b)).toEqual({ doDate: undefined, modifiedAt: T0 })

    await useTodoStore.getState().setDoDate([a, b], undefined)
    expect(undoNames()).toEqual(['Cleared Do day of 2 tasks'])
  })

  it('a task already on that day is not written: no step when nothing changes', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    const write = vi.spyOn(todoRepository, 'bulkUpdate')
    await useTodoStore.getState().setDoDate([id], new Date(2026, 10, 13, 8, 0))
    await useTodoStore.getState().setDoDate([], MON)
    expect(write).not.toHaveBeenCalled()
    expect(undoNames()).toEqual([])
  })

  it('a task touched since keeps its newer stamp through the undo and the redo', async () => {
    const [id] = await tasks('Quote') as [number]
    await useTodoStore.getState().setDoDate([id], FRI)
    const touched = new Date(NOW.getTime() + 5 * 60_000)
    await patch(id, { modifiedAt: touched })
    later(6)
    await useUndoStore.getState().undo()
    expect(await planned(id)).toEqual({ doDate: undefined, modifiedAt: touched })
    later(7)
    await useUndoStore.getState().redo()
    expect(await planned(id)).toEqual({ doDate: FRI, modifiedAt: touched })
  })

  it('logs no history event: not on set, clear, undo or redo', async () => {
    const [id] = await tasks('Quote') as [number]
    const before = await eventCount(id)
    await useTodoStore.getState().setDoDate([id], FRI)
    await useTodoStore.getState().setDoDate([id], MON)
    await useTodoStore.getState().setDoDate([id], undefined)
    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    await useUndoStore.getState().redo()
    expect(await eventCount(id)).toBe(before)
  })

  it('a failed write puts the day back and adds no step', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValueOnce(new Error('disk full'))
    await expect(useTodoStore.getState().setDoDate([id], MON)).rejects.toThrow('disk full')
    expect(await planned(id)).toEqual({ doDate: FRI, modifiedAt: T0 })
    expect(undoNames()).toEqual([])
  })

  it('an edit of another field leaves the day alone (and stamps, as ever)', async () => {
    const [id] = await tasks('Quote') as [number]
    await useTodoStore.getState().setDoDate([id], FRI)
    later(1)
    await useTodoStore.getState().update(id, { title: 'Quote v2' })
    const after = await planned(id)
    expect(after.doDate).toEqual(FRI)
    expect(after.modifiedAt).toEqual(new Date(NOW.getTime() + 60_000))
  })
})

describe('what leaves the Do day behind', () => {
  it('Duplicate: the copy is not planned', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI, dueDate: MON, notes: 'n' })
    const copy = await useTodoStore.getState().duplicate(id)
    expect(copy).toBeDefined()
    const stored = await db.todos.get(copy!)
    expect(stored).toMatchObject({ title: 'Quote', dueDate: MON, notes: 'n' })
    expect('doDate' in stored!).toBe(false)
    expect(useTodoStore.getState().todos.find((t) => t.id === copy)?.doDate).toBeUndefined()
    expect((await planned(id)).doDate).toEqual(FRI)
  })

  it('Make subtask of…: it goes with the task unnamed — a task holding only its title and a Do day asks nothing', async () => {
    const [id] = await tasks('Quote') as [number]
    await patch(id, { doDate: FRI, nextFollowupAt: undefined, statusId: undefined })
    expect(droppedFields(id)).toEqual([])
  })
})
