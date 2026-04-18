import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  ensureSeededListDefinitions,
  parseHorizonSlots,
  persistHorizonSlots,
  runV24Migration,
} from '../../data/database'
import type { ListDefinition } from '../../models/list-definition'
import { HORIZON_KEYS } from '../../services/horizons'

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

  it('writes horizonSlots setting mapping all 5 horizons to the new def ids', async () => {
    await runMigration()

    const row = await db.settings.get('horizonSlots')
    expect(row).toBeDefined()
    const slots = parseHorizonSlots(row!.value)
    for (const key of HORIZON_KEYS) {
      expect(typeof slots[key]).toBe('number')
    }
    // Each slot's id must match a real row.
    const defIds = new Set((await db.listDefinitions.toArray()).map((d) => d.id!))
    for (const key of HORIZON_KEYS) {
      expect(defIds.has(slots[key]!)).toBe(true)
    }
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

  it('persists and reads back slot mapping', async () => {
    await persistHorizonSlots(db.settings, { thisweek: 10, nextweek: 11, someday: 12 })
    const row = await db.settings.get('horizonSlots')
    const parsed = parseHorizonSlots(row!.value)
    expect(parsed.thisweek).toBe(10)
    expect(parsed.nextweek).toBe(11)
    expect(parsed.someday).toBe(12)
    expect(parsed.thismonth).toBeUndefined()
  })

  it('returns empty object for null / invalid JSON', () => {
    expect(parseHorizonSlots(null)).toEqual({})
    expect(parseHorizonSlots('')).toEqual({})
    expect(parseHorizonSlots('{not json')).toEqual({})
  })

  it('silently drops invalid slot keys', () => {
    const parsed = parseHorizonSlots(JSON.stringify({ thisweek: 1, bogus: 99, nextweek: 'not a number' }))
    expect(parsed.thisweek).toBe(1)
    expect(parsed).not.toHaveProperty('bogus')
    expect(parsed).not.toHaveProperty('nextweek')
  })
})

describe('ensureSeededListDefinitions — post-v24 signature', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('returns HorizonKey → id mapping when seeding', async () => {
    const slots = await ensureSeededListDefinitions(db.listDefinitions)
    for (const key of HORIZON_KEYS) {
      expect(typeof slots[key]).toBe('number')
    }
  })

  it('returns empty object when table already has rows', async () => {
    await db.listDefinitions.add({
      name: 'Existing',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: { kind: 'custom', predicate: {
        showCompleted: false, showHiddenStatuses: false,
        personIds: null, personFilterMode: 'include-orgs',
        tagIds: null, orgIds: null, orgFilterMode: 'include-people',
        statusIds: null, searchText: '', dateField: 'date',
        dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
        hasScheduled: null, hasDeadline: null,
      } },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    } as ListDefinition)

    const slots = await ensureSeededListDefinitions(db.listDefinitions)
    expect(Object.keys(slots)).toHaveLength(0)
  })
})
