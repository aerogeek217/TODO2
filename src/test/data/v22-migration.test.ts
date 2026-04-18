import { describe, it, expect, beforeEach } from 'vitest'
import { db, runV22Migration, ensureSeededListDefinitions } from '../../data/database'
import type { ListDefinition } from '../../models/list-definition'

/**
 * Tests the v21→v22 upgrade:
 *   - backfills `pinnedToDashboard = true` on every existing row
 *   - strips the retired `seededKey` field
 *   - `ensureSeededListDefinitions` no-ops when table is non-empty
 */

describe('v22 migration', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  async function runMigration() {
    await db.transaction('rw', [db.listDefinitions], async (tx) => {
      await runV22Migration(tx)
    })
  }

  it('backfills pinnedToDashboard=true on v21-shaped rows', async () => {
    // Insert a row as if seeded by v21 (no pinnedToDashboard, has seededKey)
    await db.listDefinitions.add({
      name: 'Today',
      sortOrder: 0,
      membership: { kind: 'today' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'none' },
      // v21-only fields (not typed in v22):
      seededKey: 'today',
    } as unknown as ListDefinition)

    await runMigration()
    const rows = await db.listDefinitions.toArray() as unknown as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0].pinnedToDashboard).toBe(true)
    expect('seededKey' in rows[0]).toBe(false)
  })

  it('keeps existing pinnedToDashboard=false untouched', async () => {
    await db.listDefinitions.add({
      name: 'Hidden',
      sortOrder: 0,
      pinnedToDashboard: false,
      membership: { kind: 'someday' },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    } as ListDefinition)

    await runMigration()
    const rows = await db.listDefinitions.toArray()
    expect(rows[0].pinnedToDashboard).toBe(false)
  })

  it('is a no-op on an empty table', async () => {
    await runMigration()
    expect(await db.listDefinitions.count()).toBe(0)
  })

  it('ensureSeededListDefinitions seeds 4 rows on empty table', async () => {
    await ensureSeededListDefinitions(db.listDefinitions)
    const rows = await db.listDefinitions.orderBy('sortOrder').toArray()
    expect(rows).toHaveLength(4)
    expect(rows.map(r => r.name)).toEqual(['Today', 'Upcoming', 'Deadlines', 'Someday'])
    for (const r of rows) expect(r.pinnedToDashboard).toBe(true)
  })

  it('ensureSeededListDefinitions is a no-op when table is non-empty (v22 "insert iff empty")', async () => {
    await db.listDefinitions.add({
      name: 'My Only List',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: { kind: 'today' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'none' },
    } as ListDefinition)

    await ensureSeededListDefinitions(db.listDefinitions)
    const rows = await db.listDefinitions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('My Only List')
  })
})
