import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

/**
 * cr33 T2: the cr32 stamp rule (`utils/task-stamps`) through a task's own
 * rows — its subtasks and its status updates. Each step stamps the task's
 * `modifiedAt`; its undo puts back the stamp the task had before, its redo
 * the stamp the step wrote. Stored and in the store alike. The todo-store
 * paths are in `undo-modified-at.test.ts`.
 */

const T0 = new Date(2026, 9, 1, 9, 0) // when the task was last touched (stale)
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

/** Sets a task's `modifiedAt`, stored and shown (a write with no undo step of its own). */
async function setStamp(id: number, at: Date): Promise<void> {
  await db.todos.update(id, { modifiedAt: at })
  useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: at } : t)) })
}

/** Makes the task stale at `T0` with an empty undo stack — after `setup` has given it its rows. */
async function staleTask(setup: (id: number) => Promise<unknown> = async () => {}): Promise<number> {
  const id = await addTask('Quote')
  await setup(id)
  await setStamp(id, T0)
  useUndoStore.getState().clear()
  return id
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
 * Runs `step` at a time of its own on task `id` (stale at T0), then checks:
 * the task carries the step's stamp and `after` holds; undo (later) puts back
 * T0 and `before` holds; redo (later still) puts back the step's stamp and
 * `after` holds again.
 */
async function expectRoundTrip(
  id: number,
  step: () => Promise<unknown>,
  before: () => Promise<void> | void,
  after: () => Promise<void> | void,
): Promise<void> {
  const wrote = later(1)
  await step()
  expect(await stamp(id)).toEqual(wrote)
  await after()
  later(2)
  await useUndoStore.getState().undo()
  expect(await stamp(id)).toEqual(T0)
  await before()
  later(3)
  await useUndoStore.getState().redo()
  expect(await stamp(id)).toEqual(wrote)
  await after()
}

/** The task's subtasks as `title:done`, in order — stored and shown, which must agree. */
async function subtasks(todoId: number): Promise<string[]> {
  const stored = (await db.subtasks.where('todoId').equals(todoId).sortBy('sortOrder')).map((s) => `${s.title}:${s.isCompleted}`)
  const shown = (useSubtaskStore.getState().byTodo.get(todoId) ?? []).map((s) => `${s.title}:${s.isCompleted}`)
  expect(shown).toEqual(stored)
  return stored
}

/** The task's status updates' text, newest first — shown, and the same set stored. */
async function updates(todoId: number): Promise<string[]> {
  const stored = (await db.statusUpdates.where('todoId').equals(todoId).toArray()).map((u) => u.text).sort()
  const shown = (useStatusUpdateStore.getState().byTodo.get(todoId) ?? []).map((u) => u.text)
  expect([...shown].sort()).toEqual(stored)
  return shown
}

/** The id of the task's subtask titled `title`. */
function subtaskId(todoId: number, title: string): number {
  const row = (useSubtaskStore.getState().byTodo.get(todoId) ?? []).find((s) => s.title === title)
  expect(row).toBeDefined()
  return row?.id ?? -1
}

/** The id of the task's status update reading `text`. */
function updateId(todoId: number, text: string): number {
  const row = (useStatusUpdateStore.getState().byTodo.get(todoId) ?? []).find((u) => u.text === text)
  expect(row).toBeDefined()
  return row?.id ?? -1
}

describe('a subtask step: undo puts back the task’s earlier Modified date, redo the one the step wrote', () => {
  it('add', async () => {
    const id = await staleTask()
    await expectRoundTrip(
      id,
      () => useSubtaskStore.getState().add(id, 'Call the vendor'),
      async () => { expect(await subtasks(id)).toEqual([]) },
      async () => { expect(await subtasks(id)).toEqual(['Call the vendor:false']) },
    )
  })

  it('check and uncheck (setDone)', async () => {
    const id = await staleTask(async (t) => {
      await useSubtaskStore.getState().add(t, 'Call the vendor')
      await useSubtaskStore.getState().add(t, 'Send the quote')
    })
    const sub = subtaskId(id, 'Call the vendor')
    await expectRoundTrip(
      id,
      () => useSubtaskStore.getState().setDone(sub, true),
      async () => { expect(await subtasks(id)).toEqual(['Call the vendor:false', 'Send the quote:false']) },
      async () => { expect(await subtasks(id)).toEqual(['Call the vendor:true', 'Send the quote:false']) },
    )
    await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip(
      id,
      () => useSubtaskStore.getState().setDone(sub, false),
      async () => { expect(await subtasks(id)).toEqual(['Call the vendor:true', 'Send the quote:false']) },
      async () => { expect(await subtasks(id)).toEqual(['Call the vendor:false', 'Send the quote:false']) },
    )
  })

  it('rename', async () => {
    const id = await staleTask(async (t) => { await useSubtaskStore.getState().add(t, 'Call the vendor') })
    const sub = subtaskId(id, 'Call the vendor')
    await expectRoundTrip(
      id,
      () => useSubtaskStore.getState().rename(sub, 'Email the vendor'),
      async () => { expect(await subtasks(id)).toEqual(['Call the vendor:false']) },
      async () => { expect(await subtasks(id)).toEqual(['Email the vendor:false']) },
    )
  })

  it('move (reorder)', async () => {
    const id = await staleTask(async (t) => {
      await useSubtaskStore.getState().add(t, 'A')
      await useSubtaskStore.getState().add(t, 'B')
    })
    const b = subtaskId(id, 'B')
    await expectRoundTrip(
      id,
      () => useSubtaskStore.getState().move(b, 0),
      async () => { expect(await subtasks(id)).toEqual(['A:false', 'B:false']) },
      async () => { expect(await subtasks(id)).toEqual(['B:false', 'A:false']) },
    )
  })

  it('remove', async () => {
    const id = await staleTask(async (t) => { await useSubtaskStore.getState().add(t, 'Call the vendor', { done: true }) })
    const sub = subtaskId(id, 'Call the vendor')
    await expectRoundTrip(
      id,
      () => useSubtaskStore.getState().remove(sub),
      async () => { expect(await subtasks(id)).toEqual(['Call the vendor:true']) },
      async () => { expect(await subtasks(id)).toEqual([]) },
    )
  })
})

describe('a status-update step: undo puts back the task’s earlier Modified date, redo the one the step wrote', () => {
  it('add (the store’s, no follow-up)', async () => {
    const id = await staleTask()
    await expectRoundTrip(
      id,
      () => useStatusUpdateStore.getState().add(id, { date: NOW, text: 'Sent it' }),
      async () => { expect(await updates(id)).toEqual([]) },
      async () => { expect(await updates(id)).toEqual(['Sent it']) },
    )
  })

  it('edit the text, then the day', async () => {
    const id = await staleTask(async (t) => { await useStatusUpdateStore.getState().add(t, { date: NOW, text: 'Sent it' }) })
    const entry = updateId(id, 'Sent it')
    await expectRoundTrip(
      id,
      () => useStatusUpdateStore.getState().update(entry, { text: 'Sent it twice' }),
      async () => { expect(await updates(id)).toEqual(['Sent it']) },
      async () => { expect(await updates(id)).toEqual(['Sent it twice']) },
    )
    await setStamp(id, T0)
    useUndoStore.getState().clear()
    const day = (): number | undefined => useStatusUpdateStore.getState().byTodo.get(id)?.at(0)?.date.getTime()
    const today = day()
    const yesterday = new Date(2026, 10, 9)
    await expectRoundTrip(
      id,
      () => useStatusUpdateStore.getState().update(entry, { date: yesterday }),
      () => { expect(day()).toBe(today) },
      () => { expect(day()).toBe(yesterday.getTime()) },
    )
  })

  it('remove', async () => {
    const id = await staleTask(async (t) => {
      await useStatusUpdateStore.getState().add(t, { date: new Date(2026, 10, 9), text: 'Called them' })
      await useStatusUpdateStore.getState().add(t, { date: NOW, text: 'Sent it' })
    })
    const entry = updateId(id, 'Sent it')
    await expectRoundTrip(
      id,
      () => useStatusUpdateStore.getState().remove(entry),
      async () => { expect(await updates(id)).toEqual(['Sent it', 'Called them']) },
      async () => { expect(await updates(id)).toEqual(['Called them']) },
    )
  })
})

describe('a task touched since a subtask or status-update step keeps its newer Modified date', () => {
  it('through the undo and the redo of a subtask check', async () => {
    const id = await staleTask(async (t) => { await useSubtaskStore.getState().add(t, 'Call the vendor') })
    const sub = subtaskId(id, 'Call the vendor')
    later(1)
    await useSubtaskStore.getState().setDone(sub, true)
    const touched = later(2)
    await setStamp(id, touched)
    later(3)
    await useUndoStore.getState().undo()
    expect(await subtasks(id)).toEqual(['Call the vendor:false'])
    expect(await stamp(id)).toEqual(touched)
    later(4)
    await useUndoStore.getState().redo()
    expect(await subtasks(id)).toEqual(['Call the vendor:true'])
    expect(await stamp(id)).toEqual(touched)
  })

  it('through the undo of a status-update removal', async () => {
    const id = await staleTask(async (t) => { await useStatusUpdateStore.getState().add(t, { date: NOW, text: 'Sent it' }) })
    later(1)
    await useStatusUpdateStore.getState().remove(updateId(id, 'Sent it'))
    const touched = later(2)
    await setStamp(id, touched)
    later(3)
    await useUndoStore.getState().undo()
    expect(await updates(id)).toEqual(['Sent it'])
    expect(await stamp(id)).toEqual(touched)
  })
})
