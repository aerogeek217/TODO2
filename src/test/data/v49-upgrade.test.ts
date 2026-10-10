import { describe, it, expect, beforeEach } from 'vitest'
import fixture from '../fixtures/v49-export.json'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { resetDb } from '../helpers'

/**
 * Frozen v49 export (`src/test/fixtures/v49-export.json`) — generated once
 * from the v49 build (seed via `todoRepository` + direct table adds →
 * `buildExportData`) and never regenerated. Every table is populated and every
 * optional field appears at least once.
 *
 * This is the permanent proof that a v49 backup / sync file still imports
 * into the current build. **Every later schema phase extends this test** with
 * assertions for its transform (never edit the fixture to make it pass).
 */

type FixtureTable = keyof typeof fixture

async function importFixture(): Promise<void> {
  // Deep copy so a mutating bug in the pipeline can't leak between tests.
  const raw: unknown = JSON.parse(JSON.stringify(fixture))
  const prepared = prepareImport(raw)
  if (!prepared.ok) throw new Error(`v49 fixture failed to import: ${prepared.error}`)
  expect(prepared.legacy).toBeNull()
  expect(prepared.sourceVersion).toBe(49)
  expect(prepared.upgraded).toBe(CURRENT_DB_VERSION > 49)
  expect(prepared.warnings).toEqual([])
  await restoreFromImportData(prepared.data)
}

beforeEach(async () => {
  await resetDb()
})

describe('v49 fixture → prepareImport → restore', () => {
  it('fixture is a v49 export with every data table populated', () => {
    expect(fixture.__schemaVersion).toBe(49)
    for (const table of ALL_DATA_TABLES) {
      const rows = fixture[table.name as FixtureTable]
      expect(Array.isArray(rows), `fixture has table ${table.name}`).toBe(true)
      expect((rows as unknown[]).length, `fixture.${table.name} is populated`).toBeGreaterThan(0)
    }
  })

  it('restores every table with the fixture row counts', async () => {
    await importFixture()
    for (const table of ALL_DATA_TABLES) {
      const expected = (fixture[table.name as FixtureTable] as unknown[]).length
      expect(await table.count(), `${table.name} count`).toBe(expected)
    }
  })

  it('preserves todo key fields (ids, schedules, recurrence, assignments)', async () => {
    await importFixture()
    const todos = await db.todos.orderBy('id').toArray()
    expect(todos.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6])

    const report = todos.find((t) => t.title === 'Send quarterly report')!
    expect(report.notes).toBe('Include **charts**')
    expect(report.progress).toBe('draft done')
    expect(report.scheduledDate?.kind).toBe('date')
    expect(report.recurrenceRule).toEqual({ type: 'weekly' })
    expect(report.projectId).toBe(1)
    expect(report.canvasId).toBe(1)
    expect(report.statusId).toBe(2)
    expect(new Date(report.dueDate!).toISOString()).toBe('2026-10-16T00:00:00.000Z')

    const dentist = todos.find((t) => t.title === 'Book dentist')!
    expect(dentist.scheduledDate).toMatchObject({ kind: 'fuzzy', token: 'next-week' })
    expect(dentist.recurrenceRule).toEqual({ type: 'monthly', originalDayOfMonth: 31 })

    expect(todos.find((t) => t.title === 'Renew passport')!.isCompleted).toBe(true)

    expect(await db.todoPeople.where('todoId').equals(1).count()).toBe(1)
    expect(await db.todoOrgs.where('todoId').equals(3).count()).toBe(1)
    expect(await db.todoTags.where('todoId').equals(5).count()).toBe(1)
  })

  it('preserves entities: people, orgs + membership, tags, statuses incl. hidden-by-default', async () => {
    await importFixture()
    expect((await db.people.toArray()).map((p) => p.name)).toEqual(['Ann Lee', 'Bob Stone', 'Cat Ng'])
    const acme = (await db.orgs.toArray()).find((o) => o.name === 'Acme')!
    expect(acme).toMatchObject({ initials: 'AC', color: '#e05050' })
    expect(await db.personOrgs.count()).toBe(2)
    expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['urgent', 'Q4'])

    const statuses = await db.statuses.orderBy('sortOrder').toArray()
    expect(statuses.map((s) => s.name)).toEqual(['Assigned', 'Follow-up', 'Waiting'])
    expect(statuses[0]).toMatchObject({ icon: 'person', hideByDefault: true })
  })

  it('preserves taskboard entries, list definitions with runtime filters, and list insets', async () => {
    await importFixture()
    const [board] = await db.taskboards.toArray()
    expect(board!.entries).toEqual([{ todoId: 6, sortOrder: 0 }, { todoId: 1, sortOrder: 1 }])

    const defs = await db.listDefinitions.orderBy('sortOrder').toArray()
    expect(defs.map((d) => d.name)).toEqual(['This week', 'Someday', 'By person', 'Acme next 30 days'])
    expect(defs[2]).toMatchObject({
      favorited: true, pinnedToDashboard: false, maxTasks: 25, limitMode: 'scroll',
      runtimeFilter: { field: 'person', label: 'Who' }, sort: 'deadline', grouping: 'people',
    })
    expect(defs[3]!.membership.predicate.dateRangeEnd).toEqual({ kind: 'offset', days: 30 })
    expect(defs[3]!.membership.predicate.dateRangeStart).toEqual({ kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' })

    const insets = await db.listInsets.toArray()
    expect(insets.find((i) => i.listDefinitionId === 3)?.runtimeFilterValue).toEqual([1, 2])
  })

  it('preserves floating widgets of every kind, notes, and todoEvents of every type', async () => {
    await importFixture()
    const cal = (await db.floatingCalendars.toArray()).find((c) => c.orientation === 'horizontal')
    expect(cal?.weekOffset).toBe(-1)
    expect((await db.floatingTaskboards.toArray())[0]?.collapsed).toBe(true)
    expect((await db.floatingStatus.toArray())[0]?.collapsed).toBe(true)
    expect(await db.floatingNotes.count()).toBe(1)
    expect(await db.floatingHorizons.count()).toBe(1)
    expect(await db.floatingScoreboard.count()).toBe(1)
    expect(await db.floatingSnoozeGraveyard.count()).toBe(1)
    expect((await db.notes.toArray())[0]?.content).toContain('# Inbox')

    const types = new Set((await db.todoEvents.toArray()).map((e) => e.type))
    expect([...types].sort()).toEqual(['completed', 'created', 'deadline', 'reopened', 'scheduled', 'status'])
  })

  it('preserves every settings row, including rails JSON and theme colors', async () => {
    await importFixture()
    const settings = new Map((await db.settings.toArray()).map((s) => [s.key, s.value]))
    expect(settings.size).toBe(fixture.settings.length)
    expect(settings.get('weekStartsOn')).toBe('1')
    expect(settings.get('color.dark.accent')).toBe('#4f8cff')
    expect(settings.get('color.light.accent')).toBe('#1a5fd0')
    const rails = JSON.parse(settings.get('canvasRails')!)
    expect(rails.left.slots[0].tabs[0]).toMatchObject({ type: 'lens', listDefinitionId: 3 })
    expect(rails.collapsed).toEqual({ right: true })
  })
})
