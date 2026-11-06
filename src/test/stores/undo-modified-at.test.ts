import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { addStatusUpdate, markFollowedUpWithUpdate } from '../../services/mark-followed-up'
import { makeSubtaskOf, makeTaskFromSubtask } from '../../services/subtask-convert'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

/**
 * cr32: one rule for a task's `modifiedAt` across undo / redo — an undo puts
 * back the stamp the task had before the step, a redo the stamp the step
 * wrote, each only while the task still holds the other (a task touched
 * since keeps its newer stamp). Stored and in the store alike.
 */

const T0 = new Date(2026, 9, 1, 9, 0) // when the tasks were last touched (stale)
const NOW = new Date(2026, 10, 10, 12, 0)

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useSettingsStore.setState({ autoFollowup: false })
})
afterEach(() => { vi.useRealTimers() })

/** Tasks last modified at `T0`, in the database and the store, with an empty undo stack. */
async function staleTasks(...titles: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const title of titles) ids.push(await addTask(title))
  for (const id of ids) await setStamp(id, T0)
  useUndoStore.getState().clear()
  return ids
}

/** Sets a task's `modifiedAt`, stored and shown (a write with no undo step of its own). */
async function setStamp(id: number, at: Date): Promise<void> {
  await db.todos.update(id, { modifiedAt: at })
  useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: at } : t)) })
}

/** The task's `modifiedAt` — stored and shown, which must agree. */
async function stamp(id: number): Promise<Date | undefined> {
  const stored = (await db.todos.get(id))?.modifiedAt
  const shown = useTodoStore.getState().todos.find((t) => t.id === id)?.modifiedAt
  expect(shown?.getTime()).toBe(stored?.getTime())
  return stored
}

/** Moves the clock on, so the step, its undo and its redo each run at their own time. */
function later(minutes: number): Date {
  const at = new Date(NOW.getTime() + minutes * 60_000)
  vi.setSystemTime(at)
  return at
}

/**
 * Runs `step` at a time of its own on tasks `ids` (stale at T0), then checks:
 * every task carries the step's stamp; undo (later) puts back T0; redo (later
 * still) puts back the step's stamp.
 */
async function expectRoundTrip(ids: readonly number[], step: () => Promise<unknown>): Promise<void> {
  const wrote = later(1)
  await step()
  for (const id of ids) expect(await stamp(id)).toEqual(wrote)
  later(2)
  await useUndoStore.getState().undo()
  for (const id of ids) expect(await stamp(id)).toEqual(T0)
  later(3)
  await useUndoStore.getState().redo()
  for (const id of ids) expect(await stamp(id)).toEqual(wrote)
}

describe('undo puts back the task’s earlier Modified date, redo the one the step wrote', () => {
  it('a field edit (the editor’s update)', async () => {
    const [id] = await staleTasks('Quote') as [number]
    await expectRoundTrip([id], () => useTodoStore.getState().update(id, { title: 'Quote v2' }))
  })

  it('a completion and a reopen', async () => {
    const [id] = await staleTasks('Quote') as [number]
    await expectRoundTrip([id], () => useTodoStore.getState().toggleComplete(id))
    await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip([id], () => useTodoStore.getState().toggleComplete(id))
  })

  it('a recurring task’s advance', async () => {
    const [id] = await staleTasks('Report') as [number]
    await useTodoStore.getState().update(id, {
      dueDate: new Date(2026, 10, 10),
      recurrenceRule: { type: 'daily' },
    })
    await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip([id], () => useTodoStore.getState().toggleComplete(id))
    // The advance, not a completion.
    expect(useTodoStore.getState().todos.find((t) => t.id === id)).toMatchObject({ isCompleted: false, dueDate: new Date(2026, 10, 11) })
  })

  it('a bulk completion, a bulk field, the marker flags', async () => {
    const ids = await staleTasks('A', 'B')
    await expectRoundTrip(ids, () => useTodoStore.getState().bulkSetCompleted(ids, true))
    for (const id of ids) await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip(ids, () => useTodoStore.getState().bulkSetDeadline(ids, new Date(2026, 10, 20)))
    for (const id of ids) await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip(ids, () => useTodoStore.getState().setMarkerFlags(ids.map((todoId) => ({ todoId, urgent: true })), 'Flag'))
  })

  it('a bulk completion of tasks already complete: their stamps come back too', async () => {
    const ids = await staleTasks('A', 'B')
    await useTodoStore.getState().toggleComplete(ids[0]!)
    for (const id of ids) await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip(ids, () => useTodoStore.getState().bulkSetCompleted(ids, true))
  })

  it('Mark followed up, alone and with a status update (one step of two writes)', async () => {
    const [a, b] = await staleTasks('A', 'B') as [number, number]
    await expectRoundTrip([a], () => useTodoStore.getState().markFollowedUp([a]))
    await expectRoundTrip([b], () => markFollowedUpWithUpdate([b], {}, 'Called them'))
  })

  it('a status update entered as a follow-up (addStatusUpdate)', async () => {
    const [id] = await staleTasks('Quote') as [number]
    await expectRoundTrip([id], () => addStatusUpdate(id, { date: NOW, text: 'Sent it' }))
  })

  it('Make subtask of…: the parent’s earlier stamp comes back with the task', async () => {
    const [task, parent] = await staleTasks('Child', 'Parent') as [number, number]
    later(1)
    expect(await makeSubtaskOf(task, parent)).toBe(true)
    later(2)
    await useUndoStore.getState().undo()
    expect(await stamp(parent)).toEqual(T0)
    expect(await stamp(task)).toEqual(T0)
  })

  it('Make a task: the parent’s earlier stamp comes back', async () => {
    const [parent] = await staleTasks('Parent') as [number]
    const sub = await useSubtaskStore.getState().add(parent, 'Line')
    await setStamp(parent, T0)
    useUndoStore.getState().clear()
    later(1)
    expect(await makeTaskFromSubtask(sub!.id)).not.toBeNull()
    expect(await stamp(parent)).toEqual(later(1))
    later(2)
    await useUndoStore.getState().undo()
    expect(await stamp(parent)).toEqual(T0)
  })

  it('a status deleted from Settings, cleared from its tasks', async () => {
    const statusId = await useStatusStore.getState().add('Waiting')
    const [id] = await staleTasks('Quote') as [number]
    await useTodoStore.getState().update(id, { statusId })
    await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip([id], () => useStatusStore.getState().remove(statusId))
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.statusId).toBeUndefined()
  })

  it('a delete’s undo puts the task back with its stored stamp', async () => {
    const [id] = await staleTasks('Quote') as [number]
    later(1)
    await useTodoStore.getState().remove(id)
    later(2)
    await useUndoStore.getState().undo()
    expect(await stamp(id)).toEqual(T0)
  })
})

describe('a task touched since the step keeps its newer Modified date', () => {
  it('through the undo and the redo of a field edit', async () => {
    const [id] = await staleTasks('Quote') as [number]
    later(1)
    await useTodoStore.getState().update(id, { title: 'Quote v2' })
    const touched = later(2)
    await setStamp(id, touched)
    later(3)
    await useUndoStore.getState().undo()
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.title).toBe('Quote')
    expect(await stamp(id)).toEqual(touched)
    later(4)
    await useUndoStore.getState().redo()
    expect(useTodoStore.getState().todos.find((t) => t.id === id)?.title).toBe('Quote v2')
    expect(await stamp(id)).toEqual(touched)
  })

  it('through the undo of a bulk field and of Mark followed up', async () => {
    const [a, b] = await staleTasks('A', 'B') as [number, number]
    later(1)
    await useTodoStore.getState().bulkSetFocus([a, b], true)
    const touched = later(2)
    await setStamp(a, touched)
    await useUndoStore.getState().undo()
    expect(await stamp(a)).toEqual(touched)
    expect(await stamp(b)).toEqual(T0)

    useUndoStore.getState().clear()
    later(3)
    await useTodoStore.getState().markFollowedUp([b])
    const again = later(4)
    await setStamp(b, again)
    await useUndoStore.getState().undo()
    expect(await stamp(b)).toEqual(again)
  })

  it('two steps on one task undo back through each other', async () => {
    const [id] = await staleTasks('Quote') as [number]
    const first = later(1)
    await useTodoStore.getState().update(id, { title: 'Quote v2' })
    later(2)
    await useTodoStore.getState().bulkSetUrgent([id], true)
    await useUndoStore.getState().undo()
    expect(await stamp(id)).toEqual(first)
    await useUndoStore.getState().undo()
    expect(await stamp(id)).toEqual(T0)
  })
})
