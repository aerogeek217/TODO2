import { describe, it, expect, beforeEach } from 'vitest'
import { db, runV23Migration, buildListDefFromLegacyInset } from '../../data/database'

/**
 * v23 translates pre-v23 list insets (preset / attributeFilter / name) into
 * freshly-created unpinned ListDefinitions, rewriting each inset to reference
 * its new def by id. Tests seed the table with legacy-shaped rows (Dexie
 * tolerates unknown fields because they're not indexed) and drive
 * `runV23Migration` directly.
 */

describe('v23 migration', () => {
  let canvasId: number

  beforeEach(async () => {
    await db.delete()
    await db.open()
    canvasId = await db.canvases.add({ name: 'Main', sortOrder: 0, createdAt: new Date() } as never)
  })

  async function runMigration() {
    await db.transaction('rw', [db.listInsets, db.listDefinitions], async (tx) => {
      await runV23Migration(tx)
    })
  }

  // Helper: seed `ensureSeededListDefinitions` worth of rows so sortOrder is
  // non-trivial. Not strictly required for these tests.
  async function seedDashboardDefaults() {
    await db.listDefinitions.bulkAdd([
      { name: 'Today', sortOrder: 0, pinnedToDashboard: true, membership: { kind: 'today' }, sort: { kind: 'effective-date-asc' }, grouping: { kind: 'none' } },
      { name: 'Upcoming', sortOrder: 1, pinnedToDashboard: true, membership: { kind: 'upcoming' }, sort: { kind: 'effective-date-asc' }, grouping: { kind: 'relative-effective' } },
      { name: 'Deadlines', sortOrder: 2, pinnedToDashboard: true, membership: { kind: 'deadlines' }, sort: { kind: 'deadline-asc' }, grouping: { kind: 'relative-deadline' } },
      { name: 'Someday', sortOrder: 3, pinnedToDashboard: true, membership: { kind: 'someday' }, sort: { kind: 'sort-order' }, grouping: { kind: 'none' } },
    ] as never)
  }

  it('translates a due-this-week preset inset into a custom ListDefinition', async () => {
    await seedDashboardDefaults()
    const insetId = await db.listInsets.add({
      name: 'Due & Overdue', preset: 'due-this-week', canvasId,
      x: 0, y: 0, width: 280, height: 300, isCollapsed: false,
    } as never)

    await runMigration()

    const inset = (await db.listInsets.get(insetId)) as unknown as Record<string, unknown>
    expect(inset.listDefinitionId).toBeTypeOf('number')
    expect('preset' in inset).toBe(false)
    expect('attributeFilter' in inset).toBe(false)
    expect('name' in inset).toBe(false)

    const def = await db.listDefinitions.get(inset.listDefinitionId as number)
    expect(def).toBeDefined()
    expect(def!.pinnedToDashboard).toBe(false)
    expect(def!.membership.kind).toBe('custom')
  })

  it('translates person attributeFilter into a personIds custom predicate', async () => {
    const insetId = await db.listInsets.add({
      name: 'Alice Tasks',
      attributeFilter: { type: 'person', personId: 42, personName: 'Alice' },
      canvasId, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
    } as never)

    await runMigration()

    const inset = (await db.listInsets.get(insetId)) as unknown as Record<string, unknown>
    const def = await db.listDefinitions.get(inset.listDefinitionId as number)
    expect(def).toBeDefined()
    expect(def!.pinnedToDashboard).toBe(false)
    if (def!.membership.kind !== 'custom') throw new Error('expected custom')
    expect(def!.membership.predicate.personIds).toEqual([42])
  })

  it('uses the inset name as the ListDefinition name when provided', async () => {
    const insetId = await db.listInsets.add({
      name: 'My Custom Name',
      attributeFilter: { type: 'tag', tagId: 5, tagName: 'urgent' },
      canvasId, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
    } as never)

    await runMigration()
    const inset = (await db.listInsets.get(insetId)) as unknown as Record<string, unknown>
    const def = await db.listDefinitions.get(inset.listDefinitionId as number)
    expect(def!.name).toBe('My Custom Name')
  })

  it('falls back to a generated name when the inset has no name', async () => {
    const insetId = await db.listInsets.add({
      attributeFilter: { type: 'tag', tagId: 5, tagName: 'urgent' },
      canvasId, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
    } as never)

    await runMigration()
    const inset = (await db.listInsets.get(insetId)) as unknown as Record<string, unknown>
    const def = await db.listDefinitions.get(inset.listDefinitionId as number)
    expect(def!.name).toBe('Tasks tagged urgent')
  })

  it('drops inset rows with no recognizable legacy shape', async () => {
    await db.listInsets.add({
      name: 'Garbage', canvasId, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
    } as never)

    await runMigration()

    expect(await db.listInsets.toArray()).toHaveLength(0)
  })

  it('no-ops on rows already at v23 (has listDefinitionId, no legacy fields)', async () => {
    // Pre-seed a valid ListDefinition so the reference is real.
    const defId = await db.listDefinitions.add({
      name: 'Pre-migrated', sortOrder: 0, pinnedToDashboard: false,
      membership: { kind: 'someday' }, sort: { kind: 'sort-order' }, grouping: { kind: 'none' },
    } as never)
    const insetId = await db.listInsets.add({
      listDefinitionId: defId, canvasId, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
    } as never)

    const countBefore = await db.listDefinitions.count()
    await runMigration()
    const countAfter = await db.listDefinitions.count()

    expect(countAfter).toBe(countBefore)
    const inset = (await db.listInsets.get(insetId)) as unknown as Record<string, unknown>
    expect(inset.listDefinitionId).toBe(defId)
  })

  it('appends new ListDefinitions with sortOrders that do not collide with existing rows', async () => {
    await seedDashboardDefaults()  // sortOrders 0..3
    await db.listInsets.add({
      preset: 'due-this-week', canvasId,
      x: 0, y: 0, width: 280, height: 300, isCollapsed: false,
    } as never)

    await runMigration()

    const defs = await db.listDefinitions.toArray()
    expect(defs).toHaveLength(5)
    // New def should sit at sortOrder 4 (max + 1).
    const newDef = defs.find(d => d.membership.kind === 'custom')
    expect(newDef?.sortOrder).toBe(4)
  })

  describe('buildListDefFromLegacyInset', () => {
    it('builds a due-this-week custom predicate with dateRangeEnd=today+7d', () => {
      const now = new Date('2026-04-16T12:00:00Z')
      const def = buildListDefFromLegacyInset({ preset: 'due-this-week', name: 'Due & Overdue' }, now)
      expect(def).not.toBeNull()
      expect(def!.membership.kind).toBe('custom')
      if (def!.membership.kind !== 'custom') return
      const end = new Date(def!.membership.predicate.dateRangeEnd!)
      const expectedEnd = new Date(now)
      expectedEnd.setDate(expectedEnd.getDate() + 7)
      expect(end.getTime()).toBe(expectedEnd.getTime())
    })

    it('returns null for unrecognized shape', () => {
      expect(buildListDefFromLegacyInset({ foo: 'bar' })).toBeNull()
    })
  })
})
