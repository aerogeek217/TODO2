import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { db } from '../../data/database'
import { clearFocus, pickForToday } from '../../services/today-focus'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { addTask } from '../add-task'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

/**
 * Answer 10 (cr33): a single Focus toggle — Today's **+** — is activity on
 * the task, as every priority flag is (it stamps `modifiedAt`, its undo /
 * redo following `utils/task-stamps`); **Clear Focus…** is housekeeping: it
 * stamps nothing, and neither do its undo and redo.
 */

const T0 = new Date(2026, 9, 1, 9, 0) // when the tasks were last touched
const NOW = new Date(2026, 10, 10, 18, 0)

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

/** Tasks last touched at `T0`, with `patch`, stored and shown, and an empty undo stack. */
async function tasksAtT0(patches: Array<{ focus?: boolean; isCompleted?: boolean }>): Promise<number[]> {
  const ids: number[] = []
  for (const [i, patch] of patches.entries()) {
    const id = await addTask(`Task ${i + 1}`)
    await db.todos.update(id, { ...patch, modifiedAt: T0 })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, ...patch, modifiedAt: T0 } : t)) })
    ids.push(id)
  }
  useUndoStore.getState().clear()
  return ids
}

/** A task's `modifiedAt` and Focus, stored and shown (which must agree). */
async function read(id: number): Promise<{ modifiedAt: number | undefined; focus: boolean }> {
  const stored = await db.todos.get(id)
  const shown = useTodoStore.getState().todos.find((t) => t.id === id)
  expect(shown?.modifiedAt.getTime()).toBe(stored?.modifiedAt.getTime())
  expect(shown?.focus === true).toBe(stored?.focus === true)
  return { modifiedAt: stored?.modifiedAt.getTime(), focus: stored?.focus === true }
}

function later(minutes: number): Date {
  const at = new Date(NOW.getTime() + minutes * 60_000)
  vi.setSystemTime(at)
  return at
}

async function answer(a: true | false | 'discard') {
  await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
  act(() => useUIStore.getState().answerConfirmation(a))
}

describe('Clear Focus… is housekeeping: no task’s Modified date moves', () => {
  it('Clear all: Focus comes off every task, their stamps stay — through the undo and the redo', async () => {
    const ids = await tasksAtT0([{ focus: true }, { focus: true, isCompleted: true }])
    later(1)
    const done = clearFocus()
    await answer('discard')
    await done
    for (const id of ids) expect(await read(id)).toEqual({ modifiedAt: T0.getTime(), focus: false })
    later(2)
    await useUndoStore.getState().undo()
    for (const id of ids) expect(await read(id)).toEqual({ modifiedAt: T0.getTime(), focus: true })
    later(3)
    await useUndoStore.getState().redo()
    for (const id of ids) expect(await read(id)).toEqual({ modifiedAt: T0.getTime(), focus: false })
  })

  it('Keep the open ones: only the done ones leave Focus, and nothing is stamped', async () => {
    const [open, doneTask] = await tasksAtT0([{ focus: true }, { focus: true, isCompleted: true }]) as [number, number]
    later(1)
    const done = clearFocus()
    await answer(true)
    await done
    expect(await read(open)).toEqual({ modifiedAt: T0.getTime(), focus: true })
    expect(await read(doneTask)).toEqual({ modifiedAt: T0.getTime(), focus: false })
  })

  it('a task touched after the clear keeps its newer stamp through the undo', async () => {
    const [id] = await tasksAtT0([{ focus: true }]) as [number]
    later(1)
    const done = clearFocus()
    await answer('discard')
    await done
    const edited = later(2)
    await useTodoStore.getState().update(id, { title: 'Renamed' })
    later(3)
    // The clear's undo (the rename's undo is newer: take it first, then redo it to keep the rename).
    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    expect((await read(id)).focus).toBe(true)
    expect((await read(id)).modifiedAt).toBe(T0.getTime())
    await useUndoStore.getState().redo()
    await useUndoStore.getState().redo()
    expect(await read(id)).toEqual({ modifiedAt: edited.getTime(), focus: false })
  })
})

describe('Today’s + is a priority flag: it stamps, as every flag does', () => {
  it('stamps the task; undo puts back the earlier stamp, redo the step’s', async () => {
    const [id] = await tasksAtT0([{}]) as [number]
    const wrote = later(1)
    await pickForToday({ id, title: 'Task 1' })
    expect(await read(id)).toEqual({ modifiedAt: wrote.getTime(), focus: true })
    later(2)
    await useUndoStore.getState().undo()
    expect(await read(id)).toEqual({ modifiedAt: T0.getTime(), focus: false })
    later(3)
    await useUndoStore.getState().redo()
    expect(await read(id)).toEqual({ modifiedAt: wrote.getTime(), focus: true })
  })
})
