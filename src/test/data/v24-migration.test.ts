import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  ensureSeededListDefinitions,
  persistHorizonSlots,
  runV24Migration,
} from '../../data/database'
import { parseHorizonSlots } from '../../utils/horizon-slots'
import type { ListDefinition } from '../../models/list-definition'

describe('v24 migration', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  async function runMigration() {
    await db.transaction('rw', [db.listDefinitions, db.settings], async (tx) => {
      await runV24Migration(tx)
    })
  }

  it('clears pre-v24 listDefinitions and reseeds 5 horizon defs', async () => {
    // Simulate a pre-v24 DB with legacy-kind seed rows.
    await db.listDefinitions.bulkAdd([
      { name: 'Today', sortOrder: 0, pinnedToDashboard: true, membership: { kind: 'today' }, sort: { kind: 'effective-date-asc' }, grouping: { kind: 'none' } },
      { name: 'Upcoming', sortOrder: 1, pinnedToDashboard: true, membership: { kind: 'upcoming' }, sort: { kind: 'effective-date-asc' }, grouping: { kind: 'relative-effective' } },
    ] as unknown as ListDefinition[])

    await runMigration()

    const defs = await db.listDefinitions.orderBy('sortOrder').toArray()
    expect(defs).toHaveLength(5)
    expect(defs.map((d) => d.name)).toEqual(['This week', 'Next week', 'Rest of month', 'Later', 'Someday'])
    for (const d of defs) {
      expect(d.pinnedToDashboard).toBe(true)
      expect(d.membership.kind).toBe('custom')
    }
  })

  it('writes horizonSlots setting as a 5-element array of seed ids', async () => {
    await runMigration()

    const row = await db.settings.get('horizonSlots')
    expect(row).toBeDefined()
    const slots = parseHorizonSlots(row!.value)
    expect(slots).toHaveLength(5)
    // Each slot id matches a real row.
    const defIds = new Set((await db.listDefinitions.toArray()).map((d) => d.id!))
    for (const id of slots) {
      expect(defIds.has(id)).toBe(true)
    }
    // Order matches the seed order (This week / Next week / Rest of month / Later / Someday).
    const orderedDefs = await db.listDefinitions.orderBy('sortOrder').toArray()
    expect(slots).toEqual(orderedDefs.map((d) => d.id))
  })

  it('each seeded horizon has a custom predicate', async () => {
    await runMigration()
    const defs = await db.listDefinitions.toArray()
    const byName = new Map(defs.map((d) => [d.name, d]))

    const thisWeek = byName.get('This week')!
    expect(thisWeek.membership.kind).toBe('custom')
    if (thisWeek.membership.kind !== 'custom') throw new Error('unreachable')
    expect(thisWeek.membership.predicate.dateRangeStart?.kind).toBe('relative')
    expect(thisWeek.membership.predicate.dateRangeEnd?.kind).toBe('relative')

    const someday = byName.get('Someday')!
    if (someday.membership.kind !== 'custom') throw new Error('unreachable')
    expect(someday.membership.predicate.hasScheduled).toBe(false)
    expect(someday.membership.predicate.hasDeadline).toBe(false)
  })

  it('is deterministic: running twice leaves the table with 5 defs (but different ids)', async () => {
    await runMigration()
    const firstIds = (await db.listDefinitions.toArray()).map((d) => d.id!).sort()
    await runMigration()
    const secondIds = (await db.listDefinitions.toArray()).map((d) => d.id!).sort()
    expect(firstIds).toHaveLength(5)
    expect(secondIds).toHaveLength(5)
    // After the second run, old ids are gone and new ones replace them.
    expect(firstIds).not.toEqual(secondIds)
  })
})

describe('persistHorizonSlots + parseHorizonSlots', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('persists and reads back slot ids in array order', async () => {
    await persistHorizonSlots(db.settings, [10, 11, 12])
    const row = await db.settings.get('horizonSlots')
    const parsed = parseHorizonSlots(row!.value)
    expect(parsed).toEqual([10, 11, 12])
  })

  it('returns empty array for null / invalid JSON', () => {
    expect(parseHorizonSlots(null)).toEqual([])
    expect(parseHorizonSlots('')).toEqual([])
    expect(parseHorizonSlots('{not json')).toEqual([])
  })

  it('flattens legacy map-shape via the documented iteration order', () => {
    // Legacy: Partial<Record<HorizonKey, number>>.
    const parsed = parseHorizonSlots(JSON.stringify({
      thisweek: 1,
      nextweek: 2,
      thismonth: 3,
      later: 4,
      someday: 5,
    }))
    expect(parsed).toEqual([1, 2, 3, 4, 5])
  })

  it('flattens partial legacy map preserving iteration order', () => {
    const parsed = parseHorizonSlots(JSON.stringify({ thisweek: 1, someday: 5 }))
    expect(parsed).toEqual([1, 5])
  })

  it('silently drops invalid entries from legacy map', () => {
    const parsed = parseHorizonSlots(JSON.stringify({ thisweek: 1, bogus: 99, nextweek: 'not a number' }))
    expect(parsed).toEqual([1])
  })

  it('drops non-finite numbers from array shape', () => {
    const parsed = parseHorizonSlots(JSON.stringify([1, 'two', NaN, 3]))
    expect(parsed).toEqual([1, 3])
  })
})

describe('ensureSeededListDefinitions — post-P6 signature', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('returns ordered ids matching seed order when seeding', async () => {
    const slots = await ensureSeededListDefinitions(db.listDefinitions)
    expect(slots).toHaveLength(5)
    const orderedDefs = await db.listDefinitions.orderBy('sortOrder').toArray()
    expect(slots).toEqual(orderedDefs.map((d) => d.id))
  })

  it('returns empty array when table already has rows', async () => {
    await db.listDefinitions.add({
      name: 'Existing',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: { kind: 'custom', predicate: {
        showCompleted: false, showHiddenStatuses: false,
        personIds: null, personFilterMode: 'include-orgs',
        orgIds: null, orgFilterMode: 'include-people',
        statusIds: null, searchText: '', dateField: 'date',
        dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
        hasScheduled: null, hasDeadline: null,
      } },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    } as ListDefinition)

    const slots = await ensureSeededListDefinitions(db.listDefinitions)
    expect(slots).toHaveLength(0)
  })
})
