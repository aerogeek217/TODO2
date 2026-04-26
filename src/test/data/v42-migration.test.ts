import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import { runV42Migration } from '../../data/database'

/**
 * v42 introduces the `todoEvents` history log. The upgrade callback backfills
 * one `created` event per existing todo at `createdAt` and a `completed` event
 * for currently-completed rows at `modifiedAt` (the codebase has no
 * `completedAt` field; modifiedAt is a best-effort proxy — documented in
 * `runV42Migration` and the P3 handoff).
 *
 * These tests exercise the migration in isolation against a fresh Dexie at
 * "v41" (a minimal schema with only `todos`), then upgrade through a no-op
 * v2 that registers the new table + runs `runV42Migration`. The full
 * v17 → v45 chain is out of scope here — the single-version isolation is
 * sufficient for backfill semantics.
 */
describe('runV42Migration — backfill', () => {
  const DB_NAME = 'todo2-v42-isolated-test'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  function openV42(): Dexie {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ todos: '++id' })
    db.version(2)
      .stores({ todoEvents: '++id, todoId, type, timestamp' })
      .upgrade(async (tx) => {
        await runV42Migration(tx)
      })
    return db
  }

  async function seedV41(rows: Array<{ title: string; isCompleted: boolean; createdAt: Date; modifiedAt: Date; sortOrder: number }>): Promise<void> {
    const db = new Dexie(DB_NAME)
    db.version(1).stores({ todos: '++id' })
    await db.open()
    if (rows.length > 0) await db.table('todos').bulkAdd(rows)
    db.close()
  }

  it('emits one created event per existing todo at createdAt', async () => {
    const t1 = new Date('2026-04-01T08:00:00Z')
    const t2 = new Date('2026-04-15T08:00:00Z')
    await seedV41([
      { title: 'first', isCompleted: false, createdAt: t1, modifiedAt: t1, sortOrder: 0 },
      { title: 'second', isCompleted: false, createdAt: t2, modifiedAt: t2, sortOrder: 1 },
    ])

    const db = openV42()
    await db.open()
    const events = await db.table('todoEvents').toArray()
    const created = events.filter((e) => e.type === 'created')
    expect(created).toHaveLength(2)
    const stamps = created.map((e) => e.timestamp).sort()
    expect(stamps).toEqual([t1.toISOString(), t2.toISOString()])
    db.close()
  })

  it('emits a completed event at modifiedAt for currently-completed rows', async () => {
    const created = new Date('2026-04-01T08:00:00Z')
    const completed = new Date('2026-04-20T15:00:00Z')
    await seedV41([
      { title: 'open', isCompleted: false, createdAt: created, modifiedAt: created, sortOrder: 0 },
      { title: 'done', isCompleted: true, createdAt: created, modifiedAt: completed, sortOrder: 1 },
    ])

    const db = openV42()
    await db.open()
    const completedEvents = (await db.table('todoEvents').toArray()).filter((e) => e.type === 'completed')
    expect(completedEvents).toHaveLength(1)
    expect(completedEvents[0]!.timestamp).toBe(completed.toISOString())
    db.close()
  })

  it('emits both a created AND a completed event for completed rows', async () => {
    const created = new Date('2026-04-01T08:00:00Z')
    const completed = new Date('2026-04-10T08:00:00Z')
    await seedV41([
      { title: 'done', isCompleted: true, createdAt: created, modifiedAt: completed, sortOrder: 0 },
    ])

    const db = openV42()
    await db.open()
    const events = await db.table('todoEvents').toArray()
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.type === 'created')!.timestamp).toBe(created.toISOString())
    expect(events.find((e) => e.type === 'completed')!.timestamp).toBe(completed.toISOString())
    db.close()
  })

  it('produces no events when there are no todos', async () => {
    await seedV41([])
    const db = openV42()
    await db.open()
    expect(await db.table('todoEvents').count()).toBe(0)
    db.close()
  })

  it('all backfilled events have null fromValue/toValue (event type carries the meaning)', async () => {
    const created = new Date('2026-04-01T08:00:00Z')
    await seedV41([
      { title: 'a', isCompleted: false, createdAt: created, modifiedAt: created, sortOrder: 0 },
      { title: 'b', isCompleted: true, createdAt: created, modifiedAt: created, sortOrder: 1 },
    ])

    const db = openV42()
    await db.open()
    const events = await db.table('todoEvents').toArray()
    for (const e of events) {
      expect(e.fromValue).toBeNull()
      expect(e.toValue).toBeNull()
    }
    db.close()
  })
})
