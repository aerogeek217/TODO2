import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { isExpiredCompleted, resolveCompletedAt, retentionCutoff } from '../../utils/completed-at'
import { newTodoUid } from '../../utils/todo-uid'

/**
 * cr1 P4 — `completedAt` (set on completion, cleared on reopen; the purge
 * clock) and `uid` (minted on every insert).
 */

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], todosVersion: 0, loading: false })
  useUndoStore.getState().clear()
})

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

async function stored(id: number) {
  return (await db.todos.get(id))!
}

function inStore(id: number) {
  return useTodoStore.getState().todos.find((t) => t.id === id)!
}

describe('resolveCompletedAt / isExpiredCompleted (pure)', () => {
  const now = new Date('2026-10-10T12:00:00.000Z')
  const earlier = new Date('2026-09-01T12:00:00.000Z')

  it('sets on completion, keeps while completed, clears on reopen, honors an explicit value', () => {
    expect(resolveCompletedAt({ isCompleted: false }, { isCompleted: true }, now)).toBe(now)
    expect(resolveCompletedAt(undefined, { isCompleted: true }, now)).toBe(now)
    expect(resolveCompletedAt({ isCompleted: true, completedAt: earlier }, { isCompleted: true }, now)).toBe(earlier)
    expect(resolveCompletedAt({ isCompleted: true, completedAt: earlier }, { isCompleted: false }, now)).toBeUndefined()
    expect(resolveCompletedAt({ isCompleted: false }, { isCompleted: true, completedAt: earlier }, now)).toBe(earlier)
  })

  it('expires on completedAt, not modifiedAt; falls back to modifiedAt only when completedAt is missing', () => {
    const cutoff = retentionCutoff(30, now)
    const fresh = new Date('2026-10-09T00:00:00.000Z')
    expect(isExpiredCompleted({ isCompleted: true, completedAt: earlier, modifiedAt: fresh }, cutoff)).toBe(true)
    expect(isExpiredCompleted({ isCompleted: true, completedAt: fresh, modifiedAt: earlier }, cutoff)).toBe(false)
    expect(isExpiredCompleted({ isCompleted: false, completedAt: earlier, modifiedAt: earlier }, cutoff)).toBe(false)
    expect(isExpiredCompleted({ isCompleted: true, modifiedAt: earlier }, cutoff)).toBe(true)
  })
})

describe('completedAt on every completion path', () => {
  it('toggleComplete sets completedAt (store + DB) and reopening clears it', async () => {
    const id = await useTodoStore.getState().add('Task')
    expect((await stored(id)).completedAt).toBeUndefined()

    const before = Date.now()
    await useTodoStore.getState().toggleComplete(id)
    const row = await stored(id)
    expect(row.completedAt).toBeInstanceOf(Date)
    expect(row.completedAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(inStore(id).completedAt).toBeInstanceOf(Date)

    await useTodoStore.getState().toggleComplete(id)
    expect('completedAt' in (await stored(id))).toBe(false)
    expect(inStore(id).completedAt).toBeUndefined()
  })

  it('bulkSetCompleted sets / clears completedAt; re-completing a completed task keeps its time', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    const old = daysAgo(50)
    await todoRepository.complete(b, true, old)
    await useTodoStore.getState().loadAll()

    await useTodoStore.getState().bulkSetCompleted([a, b], true)
    expect((await stored(a)).completedAt).toBeInstanceOf(Date)
    expect((await stored(b)).completedAt).toEqual(old)
    expect(inStore(b).completedAt).toEqual(old)

    await useTodoStore.getState().bulkSetCompleted([a, b], false)
    for (const id of [a, b]) {
      expect('completedAt' in (await stored(id))).toBe(false)
      expect(inStore(id).completedAt).toBeUndefined()
    }
  })

  it('undoing a bulk reopen restores the original completion time', async () => {
    const id = await useTodoStore.getState().add('Done long ago')
    const old = daysAgo(90)
    await todoRepository.complete(id, true, old)
    await useTodoStore.getState().loadAll()
    useUndoStore.getState().clear()

    await useTodoStore.getState().bulkSetCompleted([id], false)
    expect((await stored(id)).completedAt).toBeUndefined()
    await useUndoStore.getState().undo()

    expect((await stored(id)).isCompleted).toBe(true)
    expect((await stored(id)).completedAt).toEqual(old)
    expect(inStore(id).completedAt).toEqual(old)
  })

  it('update() keeps completedAt in step when it flips isCompleted (TaskEditPopup-style writes)', async () => {
    const id = await useTodoStore.getState().add('Edit me')
    await useTodoStore.getState().update({ ...inStore(id), isCompleted: true })
    expect((await stored(id)).completedAt).toBeInstanceOf(Date)
    const at = (await stored(id)).completedAt

    // An unrelated edit of a completed task keeps the completion time.
    await useTodoStore.getState().update({ ...inStore(id), title: 'Renamed' })
    expect((await stored(id)).completedAt).toEqual(at)

    await useTodoStore.getState().update({ ...inStore(id), isCompleted: false })
    expect('completedAt' in (await stored(id))).toBe(false)
  })

  it('bulkUpdate with isCompleted keeps completedAt in step; other changes leave it alone', async () => {
    const id = await useTodoStore.getState().add('Bulk')
    await todoRepository.bulkUpdate([{ todoId: id, changes: { isCompleted: true } }])
    const at = (await stored(id)).completedAt
    expect(at).toBeInstanceOf(Date)
    await todoRepository.bulkUpdate([{ todoId: id, changes: { sortOrder: 99 } }])
    expect((await stored(id)).completedAt).toEqual(at)
    await todoRepository.bulkUpdate([{ todoId: id, changes: { isCompleted: false } }])
    expect('completedAt' in (await stored(id))).toBe(false)
  })

  it('completing a recurring task advances it instead and sets no completedAt', async () => {
    const id = await useTodoStore.getState().add('Weekly')
    const due = new Date('2026-10-12T00:00:00.000Z')
    await useTodoStore.getState().update({ ...inStore(id), dueDate: due, recurrenceRule: { type: 'weekly' } })
    await useTodoStore.getState().toggleComplete(id)
    const row = await stored(id)
    expect(row.isCompleted).toBe(false)
    expect(row.completedAt).toBeUndefined()
    expect(row.dueDate!.getTime()).toBeGreaterThan(due.getTime())
  })

  it('insert stamps completedAt on a row inserted already completed', async () => {
    const now = new Date()
    const id = await todoRepository.insert({ title: 'Imported done', isCompleted: true, createdAt: now, modifiedAt: now, sortOrder: 0 })
    expect((await stored(id)).completedAt).toBeInstanceOf(Date)
  })
})

describe('purgeExpiredCompleted keys on completedAt', () => {
  it('purges a task completed long ago even if modifiedAt is fresh (reorders / sort normalization)', async () => {
    const id = await useTodoStore.getState().add('Done in summer')
    await todoRepository.complete(id, true, daysAgo(60))
    // A reorder / normalization bumps modifiedAt — the old purge clock.
    await todoRepository.reorder(id, 5)
    await useTodoStore.getState().loadAll()
    expect(Date.now() - new Date(inStore(id).modifiedAt).getTime()).toBeLessThan(60_000)

    expect(await useTodoStore.getState().purgeExpiredCompleted(30)).toBe(1)
    expect(await db.todos.get(id)).toBeUndefined()
  })

  it('keeps a task completed recently even if modifiedAt is old', async () => {
    const id = await useTodoStore.getState().add('Done yesterday')
    await todoRepository.complete(id, true, daysAgo(1))
    await db.todos.update(id, { modifiedAt: daysAgo(400) })
    await useTodoStore.getState().loadAll()

    expect(await useTodoStore.getState().purgeExpiredCompleted(30)).toBe(0)
    expect(await db.todos.get(id)).toBeDefined()
  })
})

describe('uid on every insert path', () => {
  it('add / addAt / duplicate mint distinct uids; an explicit uid is kept', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().addAt('B', 1, 1, 5)
    const c = (await useTodoStore.getState().duplicate(a))!
    const uids = await Promise.all([a, b, c].map(async (id) => (await stored(id)).uid))
    for (const uid of uids) expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(new Set(uids).size).toBe(3)
    expect(inStore(a).uid).toBe(uids[0])

    const now = new Date()
    const kept = await todoRepository.insert({ uid: 'incoming-uid', title: 'Kept', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 })
    expect((await stored(kept)).uid).toBe('incoming-uid')
  })

  it('the uid index is unique', async () => {
    const now = new Date()
    await todoRepository.insert({ uid: 'dup', title: 'One', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 })
    await expect(
      todoRepository.insert({ uid: 'dup', title: 'Two', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 }),
    ).rejects.toThrow()
    expect(await db.todos.count()).toBe(1)
  })

  it('undo of a delete restores the same uid', async () => {
    const id = await useTodoStore.getState().add('Keep my uid')
    const uid = (await stored(id)).uid
    await useTodoStore.getState().remove(id)
    await useUndoStore.getState().undo()
    expect((await stored(id)).uid).toBe(uid)
  })

  it('newTodoUid falls back to getRandomValues without randomUUID', () => {
    const orig = globalThis.crypto.randomUUID
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
      const uid = newTodoUid()
      expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(newTodoUid()).not.toBe(uid)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: orig, configurable: true })
    }
  })
})
