import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { statusUpdateRepository } from '../../data/status-update-repository'
import { newestStatusUpdate, useStatusUpdateStore } from '../../stores/status-update-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { addDays, startOfToday } from '../../utils/date'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'

const today = () => startOfToday()
const daysAgo = (n: number) => addDays(startOfToday(), -n)

/** The texts the store holds for `todoId`, newest first. */
const texts = (todoId: number) => (useStatusUpdateStore.getState().byTodo.get(todoId) ?? []).map((r) => r.text)
/** The texts stored for `todoId`, oldest first by id. */
const storedTexts = async (todoId: number) => (await db.statusUpdates.where('todoId').equals(todoId).sortBy('id')).map((r) => r.text)

beforeEach(async () => {
  await resetDb()
  resetStores()
  useUndoStore.getState().clear()
})

async function task(title = 'Q4 budget'): Promise<number> {
  return useTodoStore.getState().add(title)
}

describe('status-update-store: add', () => {
  it('stores one trimmed line on the day given, newest first in the store, as one undo step', async () => {
    const id = await task()
    useUndoStore.getState().clear()
    await useStatusUpdateStore.getState().add(id, { date: new Date(daysAgo(3).getTime() + 5 * 3_600_000), text: '  Asked\nfor   numbers ' })
    const added = await useStatusUpdateStore.getState().add(id, { date: daysAgo(1), text: 'Numbers in' })

    expect(added).toMatchObject({ todoId: id, text: 'Numbers in', date: daysAgo(1) })
    expect(added).not.toHaveProperty('followedUp')
    expect(await storedTexts(id)).toEqual(['Asked for numbers', 'Numbers in'])
    expect((await db.statusUpdates.toArray())[0]?.date).toEqual(daysAgo(3))
    expect(texts(id)).toEqual(['Numbers in', 'Asked for numbers'])
    expect(newestStatusUpdate(id)?.text).toBe('Numbers in')
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Add status update', 'Add status update'])
  })

  it('a date after today is stored as today; followedUp is stored only when true', async () => {
    const id = await task()
    const later = await useStatusUpdateStore.getState().add(id, { date: addDays(today(), 4), text: 'Ahead', followedUp: true })
    const plain = await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Plain', followedUp: false })
    expect(later?.date).toEqual(today())
    expect((await db.statusUpdates.get(later!.id))?.followedUp).toBe(true)
    expect(await db.statusUpdates.get(plain!.id)).not.toHaveProperty('followedUp')
  })

  it('refuses a blank text: nothing written, no undo step', async () => {
    const id = await task()
    useUndoStore.getState().clear()
    expect(await useStatusUpdateStore.getState().add(id, { date: today(), text: ' \n ' })).toBeUndefined()
    expect(await db.statusUpdates.count()).toBe(0)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('undo removes the entry, redo brings it back with its id', async () => {
    const id = await task()
    const added = await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Pinged' })
    await useUndoStore.getState().undo()
    expect(await db.statusUpdates.count()).toBe(0)
    expect(texts(id)).toEqual([])
    await useUndoStore.getState().redo()
    expect((await db.statusUpdates.toArray()).map((r) => r.id)).toEqual([added!.id])
    expect(texts(id)).toEqual(['Pinged'])
  })

  it('a failed write is reported, writes nothing and resolves undefined', async () => {
    const id = await task()
    const spy = vi.spyOn(statusUpdateRepository, 'addMany').mockRejectedValueOnce(new Error('disk full'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    useUndoStore.getState().clear()
    expect(await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Pinged' })).toBeUndefined()
    expect(useUndoStore.getState().snackbar?.description).toBe("Couldn't add the status update.")
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(texts(id)).toEqual([])
    spy.mockRestore()
    err.mockRestore()
  })

  it('writes nothing for a task deleted meanwhile, and a redo after the task is gone brings nothing back', async () => {
    const id = await task()
    await db.todos.delete(id)
    expect(await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Late' })).toBeUndefined()
    expect(await db.statusUpdates.count()).toBe(0)

    const other = await task('Other')
    await useStatusUpdateStore.getState().add(other, { date: today(), text: 'On other' })
    await useUndoStore.getState().undo()
    await db.todos.delete(other)
    await useUndoStore.getState().redo()
    expect(await db.statusUpdates.count()).toBe(0)
  })
})

describe('status-update-store: addToMany', () => {
  it('adds the same entry to every task as one undo step', async () => {
    const a = await task('A')
    const b = await task('B')
    useUndoStore.getState().clear()
    const added = await useStatusUpdateStore.getState().addToMany([a, b, a], { date: today(), text: 'Chased', followedUp: true }, 'Followed up · 2 tasks')
    expect(added.map((r) => r.todoId)).toEqual([a, b])
    expect(added.every((r) => r.followedUp === true)).toBe(true)
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Followed up · 2 tasks'])

    await useUndoStore.getState().undo()
    expect(await db.statusUpdates.count()).toBe(0)
    expect(texts(a)).toEqual([])
    await useUndoStore.getState().redo()
    expect(await db.statusUpdates.count()).toBe(2)
    expect([texts(a), texts(b)]).toEqual([['Chased'], ['Chased']])
  })
})

describe('status-update-store: addRows', () => {
  it('stores each text as add does and drops a row left with none', async () => {
    const id = await task()
    const now = new Date()
    const added = await useStatusUpdateStore.getState().addRows([
      { todoId: id, date: daysAgo(1), text: '', createdAt: now },
      { todoId: id, date: daysAgo(1), text: ' Asked \n again ', createdAt: now },
      { todoId: id, date: daysAgo(1), text: 'r'.repeat(600), createdAt: now },
    ])
    expect(added.map((r) => r.text)).toEqual(['Asked again', 'r'.repeat(500)])
    expect(await storedTexts(id)).toEqual(['Asked again', 'r'.repeat(500)])
  })
})

describe('status-update-store: update', () => {
  it('changes the day and the text, re-sorts, and undo / redo swap them', async () => {
    const id = await task()
    const first = await useStatusUpdateStore.getState().add(id, { date: daysAgo(5), text: 'First' })
    await useStatusUpdateStore.getState().add(id, { date: daysAgo(2), text: 'Second' })
    useUndoStore.getState().clear()

    expect(await useStatusUpdateStore.getState().update(first!.id, { date: addDays(today(), 3), text: ' First, edited ' })).toBe(true)
    expect(await db.statusUpdates.get(first!.id)).toMatchObject({ date: today(), text: 'First, edited' })
    expect(texts(id)).toEqual(['First, edited', 'Second'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Edit status update'])

    await useUndoStore.getState().undo()
    expect(await db.statusUpdates.get(first!.id)).toMatchObject({ date: daysAgo(5), text: 'First' })
    expect(texts(id)).toEqual(['Second', 'First'])
    await useUndoStore.getState().redo()
    expect(texts(id)).toEqual(['First, edited', 'Second'])
  })

  it('writes nothing for no change or a blank text', async () => {
    const id = await task()
    const entry = await useStatusUpdateStore.getState().add(id, { date: daysAgo(1), text: 'Same' })
    useUndoStore.getState().clear()
    expect(await useStatusUpdateStore.getState().update(entry!.id, { date: daysAgo(1), text: 'Same ' })).toBe(false)
    expect(await useStatusUpdateStore.getState().update(entry!.id, { text: '   ' })).toBe(false)
    expect(await useStatusUpdateStore.getState().update(9999, { text: 'Gone' })).toBe(false)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect((await db.statusUpdates.get(entry!.id))?.text).toBe('Same')
  })
})

describe('status-update-store: remove', () => {
  it('removes with the undo snackbar; undo puts it back with its id, redo removes it again', async () => {
    const id = await task()
    const entry = await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Oops' })
    expect(await useStatusUpdateStore.getState().remove(entry!.id)).toBe(true)
    expect(await db.statusUpdates.count()).toBe(0)
    expect(useUndoStore.getState().snackbar?.description).toBe('Status update removed')

    await useUndoStore.getState().undo()
    expect((await db.statusUpdates.toArray()).map((r) => r.id)).toEqual([entry!.id])
    expect(texts(id)).toEqual(['Oops'])
    await useUndoStore.getState().redo()
    expect(await db.statusUpdates.count()).toBe(0)
    expect(texts(id)).toEqual([])
  })
})

describe('status-update-store: order and load', () => {
  it('orders by day, then by when written, then by id — newest first', async () => {
    const id = await task()
    await db.statusUpdates.bulkAdd([
      { todoId: id, date: daysAgo(1), text: 'b: yesterday, early', createdAt: new Date(2026, 0, 1, 9) },
      { todoId: id, date: daysAgo(3), text: 'd: older day', createdAt: new Date(2026, 0, 2) },
      { todoId: id, date: daysAgo(1), text: 'a: yesterday, late', createdAt: new Date(2026, 0, 1, 17) },
      { todoId: id, date: daysAgo(1), text: 'c: yesterday, early, lower id', createdAt: new Date(2026, 0, 1, 9) },
    ])
    await useStatusUpdateStore.getState().load()
    expect(useStatusUpdateStore.getState().loaded).toBe(true)
    expect(texts(id)).toEqual(['a: yesterday, late', 'c: yesterday, early, lower id', 'b: yesterday, early', 'd: older day'])
  })

  it('forgetTodos drops tasks’ entries from memory only', async () => {
    const a = await task('A')
    const b = await task('B')
    await useStatusUpdateStore.getState().add(a, { date: today(), text: 'on A' })
    await useStatusUpdateStore.getState().add(b, { date: today(), text: 'on B' })
    useStatusUpdateStore.getState().forgetTodos([a])
    expect(texts(a)).toEqual([])
    expect(texts(b)).toEqual(['on B'])
    expect(await db.statusUpdates.count()).toBe(2)
  })
})

describe('task deletes keep the entries for undo', () => {
  async function withEntries(title: string): Promise<number> {
    const id = await task(title)
    await useStatusUpdateStore.getState().add(id, { date: daysAgo(2), text: `${title} 1` })
    await useStatusUpdateStore.getState().add(id, { date: daysAgo(1), text: `${title} 2` })
    return id
  }

  it('remove: the entries go with the task; undo brings them back, redo takes them again', async () => {
    const id = await withEntries('A')
    await useTodoStore.getState().remove(id)
    expect(await db.statusUpdates.count()).toBe(0)
    expect(texts(id)).toEqual([])

    await useUndoStore.getState().undo()
    expect(await storedTexts(id)).toEqual(['A 1', 'A 2'])
    expect(texts(id)).toEqual(['A 2', 'A 1'])
    await useUndoStore.getState().redo()
    expect(await db.statusUpdates.count()).toBe(0)
    expect(texts(id)).toEqual([])
  })

  it('bulkRemove: undo brings every task’s entries back', async () => {
    const a = await withEntries('A')
    const b = await withEntries('B')
    await useTodoStore.getState().bulkRemove([a, b])
    expect(await db.statusUpdates.count()).toBe(0)
    await useUndoStore.getState().undo()
    expect([texts(a), texts(b)]).toEqual([['A 2', 'A 1'], ['B 2', 'B 1']])
    expect(await db.statusUpdates.count()).toBe(4)
  })

  it('undo of a create takes the entries added since, redo brings them back', async () => {
    const id = await task('Fresh')
    await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Started' })
    // The add's own step first, then the create's.
    await useUndoStore.getState().undo()
    await useStatusUpdateStore.getState().addRows([{ todoId: id, date: today(), text: 'Kept without a step', createdAt: new Date() }])
    await useUndoStore.getState().undo()
    expect(await db.todos.get(id)).toBeUndefined()
    expect(await db.statusUpdates.count()).toBe(0)
    expect(texts(id)).toEqual([])
    await useUndoStore.getState().redo()
    expect(texts(id)).toEqual(['Kept without a step'])
    expect(await storedTexts(id)).toEqual(['Kept without a step'])
  })

  it('purgeCompleted cascades the entries', async () => {
    const id = await withEntries('Done')
    await useTodoStore.getState().toggleComplete(id)
    const outcome = await useTodoStore.getState().purgeCompleted([id])
    expect(outcome).toMatchObject({ status: 'done', deleted: 1 })
    expect(await db.statusUpdates.count()).toBe(0)
    expect(texts(id)).toEqual([])
  })
})

describe('duplicate copies the entries', () => {
  it('same days and texts, in the same order, written now; undo of the duplicate takes them, redo brings them back', async () => {
    const id = await task('Source')
    const before = new Date()
    await db.statusUpdates.bulkAdd([
      { todoId: id, date: daysAgo(4), text: 'Oldest', createdAt: new Date(2026, 0, 1, 9) },
      { todoId: id, date: daysAgo(1), text: 'Same day, earlier', createdAt: new Date(2026, 0, 2, 9) },
      { todoId: id, date: daysAgo(1), text: 'Same day, later', createdAt: new Date(2026, 0, 2, 17), followedUp: true },
    ])
    await useStatusUpdateStore.getState().load()

    const copy = await useTodoStore.getState().duplicate(id)
    expect(copy).toBeDefined()
    expect(texts(copy!)).toEqual(['Same day, later', 'Same day, earlier', 'Oldest'])
    const rows = await db.statusUpdates.where('todoId').equals(copy!).toArray()
    expect(rows.map((r) => r.date.getTime()).sort()).toEqual([daysAgo(4), daysAgo(1), daysAgo(1)].map((d) => d.getTime()).sort())
    expect(rows.every((r) => r.createdAt.getTime() >= before.getTime())).toBe(true)
    expect(texts(id)).toHaveLength(3)

    await useUndoStore.getState().undo()
    expect(await db.statusUpdates.where('todoId').equals(copy!).count()).toBe(0)
    await useUndoStore.getState().redo()
    expect(texts(copy!)).toEqual(['Same day, later', 'Same day, earlier', 'Oldest'])
  })
})

describe('an entry write is activity on its task', () => {
  const longAgo = daysAgo(40)

  /** A task last modified 40 days ago (stale), in the database and the store. */
  async function staleTask(title = 'Old task'): Promise<number> {
    const id = await task(title)
    await db.todos.update(id, { modifiedAt: longAgo })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: longAgo } : t)) })
    return id
  }

  async function modifiedAt(id: number): Promise<{ stored: Date | undefined; shown: Date | undefined }> {
    return {
      stored: (await db.todos.get(id))?.modifiedAt,
      shown: useTodoStore.getState().todos.find((t) => t.id === id)?.modifiedAt,
    }
  }

  /** Resets the task to 40 days ago and checks `write` stamps it now, stored and shown alike. */
  async function expectStamped(id: number, write: () => Promise<unknown>): Promise<void> {
    await db.todos.update(id, { modifiedAt: longAgo })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: longAgo } : t)) })
    const before = Date.now()
    await write()
    const { stored, shown } = await modifiedAt(id)
    expect(stored?.getTime()).toBeGreaterThanOrEqual(before)
    expect(shown).toEqual(stored)
  }

  it('add, addToMany, update and remove stamp the task’s Modified date, stored and in the store', async () => {
    const id = await staleTask()
    const other = await staleTask('Other')
    let entryId = 0
    await expectStamped(id, async () => { entryId = (await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Pinged' }))!.id })
    await expectStamped(other, () => useStatusUpdateStore.getState().addToMany([other], { date: today(), text: 'Both' }, 'Add'))
    await expectStamped(id, () => useStatusUpdateStore.getState().update(entryId, { text: 'Pinged twice' }))
    await expectStamped(id, () => useStatusUpdateStore.getState().remove(entryId))
  })

  it('undo and redo of an entry write stamp it too', async () => {
    const id = await staleTask()
    await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Pinged' })
    await expectStamped(id, () => useUndoStore.getState().undo())
    await expectStamped(id, () => useUndoStore.getState().redo())
  })

  it('a write that changes nothing stamps nothing', async () => {
    const id = await staleTask()
    const added = await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Pinged' })
    await db.todos.update(id, { modifiedAt: longAgo })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: longAgo } : t)) })
    await useStatusUpdateStore.getState().update(added!.id, { text: 'Pinged' })
    await useStatusUpdateStore.getState().add(id, { date: today(), text: '   ' })
    expect(await modifiedAt(id)).toEqual({ stored: longAgo, shown: longAgo })
  })

  it('a task delete’s undo puts the task back with its own Modified date, not stamped by its entries', async () => {
    const id = await staleTask()
    await useStatusUpdateStore.getState().add(id, { date: today(), text: 'Pinged' })
    await db.todos.update(id, { modifiedAt: longAgo })
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: longAgo } : t)) })
    await useTodoStore.getState().remove(id)
    await useUndoStore.getState().undo()
    expect(await storedTexts(id)).toEqual(['Pinged'])
    expect(await modifiedAt(id)).toEqual({ stored: longAgo, shown: longAgo })
  })
})
