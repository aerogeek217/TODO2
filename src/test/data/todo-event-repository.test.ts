import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import {
  todoEventRepository,
  encodeDateValue,
} from '../../data/todo-event-repository'
import { makeTodo } from '../helpers'

/** The events recorded for a task. */
const eventsOf = (todoId: number) => db.todoEvents.where('todoId').equals(todoId).toArray()

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('todoRepository — emit on insert / update / complete', () => {
  it('emits a single created event on insert', async () => {
    const ts = new Date('2026-04-25T12:00:00Z')
    const id = await todoRepository.insert(makeTodo({ title: 'a', createdAt: ts, modifiedAt: ts }))
    const events = await eventsOf(id)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('created')
    expect(events[0]!.timestamp).toBe(ts.toISOString())
  })

  it('a follow-up change emits no event (only due date / status / completion are tracked)', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.update(id, { nextFollowupAt: new Date('2026-05-01T00:00:00Z') })

    const events = await eventsOf(id)
    expect(events.map((e) => e.type)).toEqual(['created'])
  })

  it('update is idempotent — re-writing tracked fields with their values emits nothing', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.update(id, { dueDate: new Date('2026-05-01T00:00:00Z') })
    const before = await eventsOf(id)

    // The same due date again, plus an untracked field.
    await todoRepository.update(id, { dueDate: new Date('2026-05-01T00:00:00Z'), title: 'rename only' })

    const after = await eventsOf(id)
    expect(after.length).toBe(before.length)
  })

  it('update emits a deadline event when dueDate changes', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.update(id, { dueDate: new Date('2026-06-01T00:00:00Z') })

    const deadline = (await eventsOf(id)).filter((e) => e.type === 'deadline')
    expect(deadline).toHaveLength(1)
    expect(deadline[0]!.toValue).toBe('2026-06-01T00:00:00.000Z')
  })

  it('update emits a status event when statusId changes', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.update(id, { statusId: 7 })

    const status = (await eventsOf(id)).filter((e) => e.type === 'status')
    expect(status).toHaveLength(1)
    expect(status[0]!.fromValue).toBeNull()
    expect(status[0]!.toValue).toBe(7)
  })

  it('complete emits completed on false→true and reopened on true→false', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.complete(id, true)
    let events = await eventsOf(id)
    expect(events.some((e) => e.type === 'completed')).toBe(true)

    await todoRepository.complete(id, false)
    events = await eventsOf(id)
    expect(events.some((e) => e.type === 'reopened')).toBe(true)
  })

  it('complete is idempotent — re-completing emits no event', async () => {
    const id = await todoRepository.insert(makeTodo({ isCompleted: true }))
    const before = await eventsOf(id)
    await todoRepository.complete(id, true)
    const after = await eventsOf(id)
    expect(after.length).toBe(before.length)
  })

  it('bulkUpdate emits one event per changed field per row', async () => {
    const id1 = await todoRepository.insert(makeTodo({ title: 'a' }))
    const id2 = await todoRepository.insert(makeTodo({ title: 'b' }))

    await todoRepository.bulkUpdate([
      { todoId: id1, changes: { statusId: 2 } },
      { todoId: id2, changes: { isCompleted: true } },
    ])

    const ev1 = await eventsOf(id1)
    expect(ev1.some((e) => e.type === 'status' && e.toValue === 2)).toBe(true)
    const ev2 = await eventsOf(id2)
    expect(ev2.some((e) => e.type === 'completed')).toBe(true)
  })
})

describe('todoRepository — cascade delete', () => {
  it('delete wipes every event for the todo', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.update(id, { dueDate: new Date('2026-05-01T00:00:00Z') })
    expect((await eventsOf(id)).length).toBeGreaterThan(1)

    await todoRepository.delete(id)

    expect(await eventsOf(id)).toHaveLength(0)
    // The events table itself only loses rows for this todo.
    expect(await db.todoEvents.count()).toBe(0)
  })

  it('bulkDelete cascades for every removed todo', async () => {
    const id1 = await todoRepository.insert(makeTodo({ title: 'a' }))
    const id2 = await todoRepository.insert(makeTodo({ title: 'b' }))
    const id3 = await todoRepository.insert(makeTodo({ title: 'c' }))

    await todoRepository.bulkDelete([id1, id2])

    expect(await eventsOf(id1)).toHaveLength(0)
    expect(await eventsOf(id2)).toHaveLength(0)
    // Survivor keeps its created event.
    expect(await eventsOf(id3)).toHaveLength(1)
  })
})

describe('encode helpers', () => {
  it('encodeDateValue handles null and Date', () => {
    expect(encodeDateValue(undefined)).toBeNull()
    expect(encodeDateValue(new Date('2026-06-01T00:00:00Z'))).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('todoEventRepository — since / onChange', () => {
  it('since returns events at or after `from`, optionally of some types only', async () => {
    await db.todoEvents.bulkAdd([
      { todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: '2026-04-01T00:00:00.000Z' },
      { todoId: 1, type: 'status', fromValue: null, toValue: 2, timestamp: '2026-04-10T00:00:00.000Z' },
      { todoId: 2, type: 'completed', fromValue: null, toValue: null, timestamp: '2026-04-10T00:00:00.000Z' },
      { todoId: 2, type: 'reopened', fromValue: null, toValue: null, timestamp: '2026-05-01T00:00:00.000Z' },
    ])
    const all = await todoEventRepository.since(new Date('2026-04-10T00:00:00Z'))
    expect(all.map((e) => e.type).sort()).toEqual(['completed', 'reopened', 'status'])
    const some = await todoEventRepository.since(new Date('2026-04-10T00:00:00Z'), ['completed', 'reopened'])
    expect(some.map((e) => e.type).sort()).toEqual(['completed', 'reopened'])
  })

  it('onChange fires on event writes (insert, complete, delete) until unsubscribed', async () => {
    let calls = 0
    const off = todoEventRepository.onChange(() => { calls++ })
    try {
      const id = await todoRepository.insert(makeTodo({ id: undefined }))
      expect(calls).toBe(1)
      await todoRepository.complete(id, true)
      expect(calls).toBe(2)
      await todoRepository.delete(id)
      expect(calls).toBe(4)
    } finally {
      off()
    }
    await todoRepository.insert(makeTodo({ id: undefined }))
    expect(calls).toBe(4)
  })
})
