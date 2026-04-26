import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import {
  todoEventRepository,
  encodeScheduledValue,
  encodeDateValue,
} from '../../data/todo-event-repository'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('todoEventRepository — write/read round-trip', () => {
  it('add + byTodo + getAll round-trip', async () => {
    const id = await todoEventRepository.add({
      todoId: 1, type: 'created', fromValue: null, toValue: null,
      timestamp: new Date('2026-04-26T10:00:00Z').toISOString(),
    })
    expect(id).toBeGreaterThan(0)

    const byTodo = await todoEventRepository.byTodo(1)
    expect(byTodo).toHaveLength(1)
    expect(byTodo[0]!.type).toBe('created')

    const all = await todoEventRepository.getAll()
    expect(all).toHaveLength(1)
  })

  it('inRange filters by timestamp window and optional types', async () => {
    await todoEventRepository.bulkAdd([
      { todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: '2026-04-01T00:00:00.000Z' },
      { todoId: 1, type: 'scheduled', fromValue: null, toValue: '2026-04-05T00:00:00.000Z', timestamp: '2026-04-10T00:00:00.000Z' },
      { todoId: 2, type: 'completed', fromValue: null, toValue: null, timestamp: '2026-04-20T00:00:00.000Z' },
      { todoId: 2, type: 'reopened', fromValue: null, toValue: null, timestamp: '2026-05-01T00:00:00.000Z' },
    ])

    const inApril = await todoEventRepository.inRange(
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-05-01T00:00:00Z'),
    )
    expect(inApril.map((e) => e.type).sort()).toEqual(['completed', 'created', 'scheduled'])

    const onlyScheduled = await todoEventRepository.inRange(
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-05-01T00:00:00Z'),
      ['scheduled'],
    )
    expect(onlyScheduled).toHaveLength(1)
    expect(onlyScheduled[0]!.type).toBe('scheduled')
  })
})

describe('todoRepository — emit on insert / update / complete', () => {
  it('emits a single created event on insert', async () => {
    const ts = new Date('2026-04-25T12:00:00Z')
    const id = await todoRepository.insert(makeTodo({ title: 'a', createdAt: ts, modifiedAt: ts }))
    const events = await todoEventRepository.byTodo(id)
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe('created')
    expect(events[0]!.timestamp).toBe(ts.toISOString())
  })

  it('update emits one scheduled event when scheduledDate changes', async () => {
    const id = await todoRepository.insert(makeTodo())
    const todo = (await todoRepository.getById(id))!
    todo.scheduledDate = { kind: 'date', value: new Date('2026-05-01T00:00:00Z') }
    await todoRepository.update(todo)

    const events = await todoEventRepository.byTodo(id)
    const scheduled = events.filter((e) => e.type === 'scheduled')
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.fromValue).toBeNull()
    expect(scheduled[0]!.toValue).toBe('2026-05-01T00:00:00.000Z')
  })

  it('update is idempotent — re-saving the same row emits nothing', async () => {
    const id = await todoRepository.insert(makeTodo())
    const todo = (await todoRepository.getById(id))!
    todo.scheduledDate = { kind: 'date', value: new Date('2026-05-01T00:00:00Z') }
    await todoRepository.update(todo)
    const before = await todoEventRepository.byTodo(id)

    // Re-fetch + re-save without altering tracked fields.
    const todo2 = (await todoRepository.getById(id))!
    todo2.title = 'rename only'
    await todoRepository.update(todo2)

    const after = await todoEventRepository.byTodo(id)
    expect(after.length).toBe(before.length)
  })

  it('update emits a deadline event when dueDate changes', async () => {
    const id = await todoRepository.insert(makeTodo())
    const todo = (await todoRepository.getById(id))!
    todo.dueDate = new Date('2026-06-01T00:00:00Z')
    await todoRepository.update(todo)

    const deadline = (await todoEventRepository.byTodo(id)).filter((e) => e.type === 'deadline')
    expect(deadline).toHaveLength(1)
    expect(deadline[0]!.toValue).toBe('2026-06-01T00:00:00.000Z')
  })

  it('update emits a status event when statusId changes', async () => {
    const id = await todoRepository.insert(makeTodo())
    const todo = (await todoRepository.getById(id))!
    todo.statusId = 7
    await todoRepository.update(todo)

    const status = (await todoEventRepository.byTodo(id)).filter((e) => e.type === 'status')
    expect(status).toHaveLength(1)
    expect(status[0]!.fromValue).toBeNull()
    expect(status[0]!.toValue).toBe(7)
  })

  it('complete emits completed on false→true and reopened on true→false', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.complete(id, true)
    let events = await todoEventRepository.byTodo(id)
    expect(events.some((e) => e.type === 'completed')).toBe(true)

    await todoRepository.complete(id, false)
    events = await todoEventRepository.byTodo(id)
    expect(events.some((e) => e.type === 'reopened')).toBe(true)
  })

  it('complete is idempotent — re-completing emits no event', async () => {
    const id = await todoRepository.insert(makeTodo({ isCompleted: true }))
    const before = await todoEventRepository.byTodo(id)
    await todoRepository.complete(id, true)
    const after = await todoEventRepository.byTodo(id)
    expect(after.length).toBe(before.length)
  })

  it('bulkUpdate emits one event per changed field per row', async () => {
    const id1 = await todoRepository.insert(makeTodo({ title: 'a' }))
    const id2 = await todoRepository.insert(makeTodo({ title: 'b' }))

    await todoRepository.bulkUpdate([
      { todoId: id1, changes: { statusId: 2 } },
      { todoId: id2, changes: { isCompleted: true } },
    ])

    const ev1 = await todoEventRepository.byTodo(id1)
    expect(ev1.some((e) => e.type === 'status' && e.toValue === 2)).toBe(true)
    const ev2 = await todoEventRepository.byTodo(id2)
    expect(ev2.some((e) => e.type === 'completed')).toBe(true)
  })
})

describe('todoRepository — cascade delete', () => {
  it('delete wipes every event for the todo', async () => {
    const id = await todoRepository.insert(makeTodo())
    const todo = (await todoRepository.getById(id))!
    todo.scheduledDate = { kind: 'date', value: new Date('2026-05-01T00:00:00Z') }
    await todoRepository.update(todo)
    expect((await todoEventRepository.byTodo(id)).length).toBeGreaterThan(0)

    await todoRepository.delete(id)

    expect(await todoEventRepository.byTodo(id)).toHaveLength(0)
    // The events table itself only loses rows for this todo.
    expect(await db.todoEvents.count()).toBe(0)
  })

  it('bulkDelete cascades for every removed todo', async () => {
    const id1 = await todoRepository.insert(makeTodo({ title: 'a' }))
    const id2 = await todoRepository.insert(makeTodo({ title: 'b' }))
    const id3 = await todoRepository.insert(makeTodo({ title: 'c' }))

    await todoRepository.bulkDelete([id1, id2])

    expect(await todoEventRepository.byTodo(id1)).toHaveLength(0)
    expect(await todoEventRepository.byTodo(id2)).toHaveLength(0)
    // Survivor keeps its created event.
    expect(await todoEventRepository.byTodo(id3)).toHaveLength(1)
  })
})

describe('encode helpers', () => {
  it('encodeScheduledValue handles null / fixed-date / fuzzy', () => {
    expect(encodeScheduledValue(undefined)).toBeNull()
    expect(encodeScheduledValue(null)).toBeNull()
    expect(encodeScheduledValue({ kind: 'date', value: new Date('2026-04-26T00:00:00Z') }))
      .toBe('2026-04-26T00:00:00.000Z')
    expect(encodeScheduledValue({ kind: 'fuzzy', token: 'this-week' })).toBe('fuzzy:this-week')
  })

  it('encodeDateValue handles null and Date', () => {
    expect(encodeDateValue(undefined)).toBeNull()
    expect(encodeDateValue(new Date('2026-06-01T00:00:00Z'))).toBe('2026-06-01T00:00:00.000Z')
  })
})

// `runV42Migration` backfill is covered in `v42-migration.test.ts`.
