// A task write stamps one `modifiedAt`: the store and the database hold the
// same value. Every `new Date()` here is a millisecond later than the last,
// so two separately minted timestamps can't happen to agree.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { makeRecurrenceRule } from '../../services/recurrence'
import { resetDb } from '../helpers'

const RealDate = Date

/** `Date` whose clock moves on by 1 ms at every read. */
function installSteppingClock() {
  let tick = RealDate.UTC(2026, 9, 16, 12)
  class SteppingDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(tick++)
      else super(...(args as [number]))
    }
    static now() { return tick++ }
    static [Symbol.hasInstance](value: unknown) { return value instanceof RealDate }
  }
  vi.stubGlobal('Date', SteppingDate)
}

beforeEach(async () => {
  await resetDb()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.getState().clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function addTask(title: string, extra: Record<string, unknown> = {}): Promise<number> {
  const now = new Date()
  return db.todos.add({ uid: `uid-${title}`, title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1, ...extra })
}

/** The task's `modifiedAt` in the store and in the database, as times. */
async function stamps(id: number): Promise<[number | undefined, number | undefined]> {
  const inStore = useTodoStore.getState().todos.find((t) => t.id === id)?.modifiedAt
  const inDb = (await db.todos.get(id))?.modifiedAt
  return [inStore && new RealDate(inStore).getTime(), inDb && new RealDate(inDb).getTime()]
}

async function expectSameStamp(...ids: number[]) {
  for (const id of ids) {
    const [store, stored] = await stamps(id)
    expect(store, `task ${id}`).toBeDefined()
    expect(store, `task ${id}`).toBe(stored)
  }
}

type Write = (ids: number[]) => Promise<unknown>

const writes: Array<[string, Write]> = [
  ['update', ([a]) => useTodoStore.getState().update(a!, { title: 'Edited' })],
  ['toggleComplete', ([a]) => useTodoStore.getState().toggleComplete(a!)],
  ['bulkSetCompleted', (ids) => useTodoStore.getState().bulkSetCompleted(ids, true)],
  ['bulkSetStatus', (ids) => useTodoStore.getState().bulkSetStatus(ids, 7)],
  ['bulkSetFocus', (ids) => useTodoStore.getState().bulkSetFocus(ids, true)],
  ['setMarkerFlags', (ids) => useTodoStore.getState().setMarkerFlags(ids.map((todoId) => ({ todoId, urgent: true })), 'Urgent')],
  ['markFollowedUp', (ids) => useTodoStore.getState().markFollowedUp(ids)],
]

describe('the store and the database hold the same modifiedAt', () => {
  for (const [name, write] of writes) {
    it(`${name}, then its undo and redo`, async () => {
      const a = await addTask('A')
      const b = await addTask('B')
      await useTodoStore.getState().loadAll()
      installSteppingClock()

      await write([a, b])
      await expectSameStamp(a, b)
      await useUndoStore.getState().undo()
      await expectSameStamp(a, b)
      await useUndoStore.getState().redo()
      await expectSameStamp(a, b)
    })
  }

  it('completing a repeating task (it moves to its next due date), then undo and redo', async () => {
    const due = new Date(2026, 9, 10)
    const a = await addTask('Weekly', { dueDate: due, recurrenceRule: makeRecurrenceRule('weekly', due) })
    const b = await addTask('Also weekly', { dueDate: due, recurrenceRule: makeRecurrenceRule('weekly', due) })
    await useTodoStore.getState().loadAll()
    installSteppingClock()

    await useTodoStore.getState().toggleComplete(a)
    await expectSameStamp(a)
    await useUndoStore.getState().undo()
    await expectSameStamp(a)
    await useUndoStore.getState().redo()
    await expectSameStamp(a)

    await useTodoStore.getState().bulkSetCompleted([a, b], true)
    await expectSameStamp(a, b)
    await useUndoStore.getState().undo()
    await expectSameStamp(a, b)
  })
})
