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

// ── v50 (cr1 P3): Date fields revived ────────────────────────────────────

describe('v49 fixture → v50: Date fields arrive as Dates', () => {
  function expectDate(value: unknown, label: string, iso?: string) {
    expect(value instanceof Date, `${label} is a Date`).toBe(true)
    expect(Number.isNaN((value as Date).getTime()), `${label} is a valid Date`).toBe(false)
    if (iso) expect((value as Date).toISOString(), label).toBe(iso)
  }

  it('todos: createdAt / modifiedAt / dueDate / scheduledDate value + setAt', async () => {
    await importFixture()
    const todos = await db.todos.orderBy('id').toArray()
    for (const t of todos) {
      expectDate(t.createdAt, `todo ${t.id} createdAt`)
      expectDate(t.modifiedAt, `todo ${t.id} modifiedAt`)
      if (t.dueDate !== undefined) expectDate(t.dueDate, `todo ${t.id} dueDate`)
      if (t.scheduledDate?.kind === 'date') expectDate(t.scheduledDate.value, `todo ${t.id} scheduledDate.value`)
      if (t.scheduledDate?.kind === 'fuzzy') expectDate(t.scheduledDate.setAt, `todo ${t.id} scheduledDate.setAt`)
    }
    const report = todos.find((t) => t.title === 'Send quarterly report')!
    expectDate(report.dueDate, 'report dueDate', '2026-10-16T00:00:00.000Z')
    expectDate(report.createdAt, 'report createdAt', '2026-09-02T10:00:00.000Z')
    expect(report.scheduledDate).toEqual({ kind: 'date', value: new Date('2026-10-12T00:00:00.000Z') })
    const dentist = todos.find((t) => t.title === 'Book dentist')!
    expect(dentist.scheduledDate).toEqual({ kind: 'fuzzy', token: 'next-week', setAt: new Date('2026-09-10T09:30:00.000Z') })
  })

  it('canvases, projects, notes, taskboards carry Dates; todoEvents.timestamp stays a string', async () => {
    await importFixture()
    for (const c of await db.canvases.toArray()) expectDate(c.createdAt, `canvas ${c.id} createdAt`)
    for (const p of await db.projects.toArray()) expectDate(p.createdAt, `project ${p.id} createdAt`)
    for (const n of await db.notes.toArray()) {
      expectDate(n.createdAt, `note ${n.id} createdAt`)
      expectDate(n.modifiedAt, `note ${n.id} modifiedAt`, '2026-09-15T08:00:00.000Z')
    }
    for (const b of await db.taskboards.toArray()) {
      expectDate(b.createdAt, `taskboard ${b.id} createdAt`)
      expectDate(b.updatedAt, `taskboard ${b.id} updatedAt`)
    }
    for (const e of await db.todoEvents.toArray()) expect(typeof e.timestamp).toBe('string')
  })
})

// ── v51 (cr1 P4): uid + completedAt ──────────────────────────────────────

describe('v49 fixture → v51: every todo has a unique uid; completedAt backfilled', () => {
  it('assigns a unique uid to every todo, the same on every import', async () => {
    await importFixture()
    const todos = await db.todos.orderBy('id').toArray()
    const uids = todos.map((t) => t.uid)
    for (const uid of uids) expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(new Set(uids).size).toBe(todos.length)

    // Deterministic backfill: a second import of the same file yields the same uids.
    await resetDb()
    await importFixture()
    expect((await db.todos.orderBy('id').toArray()).map((t) => t.uid)).toEqual(uids)
  })

  it('backfills completedAt from the completed event; open tasks (incl. reopened) have none', async () => {
    await importFixture()
    const todos = await db.todos.orderBy('id').toArray()
    const passport = todos.find((t) => t.title === 'Renew passport')!
    expect(passport.completedAt).toEqual(new Date('2026-09-12T09:30:00.000Z'))
    // "Call Ann…" was completed then reopened: no completedAt.
    for (const t of todos.filter((x) => !x.isCompleted)) {
      expect('completedAt' in t, `todo ${t.id} has no completedAt`).toBe(false)
    }
  })
})
