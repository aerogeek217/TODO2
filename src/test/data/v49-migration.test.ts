import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'

/**
 * v49 stamps `setAt: Date` onto every fuzzy `scheduledDate`. The upgrader
 * walks `todos` rows whose `scheduledDate.kind === 'fuzzy'` and `setAt` is
 * unset:
 *
 *   1. Read all `todoEvents` of `type === 'scheduled'`. Build a map of
 *      `todoId → max(timestamp)` — the most recent scheduled event for that
 *      todo is exactly when the user picked the current fuzzy token.
 *   2. If a fuzzy row has a matching scheduled event, `setAt = new Date(ts)`.
 *   3. Otherwise (pre-v42 task untouched since v42 shipped), `setAt = todo.createdAt`.
 *
 * This test seeds a v48-shaped DB with mixed fuzzy/precise rows, opens at
 * v49, and asserts the backfill picks the right anchor for each row.
 */
describe('v49 schema bump (fuzzy ScheduledValue.setAt backfill)', () => {
  const DB_NAME = 'todo2-v49-test'
  const V48_TODOS_SCHEMA = '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId'
  const V48_TODO_EVENTS_SCHEMA = '++id, todoId, type, timestamp'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  /** Open a Dexie at v48-shape, run the seed, close. */
  async function seedV48(seed: (db: Dexie) => Promise<void>): Promise<void> {
    const dbV48 = new Dexie(DB_NAME)
    dbV48.version(48).stores({
      todos: V48_TODOS_SCHEMA,
      todoEvents: V48_TODO_EVENTS_SCHEMA,
    })
    await dbV48.open()
    await seed(dbV48)
    dbV48.close()
  }

  /** Open the same DB at v49 with the real upgrade body and return it. */
  async function openV49(): Promise<Dexie> {
    const dbV49 = new Dexie(DB_NAME)
    dbV49.version(48).stores({
      todos: V48_TODOS_SCHEMA,
      todoEvents: V48_TODO_EVENTS_SCHEMA,
    })
    dbV49.version(49).stores({}).upgrade(async (tx) => {
      const scheduledEvents = await tx.table('todoEvents')
        .where('type').equals('scheduled')
        .toArray()
      const lastScheduledByTodo = new Map<number, string>()
      for (const ev of scheduledEvents) {
        const prev = lastScheduledByTodo.get(ev.todoId)
        if (prev === undefined || ev.timestamp > prev) {
          lastScheduledByTodo.set(ev.todoId, ev.timestamp)
        }
      }
      await tx.table('todos').toCollection().modify((todo) => {
        const sd = todo.scheduledDate
        if (!sd || sd.kind !== 'fuzzy') return
        if (sd.setAt) return
        const eventTs = lastScheduledByTodo.get(todo.id)
        const setAt = eventTs ? new Date(eventTs) : todo.createdAt
        todo.scheduledDate = { ...sd, setAt }
      })
    })
    await dbV49.open()
    return dbV49
  }

  it('backfills setAt from the most recent scheduled todoEvent', async () => {
    const createdAt = new Date(2026, 0, 5)
    const oldPick = '2026-03-01T10:00:00.000Z'
    const recentPick = '2026-04-15T14:30:00.000Z'

    await seedV48(async (db) => {
      const id = await db.table('todos').add({
        title: 'staff sync',
        isCompleted: false,
        sortOrder: 0,
        createdAt,
        modifiedAt: new Date(2026, 4, 1),
        scheduledDate: { kind: 'fuzzy', token: 'this-week' },
      }) as number
      await db.table('todoEvents').bulkAdd([
        { todoId: id, type: 'created', fromValue: null, toValue: null, timestamp: createdAt.toISOString() },
        { todoId: id, type: 'scheduled', fromValue: null, toValue: 'fuzzy:this-week', timestamp: oldPick },
        { todoId: id, type: 'scheduled', fromValue: 'fuzzy:this-week', toValue: 'fuzzy:this-week', timestamp: recentPick },
      ])
    })

    const dbV49 = await openV49()
    try {
      const rows = await dbV49.table('todos').toArray()
      expect(rows).toHaveLength(1)
      const sd = rows[0].scheduledDate
      expect(sd.kind).toBe('fuzzy')
      expect(sd.token).toBe('this-week')
      expect(sd.setAt).toBeInstanceOf(Date)
      expect(sd.setAt.toISOString()).toBe(recentPick)
    } finally {
      dbV49.close()
    }
  })

  it('falls back to createdAt when no scheduled event exists', async () => {
    const createdAt = new Date(2026, 0, 5, 9, 0, 0)

    await seedV48(async (db) => {
      const id = await db.table('todos').add({
        title: 'pre-v42 fuzzy todo',
        isCompleted: false,
        sortOrder: 0,
        createdAt,
        modifiedAt: new Date(2026, 4, 1),
        scheduledDate: { kind: 'fuzzy', token: 'next-week' },
      }) as number
      // Only the synthetic 'created' event exists — no 'scheduled' history.
      await db.table('todoEvents').add({
        todoId: id, type: 'created', fromValue: null, toValue: null, timestamp: createdAt.toISOString(),
      })
    })

    const dbV49 = await openV49()
    try {
      const rows = await dbV49.table('todos').toArray()
      expect(rows[0].scheduledDate.setAt).toBeInstanceOf(Date)
      expect(rows[0].scheduledDate.setAt.getTime()).toBe(createdAt.getTime())
    } finally {
      dbV49.close()
    }
  })

  it('falls back to createdAt when the only scheduled events belong to other todos', async () => {
    const aCreated = new Date(2026, 1, 1)
    const bCreated = new Date(2026, 1, 10)

    await seedV48(async (db) => {
      const idA = await db.table('todos').add({
        title: 'A — has a scheduled event',
        isCompleted: false, sortOrder: 0,
        createdAt: aCreated, modifiedAt: aCreated,
        scheduledDate: { kind: 'fuzzy', token: 'this-week' },
      }) as number
      await db.table('todos').add({
        title: 'B — no scheduled event',
        isCompleted: false, sortOrder: 1,
        createdAt: bCreated, modifiedAt: bCreated,
        scheduledDate: { kind: 'fuzzy', token: 'this-month' },
      })
      await db.table('todoEvents').add({
        todoId: idA, type: 'scheduled', fromValue: null, toValue: 'fuzzy:this-week',
        timestamp: '2026-02-05T12:00:00.000Z',
      })
    })

    const dbV49 = await openV49()
    try {
      const rows = await dbV49.table('todos').orderBy('sortOrder').toArray()
      expect(rows[0].scheduledDate.setAt.toISOString()).toBe('2026-02-05T12:00:00.000Z')
      // B has no event — must fall back to createdAt, not be cross-attributed to A's timestamp.
      expect(rows[1].scheduledDate.setAt.getTime()).toBe(bCreated.getTime())
    } finally {
      dbV49.close()
    }
  })

  it('leaves precise (kind=date) scheduled values untouched', async () => {
    const value = new Date(2026, 4, 20)

    await seedV48(async (db) => {
      await db.table('todos').add({
        title: 'precise',
        isCompleted: false, sortOrder: 0,
        createdAt: new Date(2026, 0, 1), modifiedAt: new Date(2026, 0, 1),
        scheduledDate: { kind: 'date', value },
      })
    })

    const dbV49 = await openV49()
    try {
      const rows = await dbV49.table('todos').toArray()
      expect(rows[0].scheduledDate.kind).toBe('date')
      expect(rows[0].scheduledDate.value.getTime()).toBe(value.getTime())
      expect('setAt' in rows[0].scheduledDate).toBe(false)
    } finally {
      dbV49.close()
    }
  })

  it('is idempotent — re-opening an already-v49 row preserves setAt', async () => {
    const explicitSetAt = new Date(2026, 2, 15)

    await seedV48(async (db) => {
      await db.table('todos').add({
        title: 'already stamped',
        isCompleted: false, sortOrder: 0,
        createdAt: new Date(2026, 0, 1), modifiedAt: new Date(2026, 0, 1),
        scheduledDate: { kind: 'fuzzy', token: 'this-week', setAt: explicitSetAt },
      })
    })

    const dbV49 = await openV49()
    try {
      const rows = await dbV49.table('todos').toArray()
      expect(rows[0].scheduledDate.setAt.getTime()).toBe(explicitSetAt.getTime())
    } finally {
      dbV49.close()
    }
  })

  it('skips todos without a scheduledDate', async () => {
    await seedV48(async (db) => {
      await db.table('todos').add({
        title: 'no schedule',
        isCompleted: false, sortOrder: 0,
        createdAt: new Date(2026, 0, 1), modifiedAt: new Date(2026, 0, 1),
      })
    })

    const dbV49 = await openV49()
    try {
      const rows = await dbV49.table('todos').toArray()
      expect(rows[0].scheduledDate).toBeUndefined()
    } finally {
      dbV49.close()
    }
  })
})
