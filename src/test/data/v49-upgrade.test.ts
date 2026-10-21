import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import fixture from '../fixtures/v49-export.json'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { upgradeDataSet, type DataSet } from '../../data/schema-upgrades'
import { restoreFromImportData } from '../../data/restore'
import { resetDb } from '../helpers'
import { emptyPredicate } from '../../models/filter-predicate'
import { isEisenhowerOwner, listedLists } from '../../models/list-definition'

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

/** Tables a later schema version created — the frozen v49 fixture can't have them. */
const TABLES_ADDED_AFTER_V49: ReadonlySet<string> = new Set(['layouts', 'listOrders'])

/** Id of the "Focus" list v59 creates: after the fixture's four lists. */
const FOCUS_LIST_ID = 5

/** Ids of the tags v60 creates from the fixture's projects (after its two tags). */
const PROJECT_WORK_TAG_ID = 3
const PROJECT_HOME_TAG_ID = 4

/**
 * The fixture's tables run through the registry from v49 to `version` (no
 * database). Checks what an intermediate version did to data a later
 * version drops (e.g. the canvas tables v60 removes).
 */
function fixtureAt(version: number): DataSet {
  const raw = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>
  const tables: DataSet = {}
  for (const [key, value] of Object.entries(raw)) if (Array.isArray(value)) tables[key] = value as DataSet[string]
  return upgradeDataSet(tables, 49, version)
}

/** The rails setting of the fixture upgraded to `version`, parsed. */
function railsAt(version: number) {
  const row = fixtureAt(version).settings!.find((s) => s.key === 'canvasRails')!
  return JSON.parse(row.value as string)
}

/** Id of the Eisenhower's list v67 creates (the fixture's Eisenhower showed all tasks): after the Focus list. */
const EISENHOWER_LIST_ID = 6

/** The stored lists that came from the fixture (v59 adds the Focus list, v67 the Eisenhower's). */
async function fixtureListDefinitions() {
  return (await db.listDefinitions.orderBy('sortOrder').toArray()).filter((d) => d.id !== FOCUS_LIST_ID && d.id !== EISENHOWER_LIST_ID)
}

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
      if (TABLES_ADDED_AFTER_V49.has(table.name)) continue
      const rows = fixture[table.name as FixtureTable]
      expect(Array.isArray(rows), `fixture has table ${table.name}`).toBe(true)
      expect((rows as unknown[]).length, `fixture.${table.name} is populated`).toBeGreaterThan(0)
    }
  })

  it('restores every table with the fixture row counts', async () => {
    await importFixture()
    for (const table of ALL_DATA_TABLES) {
      let expected = TABLES_ADDED_AFTER_V49.has(table.name) ? 0 : (fixture[table.name as FixtureTable] as unknown[]).length
      // v52 deletes the two horizons settings rows, v53 the seeded follow-up status pointer;
      // v56 adds `activeLayoutId`; v60 removes the five canvas / project settings; v64 `maxTags`;
      // v67 adds `eisenhowerSource`.
      if (table.name === 'settings') expected -= 3 - 1 + 5 + 1 - 1
      // v56 seeds the Default layout; v68 adds "Lists from upgrade" for the lists it doesn't show.
      if (table.name === 'layouts') expected = 2
      // v55 turns the two orgs into people and their two assignments into person assignments.
      if (table.name === 'people' || table.name === 'todoPeople') expected += 2
      // v59 adds the Focus list and ranks its two tasks; v67 adds the Eisenhower's list.
      if (table.name === 'listDefinitions') expected += 2
      if (table.name === 'listOrders') expected = 2
      // v60 turns the two projects into tags and tags their five tasks.
      if (table.name === 'tags') expected += 2
      if (table.name === 'todoTags') expected += 5
      expect(await table.count(), `${table.name} count`).toBe(expected)
    }
  })

  it('preserves todo key fields (ids, dates, recurrence, assignments)', async () => {
    await importFixture()
    const todos = await db.todos.orderBy('id').toArray()
    expect(todos.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6])

    const report = todos.find((t) => t.title === 'Send quarterly report')!
    expect(report.notes).toBe('Include **charts**')
    expect(report.progress).toBe('draft done')
    expect(report.recurrenceRule).toEqual({ type: 'weekly' })
    // v60: the project is a tag now; project / canvas fields are gone.
    expect('projectId' in report).toBe(false)
    expect('canvasId' in report).toBe(false)
    expect(report.statusId).toBe(2)
    expect(new Date(report.dueDate!).toISOString()).toBe('2026-10-16T00:00:00.000Z')

    const dentist = todos.find((t) => t.title === 'Book dentist')!
    expect(dentist.recurrenceRule).toEqual({ type: 'monthly', originalDayOfMonth: 31 })

    expect(todos.find((t) => t.title === 'Renew passport')!.isCompleted).toBe(true)

    expect(await db.todoPeople.where('todoId').equals(1).count()).toBe(1)
    expect(await db.todoPeople.where('todoId').equals(3).count()).toBe(2)
    expect(await db.todoTags.where('todoId').equals(5).count()).toBe(1)
    // Its own tag (Q4) plus its project's tag.
    expect((await db.todoTags.where('todoId').equals(1).toArray()).map((r) => r.tagId).sort()).toEqual([2, PROJECT_WORK_TAG_ID])
  })

  it('preserves entities: people (orgs now among them), tags, statuses', async () => {
    await importFixture()
    expect((await db.people.orderBy('id').toArray()).map((p) => p.name))
      .toEqual(['Ann Lee', 'Bob Stone', 'Cat Ng', 'Org: Acme', 'Org: Globex'])
    expect((await db.tags.toArray()).map((t) => t.name)).toEqual(['urgent', 'Q4', 'Project: Work', 'Project: Home'])

    const statuses = await db.statuses.orderBy('sortOrder').toArray()
    expect(statuses.map((s) => s.name)).toEqual(['Assigned', 'Follow-up', 'Waiting'])
    expect(statuses[0]).toMatchObject({ icon: 'person', color: '#8a8a8a' })
  })

  it('preserves list definitions with runtime filters (and, up to v59, list insets)', async () => {
    await importFixture()
    const defs = await fixtureListDefinitions()
    expect(defs.map((d) => d.name)).toEqual(['This week', 'Someday', 'By person', 'Acme next 30 days'])
    // v57 drops the favorites flag.
    expect(defs.every((d) => !('favorited' in d))).toBe(true)
    expect(defs[2]).toMatchObject({
      runtimeFilter: { field: 'person', label: 'Who' }, sort: 'deadline', grouping: 'people',
    })
    expect(defs[3]!.membership.predicate.dates.deadline).toEqual({
      match: 'range', start: { kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' }, end: { kind: 'offset', days: 30 },
    })

    const insets = fixtureAt(59).listInsets!
    expect(insets.find((i) => i.listDefinitionId === 3)?.runtimeFilterValue).toEqual([1, 2])
  })

  it('preserves floating widgets (up to v59), notes, and todoEvents of every type', async () => {
    const at59 = fixtureAt(59)
    const cal = at59.floatingCalendars!.find((c) => c.orientation === 'horizontal')
    expect(cal?.weekOffset).toBe(-1)
    expect(at59.floatingStatus![0]?.collapsed).toBe(true)
    expect(at59.floatingNotes).toHaveLength(1)
    await importFixture()
    expect((await db.notes.toArray())[0]?.content).toContain('# Inbox')

    const types = new Set((await db.todoEvents.toArray()).map((e) => e.type))
    expect([...types].sort()).toEqual(['completed', 'created', 'deadline', 'reopened', 'scheduled', 'status'])
  })

  it('preserves every surviving settings row, including theme colors (and rails JSON up to v59)', async () => {
    await importFixture()
    const settings = new Map((await db.settings.toArray()).map((s) => [s.key, s.value]))
    expect(settings.size).toBe(fixture.settings.length - 3 + 1 - 5 - 1 + 1)
    expect(settings.get('weekStartsOn')).toBe('1')
    expect(settings.get('color.dark.accent')).toBe('#4f8cff')
    expect(settings.get('color.light.accent')).toBe('#1a5fd0')
    const rails = railsAt(59)
    expect(rails.left.slots[0].tabs[0]).toMatchObject({ type: 'lens', listDefinitionId: 3 })
    expect(rails.collapsed).toEqual({ right: true })
  })
})

// ── v50: Date fields revived ─────────────────────────────────────────────

describe('v49 fixture → v50: Date fields arrive as Dates', () => {
  function expectDate(value: unknown, label: string, iso?: string) {
    expect(value instanceof Date, `${label} is a Date`).toBe(true)
    expect(Number.isNaN((value as Date).getTime()), `${label} is a valid Date`).toBe(false)
    if (iso) expect((value as Date).toISOString(), label).toBe(iso)
  }

  it('todos: createdAt / modifiedAt / dueDate / nextFollowupAt', async () => {
    await importFixture()
    const todos = await db.todos.orderBy('id').toArray()
    for (const t of todos) {
      expectDate(t.createdAt, `todo ${t.id} createdAt`)
      expectDate(t.modifiedAt, `todo ${t.id} modifiedAt`)
      if (t.dueDate !== undefined) expectDate(t.dueDate, `todo ${t.id} dueDate`)
      if (t.nextFollowupAt !== undefined) expectDate(t.nextFollowupAt, `todo ${t.id} nextFollowupAt`)
    }
    const report = todos.find((t) => t.title === 'Send quarterly report')!
    expectDate(report.dueDate, 'report dueDate', '2026-10-16T00:00:00.000Z')
    expectDate(report.createdAt, 'report createdAt', '2026-09-02T10:00:00.000Z')
  })

  it('canvases, projects (up to v59), notes carry Dates; todoEvents.timestamp stays a string', async () => {
    const at59 = fixtureAt(59)
    for (const c of at59.canvases!) expectDate(c.createdAt, `canvas ${String(c.id)} createdAt`)
    for (const p of at59.projects!) expectDate(p.createdAt, `project ${String(p.id)} createdAt`)
    await importFixture()
    for (const n of await db.notes.toArray()) {
      expectDate(n.createdAt, `note ${n.id} createdAt`)
      expectDate(n.modifiedAt, `note ${n.id} modifiedAt`, '2026-09-15T08:00:00.000Z')
    }
    for (const e of await db.todoEvents.toArray()) expect(typeof e.timestamp).toBe('string')
  })
})

// ── v51: uid + completedAt ───────────────────────────────────────────────

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

// ── v52: horizons / scoreboard / snooze-graveyard widgets removed ─────────

describe('v49 fixture → v52: removed widgets are gone, everything else intact', () => {
  it('drops the three placement tables; their rows do not reappear anywhere', async () => {
    await importFixture()
    const tableNames = db.tables.map((t) => t.name)
    for (const dropped of ['floatingHorizons', 'floatingScoreboard', 'floatingSnoozeGraveyard']) {
      expect(tableNames, `${dropped} table`).not.toContain(dropped)
    }
    // Surviving placement tables keep exactly the fixture's rows (until v60).
    expect(fixtureAt(59).floatingStatus).toHaveLength(fixture.floatingStatus.length)
  })

  it('deletes the horizonSlots / selectedHorizonDefId settings rows', async () => {
    await importFixture()
    expect(await db.settings.get('horizonSlots')).toBeUndefined()
    expect(await db.settings.get('selectedHorizonDefId')).toBeUndefined()
  })

  it('keeps the list definitions the horizons widget showed (ordinary lists now)', async () => {
    await importFixture()
    const names = (await fixtureListDefinitions()).map((d) => d.name)
    expect(names).toEqual(fixture.listDefinitions.map((d) => d.name))
  })

  it('strips removed-kind tabs from the rails setting (up to v59)', () => {
    const rails = railsAt(59)
    const tabTypes = ['left', 'right', 'top', 'bottom']
      .flatMap((side) => rails[side]?.slots ?? [])
      .flatMap((slot: { tabs: Array<{ type: string }> }) => slot.tabs.map((t) => t.type))
    for (const type of tabTypes) expect(['lens', 'notes', 'calendar', 'status']).toContain(type)

    // Right slot: taskboard + horizons → taskboard only (a tab of the Focus list since v59).
    expect(rails.right.slots).toHaveLength(1)
    expect(rails.right.slots[0]).toMatchObject({ id: 's-tb', activeTabId: 't-tb', tabs: [{ id: 't-tb', type: 'lens', listDefinitionId: FOCUS_LIST_ID }] })
    // Bottom slot: status + scoreboard + snooze graveyard → status only.
    expect(rails.bottom.slots[0]).toMatchObject({ id: 's-stats', activeTabId: 't-st', tabs: [{ id: 't-st', type: 'status' }] })
    // Untouched parts survive verbatim.
    const original = JSON.parse(fixture.settings.find((s) => s.key === 'canvasRails')!.value)
    expect(rails.left).toEqual(original.left)
    expect(rails.top).toBeNull()
    expect({ widths: rails.widths, heights: rails.heights, corners: rails.corners, collapsed: rails.collapsed })
      .toEqual({ widths: original.widths, heights: original.heights, corners: original.corners, collapsed: original.collapsed })
  })
})

describe('v49 fixture → follow-up fields: no backfill beyond the scheduled date', () => {
  it('no task gets a last follow-up; only formerly scheduled tasks get a next one (see v53)', async () => {
    await importFixture()
    const todos = await db.todos.toArray()
    expect(todos.length).toBe(fixture.todos.length)
    const hadScheduled = new Set(fixture.todos.filter((t) => 'scheduledDate' in t).map((t) => t.id))
    for (const t of todos) {
      expect(t.lastFollowupAt, `todo ${t.id} lastFollowupAt`).toBeUndefined()
      expect(t.nextFollowupAt !== undefined, `todo ${t.id} nextFollowupAt`).toBe(hadScheduled.has(t.id!))
    }
  })

  it('stored predicates without hasFollowup still load (up to v63), and no default-interval row is invented', async () => {
    await importFixture()
    for (const def of fixtureAt(63).listDefinitions!.filter((d) => d.id !== FOCUS_LIST_ID)) {
      expect('hasFollowup' in (def.membership as { predicate: object }).predicate, `${String(def.name)} predicate`).toBe(false)
    }
    for (const def of await fixtureListDefinitions()) expect(def.membership.predicate.dates.followup, def.name).toBeUndefined()
    expect(await db.settings.get('followupDefaultInterval')).toBeUndefined()
  })
})

// ── v53: scheduled date removed ──────────────────────────────────────────

describe('v49 fixture → v53: scheduled dates become next follow-ups; removed enums rewritten', () => {
  /** The local calendar day containing `iso`, at midnight. */
  function localDay(iso: string): Date {
    const d = new Date(iso)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }

  it('strips scheduledDate from every todo', async () => {
    await importFixture()
    for (const t of await db.todos.toArray()) {
      expect('scheduledDate' in t, `todo ${t.id} scheduledDate`).toBe(false)
    }
  })

  it('a precise scheduled date becomes nextFollowupAt (local midnight); the due date is untouched', async () => {
    await importFixture()
    const todos = await db.todos.toArray()
    const report = todos.find((t) => t.title === 'Send quarterly report')!
    expect(report.nextFollowupAt).toEqual(localDay('2026-10-12T00:00:00.000Z'))
    expect(report.dueDate).toEqual(new Date('2026-10-16T00:00:00.000Z'))
    const invoice = todos.find((t) => t.title === 'Chase Globex invoice')!
    expect(invoice.nextFollowupAt).toEqual(localDay('2026-10-09T00:00:00.000Z'))
    expect(invoice.dueDate).toBeUndefined()
  })

  it('a fuzzy scheduled value resolves to the end of the window it was picked for', async () => {
    await importFixture()
    const todos = await db.todos.toArray()
    // "next week" picked 2026-09-10 with a Monday week start → the Sunday after next.
    const setAt = localDay('2026-09-10T09:30:00.000Z')
    const toSunday = (7 - setAt.getDay()) % 7
    const dentist = todos.find((t) => t.title === 'Book dentist')!
    expect(dentist.nextFollowupAt).toEqual(
      new Date(setAt.getFullYear(), setAt.getMonth(), setAt.getDate() + toSunday + 7),
    )
    // "next month" picked in September → 31 October (a completed task keeps it too).
    const passport = todos.find((t) => t.title === 'Renew passport')!
    const picked = localDay('2026-09-05T13:00:00.000Z')
    expect(passport.nextFollowupAt).toEqual(new Date(picked.getFullYear(), picked.getMonth() + 2, 0))
  })

  it('recurrence anchors are preserved (anchored on the due date)', async () => {
    await importFixture()
    const todos = await db.todos.toArray()
    for (const t of todos.filter((x) => x.recurrenceRule)) {
      expect(t.dueDate, `recurring todo ${t.id} keeps a due date`).toBeInstanceOf(Date)
    }
  })

  it('no list definition references a removed sort / group / date field or hasScheduled', async () => {
    await importFixture()
    const defs = await db.listDefinitions.orderBy('sortOrder').toArray()
    for (const def of defs) {
      expect(['date', 'scheduled'], `${def.name} sort`).not.toContain(def.sort)
      expect(['date', 'scheduled'], `${def.name} grouping`).not.toContain(def.grouping)
      expect('hasScheduled' in def.membership.predicate, `${def.name} hasScheduled`).toBe(false)
    }
    // The predicates as v53 left them (v64 folds the date fields into `dates`).
    const predicatesAt63 = fixtureAt(63).listDefinitions!.map((d) => (d.membership as { predicate: Record<string, unknown> }).predicate)
    for (const p of predicatesAt63) expect(['date', 'scheduled']).not.toContain(p.dateField)
    const [thisWeek, someday, byPerson, acme] = predicatesAt63
    expect(defs[0]).toMatchObject({ sort: 'deadline', grouping: 'none' })
    // The removed 'date' grouping of "Acme" became 'project' at v53 (and 'tag' at v60).
    expect(fixtureAt(53).listDefinitions![3]).toMatchObject({ grouping: 'project' })
    expect(thisWeek).toMatchObject({
      dateField: 'deadline',
      dateRangeStart: { kind: 'relative', token: 'start-of-week' },
      dateRangeEnd: { kind: 'relative', token: 'end-of-week' },
    })
    expect(someday).toMatchObject({ dateField: 'deadline', hasDeadline: false })
    expect(byPerson!.dateField).toBe('deadline')
    // "Include no date" only applied to the effective date; on a predicate that
    // already filtered by due date it was inert, and stays inert.
    expect(acme).toMatchObject({ dateField: 'deadline', dateRangeIncludeNoDate: false })
  })

  it('removes the seeded follow-up status pointer but keeps the status itself', async () => {
    await importFixture()
    expect(await db.settings.get('seededFollowupStatusId')).toBeUndefined()
    expect((await db.statuses.toArray()).some((s) => s.name === 'Follow-up')).toBe(true)
    // The fixture picked a quick status explicitly; it is unchanged.
    expect((await db.settings.get('quickStatusId'))?.value).toBe('2')
  })

  it('keeps historical scheduled todoEvents', async () => {
    await importFixture()
    const scheduled = (await db.todoEvents.toArray()).filter((e) => e.type === 'scheduled')
    expect(scheduled.length).toBe(fixture.todoEvents.filter((e) => e.type === 'scheduled').length)
    expect(scheduled.length).toBeGreaterThan(0)
  })
})

// ── v54: hide-by-status removed ──────────────────────────────────────────

describe('v49 fixture → v54: hidden statuses removed', () => {
  function upgradedFixture(): DataSet {
    const raw = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>
    const tables: DataSet = {}
    for (const [key, value] of Object.entries(raw)) if (Array.isArray(value)) tables[key] = value as DataSet[string]
    return upgradeDataSet(tables, 49, CURRENT_DB_VERSION)
  }

  it('the fixture has a hidden-by-default status and predicates carrying showHiddenStatuses', () => {
    expect(fixture.statuses.some((s) => 'hideByDefault' in s && s.hideByDefault)).toBe(true)
    expect(fixture.listDefinitions.every((d) => 'showHiddenStatuses' in d.membership.predicate)).toBe(true)
  })

  it('the upgrade pipeline strips hideByDefault from statuses and showHiddenStatuses from predicates', () => {
    const data = upgradedFixture()
    for (const s of data.statuses!) expect('hideByDefault' in s, `status ${String(s.name)}`).toBe(false)
    for (const d of data.listDefinitions!) {
      const p = (d.membership as { predicate: Record<string, unknown> }).predicate
      expect('showHiddenStatuses' in p, `${String(d.name)} predicate`).toBe(false)
    }
  })

  it('no status filter is invented: lists keep their own status filters, showCompleted untouched', async () => {
    await importFixture()
    const defs = await fixtureListDefinitions()
    expect(defs.map((d) => d.membership.predicate.statusIds)).toEqual(
      fixture.listDefinitions.map((d) => d.membership.predicate.statusIds),
    )
    expect(defs.map((d) => d.membership.predicate.showCompleted)).toEqual(
      fixture.listDefinitions.map((d) => d.membership.predicate.showCompleted),
    )
    const statuses = await db.statuses.toArray()
    for (const s of statuses) expect('hideByDefault' in s, `status ${s.name}`).toBe(false)
  })
})

// ── v55: orgs merged into people ─────────────────────────────────────────

describe('v49 fixture → v55: orgs become Org: people', () => {
  it('the fixture has orgs, org assignments, membership and an org filter', () => {
    expect(fixture.orgs.map((o) => o.name)).toEqual(['Acme', 'Globex'])
    expect(fixture.todoOrgs).toHaveLength(2)
    expect(fixture.personOrgs).toHaveLength(2)
    expect(fixture.listDefinitions.some((d) => d.membership.predicate.orgIds !== null)).toBe(true)
  })

  it('each org is a person named Org: <name>, colored orange, initials kept or generated', async () => {
    await importFixture()
    const people = await db.people.orderBy('id').toArray()
    expect(people.slice(3)).toEqual([
      { id: 4, name: 'Org: Acme', initials: 'AC', color: '#f28c4e' },
      { id: 5, name: 'Org: Globex', initials: 'G', color: '#f28c4e' },
    ])
  })

  it('org assignments are person assignments; existing ones untouched', async () => {
    await importFixture()
    const pairs = (await db.todoPeople.toArray()).map((r) => [r.todoId, r.personId])
    expect(pairs).toEqual(expect.arrayContaining([[1, 1], [3, 2], [5, 1], [3, 5], [6, 4]]))
    expect(pairs).toHaveLength(5)
  })

  it('membership is gone; members keep the org color they were shown in', async () => {
    await importFixture()
    for (const name of ['orgs', 'todoOrgs', 'personOrgs']) {
      expect(db.tables.some((t) => t.name === name), name).toBe(false)
    }
    const people = await db.people.orderBy('id').toArray()
    expect(people[0]).toMatchObject({ name: 'Ann Lee', color: '#e05050' }) // member of Acme (red)
    expect('color' in people[1]!).toBe(false) // member of Globex (no color)
    expect('color' in people[2]!).toBe(false) // no membership
  })

  it('stored predicates fold the org filter into the person filter and lose the filter modes', async () => {
    await importFixture()
    const defs = await fixtureListDefinitions()
    for (const d of defs) {
      const p = d.membership.predicate as unknown as Record<string, unknown>
      for (const key of ['orgIds', 'orgFilterMode', 'personFilterMode']) {
        expect(key in p, `${d.name}.${key}`).toBe(false)
      }
    }
    expect(defs.map((d) => d.membership.predicate.personIds)).toEqual([null, null, null, [1, 0, 4]])
  })
})

// ── v56: workspace layouts (v57: no saved prompt picks; v59: taskboard tabs show the Focus list) ──

/** The Default layout v56 builds from the fixture's rails and floats (v57 / v59 applied). */
const V56_DEFAULT_COLUMNS = [
  {
    id: 'col-1', weight: 1, cells: [
      {
        id: 's-lens', weight: 2, activeTabId: 't-lens', tabs: [
          { id: 't-lens', kind: 'lens', config: { listDefinitionId: 3 } },
          { id: 't-notes', kind: 'notes', config: {} },
        ],
      },
      {
        id: 's-cal', weight: 1, activeTabId: 't-cal', tabs: [
          { id: 't-cal', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', offset: 1 } },
        ],
      },
    ],
  },
  // Bottom rail (no top rail); horizons / stats tabs were already removed by v52.
  { id: 'col-2', weight: 1, cells: [{ id: 's-stats', weight: 1, activeTabId: 't-st', tabs: [{ id: 't-st', kind: 'status', config: {} }] }] },
  // Right rail — collapsed on the canvas; the rail's collapse is not carried over.
  { id: 'col-3', weight: 1, cells: [{ id: 's-tb', weight: 1, activeTabId: 't-tb', tabs: [{ id: 't-tb', kind: 'lens', config: { listDefinitionId: FOCUS_LIST_ID } }] }] },
  // Floats in canvas reading order (y, then x).
  {
    id: 'col-4', weight: 1, cells: [
      {
        id: 'cell-floatingCalendars-1', weight: 1, activeTabId: 'tab-floatingCalendars-1', tabs: [
          { id: 'tab-floatingCalendars-1', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', offset: -1 } },
        ],
      },
      { id: 'cell-floatingNotes-1', weight: 1, activeTabId: 'tab-floatingNotes-1', tabs: [{ id: 'tab-floatingNotes-1', kind: 'notes', config: {} }] },
      {
        id: 'cell-floatingCalendars-2', weight: 1, activeTabId: 'tab-floatingCalendars-2', tabs: [
          { id: 'tab-floatingCalendars-2', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', offset: 0 } },
        ],
      },
      { id: 'cell-floatingTaskboards-1', weight: 1, collapsed: true, activeTabId: 'tab-floatingTaskboards-1', tabs: [{ id: 'tab-floatingTaskboards-1', kind: 'lens', config: { listDefinitionId: FOCUS_LIST_ID } }] },
      { id: 'cell-floatingStatus-1', weight: 1, collapsed: true, activeTabId: 'tab-floatingStatus-1', tabs: [{ id: 'tab-floatingStatus-1', kind: 'status', config: {} }] },
      {
        id: 'cell-listInsets-1', weight: 1, activeTabId: 'tab-listInsets-1', tabs: [
          { id: 'tab-listInsets-1', kind: 'lens', config: { listDefinitionId: 3 } },
        ],
      },
      {
        id: 'cell-listInsets-2', weight: 1, collapsed: true, activeTabId: 'tab-listInsets-2', tabs: [
          { id: 'tab-listInsets-2', kind: 'lens', config: { listDefinitionId: 2 } },
        ],
      },
    ],
  },
]

describe('v49 fixture → v57: rails + floating widgets become the Default layout', () => {
  const canvasCreatedAt = new Date('2026-09-01T09:00:00.000Z')

  it('seeds one active Default layout: left rail, bottom rail, right rail, then every float', async () => {
    await importFixture()
    // (v68 adds a second layout, "Lists from upgrade".)
    const layouts = (await db.layouts.toArray()).filter((l) => l.name === 'Default')
    expect(layouts).toHaveLength(1)
    expect((await db.settings.get('activeLayoutId'))?.value).toBe('1')
    expect(layouts[0]).toMatchObject({ id: 1, name: 'Default', createdAt: canvasCreatedAt, modifiedAt: canvasCreatedAt })
    // As v56 made it (v62 later drops its status tabs).
    expect(fixtureAt(61).layouts![0]!.columns).toEqual(V56_DEFAULT_COLUMNS)
  })

  it('leaves the canvas, rails and floating widgets in place (v60 drops them)', () => {
    const at59 = fixtureAt(59)
    expect(at59.settings!.some((s) => s.key === 'canvasRails')).toBe(true)
    // Plus the inset the floating taskboard became (v59).
    expect(at59.listInsets).toHaveLength(fixture.listInsets.length + 1)
    expect(at59.floatingCalendars).toHaveLength(fixture.floatingCalendars.length)
    expect(at59.floatingNotes).toHaveLength(fixture.floatingNotes.length)
  })
})

// ── v58: per-list manual order ───────────────────────────────────────────
describe('v49 fixture → v58: manual lists start unranked', () => {
  it('ranks no fixture list; manual lists keep their manual sort', async () => {
    await importFixture()
    // The only ranks are the Focus list's (v59).
    expect((await db.listOrders.toArray()).every((r) => r.listDefinitionId === FOCUS_LIST_ID)).toBe(true)
    const manual = (await fixtureListDefinitions()).filter((d) => d.sort === 'manual')
    expect(manual.length).toBe(fixture.listDefinitions.filter((d) => (d as { sort?: unknown }).sort === 'manual').length)
  })
})

// ── v59: the taskboard becomes Focus ─────────────────────────────────────
describe('v49 fixture → v59: taskboard tasks are in focus, in a manually ordered Focus list', () => {
  it('the fixture has a taskboard with two entries, a floating taskboard and a rail taskboard tab', () => {
    expect(fixture.taskboards).toHaveLength(1)
    expect(fixture.taskboards[0]!.entries).toEqual([{ todoId: 6, sortOrder: 0 }, { todoId: 1, sortOrder: 1 }])
    expect(fixture.floatingTaskboards).toHaveLength(1)
    expect(fixture.settings.find((s) => s.key === 'canvasRails')!.value).toContain('"type":"taskboard"')
  })

  it('marks exactly the taskboard tasks as in focus', async () => {
    await importFixture()
    const todos = await db.todos.orderBy('id').toArray()
    expect(todos.filter((t) => t.focus === true).map((t) => t.id)).toEqual([1, 6])
    for (const t of todos.filter((x) => x.id !== 1 && x.id !== 6)) expect('focus' in t, `todo ${t.id}`).toBe(false)
  })

  it('creates the Focus list (focus = true, manual, ungrouped) last, with ranks in taskboard order', async () => {
    const atV59 = fixtureAt(59).listDefinitions!.find((d) => d.id === FOCUS_LIST_ID)!
    expect((atV59.membership as { predicate: Record<string, unknown> }).predicate).toMatchObject({ focus: true })
    await importFixture()
    const focus = await db.listDefinitions.get(FOCUS_LIST_ID)
    expect(focus).toMatchObject({
      id: FOCUS_LIST_ID, name: 'Focus', sortOrder: 4, sort: 'manual', grouping: 'none',
    })
    // v59 created it pinned; v63 drops the pin with every other list's.
    expect(fixtureAt(62).listDefinitions!.find((d) => d.id === FOCUS_LIST_ID)).toMatchObject({ pinnedToDashboard: true })
    // v61 turned its focus filter into the Markers filter.
    expect(focus!.membership.predicate).toMatchObject({ markers: { focus: true }, showCompleted: false, personIds: null, tags: null, dates: {} })
    const ranks = (await db.listOrders.toArray()).map((r) => [r.listDefinitionId, r.todoId, r.rank])
    expect(ranks).toEqual([[FOCUS_LIST_ID, 6, 1], [FOCUS_LIST_ID, 1, 2]])
  })

  it('drops the taskboard tables; the floating taskboard is a list inset of the Focus list (until v60)', async () => {
    await importFixture()
    const names = db.tables.map((t) => t.name)
    expect(names).not.toContain('taskboards')
    expect(names).not.toContain('floatingTaskboards')
    const inset = fixtureAt(59).listInsets!.find((i) => i.listDefinitionId === FOCUS_LIST_ID)
    expect(inset).toMatchObject({ canvasId: 1, x: 1250, y: 340, width: 300, height: 260, isCollapsed: true })
  })

  it('the upgraded data has no taskboard left anywhere and upgrading again changes nothing', () => {
    const raw = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>
    const tables: DataSet = {}
    for (const [key, value] of Object.entries(raw)) if (Array.isArray(value)) tables[key] = value as DataSet[string]
    const upgraded = upgradeDataSet(tables, 49, CURRENT_DB_VERSION)
    expect('taskboards' in upgraded || 'floatingTaskboards' in upgraded).toBe(false)
    // Ids made from the old widgets (e.g. `tab-floatingTaskboards-1`) stay; no tab is a taskboard
    // (rail tabs sit in a JSON string, so their quotes are escaped).
    const taskboardTab = /(kind|type)\\*":\\*"taskboard\\*"/
    expect(JSON.stringify(tables)).toMatch(taskboardTab)
    expect(JSON.stringify(upgraded)).not.toMatch(taskboardTab)
    expect(upgradeDataSet(upgraded, 58, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

// ── v60: projects become tags; the canvas goes ───────────────────────────
describe('v49 fixture → v60: projects are Project: tags, canvas data is gone', () => {
  it('the fixture has two projects, a canvas, project-filtered / -grouped lists and canvas settings', () => {
    expect(fixture.projects.map((p) => p.name)).toEqual(['Work', 'Home'])
    expect(fixture.canvases).toHaveLength(1)
    expect(fixture.listDefinitions[3]!.membership.predicate.projectIds).toEqual([1, 0])
    for (const key of ['defaultProjectId', 'defaultProjectGroupBy', 'canvasViewport', 'canvasMaxExtent', 'canvasRails']) {
      expect(fixture.settings.some((s) => s.key === key), key).toBe(true)
    }
  })

  it('each project is a Project: <name> tag in its color (default blue without one)', async () => {
    await importFixture()
    expect(await db.tags.get(PROJECT_WORK_TAG_ID)).toEqual({ id: PROJECT_WORK_TAG_ID, name: 'Project: Work', color: '#4f8cff' })
    expect(await db.tags.get(PROJECT_HOME_TAG_ID)).toEqual({ id: PROJECT_HOME_TAG_ID, name: 'Project: Home', color: '#537FE7' })
  })

  it('every task in a project carries its Project: tag; no task keeps projectId / canvasId', async () => {
    await importFixture()
    const byTodo = new Map<number, number[]>()
    for (const r of await db.todoTags.toArray()) byTodo.set(r.todoId, [...(byTodo.get(r.todoId) ?? []), r.tagId])
    for (const t of fixture.todos) {
      const tagIds = byTodo.get(t.id) ?? []
      if (t.projectId === 1) expect(tagIds, `todo ${t.id}`).toContain(PROJECT_WORK_TAG_ID)
      else if (t.projectId === 2) expect(tagIds, `todo ${t.id}`).toContain(PROJECT_HOME_TAG_ID)
      else expect(tagIds.some((id) => id === PROJECT_WORK_TAG_ID || id === PROJECT_HOME_TAG_ID), `todo ${t.id}`).toBe(false)
    }
    for (const t of await db.todos.toArray()) {
      expect('projectId' in t || 'canvasId' in t, `todo ${t.id}`).toBe(false)
    }
  })

  it('stored lists: the project filter folds into the tag filter, project grouping → tag; no list is lost', async () => {
    await importFixture()
    const defs = await fixtureListDefinitions()
    expect(defs.map((d) => d.name)).toEqual(fixture.listDefinitions.map((d) => d.name))
    for (const d of defs) expect('projectIds' in d.membership.predicate, `${d.name}.projectIds`).toBe(false)
    // "Acme next 30 days": projects [Work, no project] → tags [Project: Work]
    // (the "no project" pick has no tag equivalent); grouped by project → by tag.
    const acme = defs[3]!
    expect(acme.membership.predicate.tags).toEqual([PROJECT_WORK_TAG_ID])
    expect(acme.grouping).toBe('tag')
    expect(acme.runtimeFilter).toEqual({ field: 'tag' })
    // Lists without a project filter keep their tag filters as they were.
    expect(defs.slice(0, 3).map((d) => d.membership.predicate.tags)).toEqual([null, null, [2]])
  })

  it('drops the project, canvas, list-inset and floating widget tables and the canvas / project settings', async () => {
    await importFixture()
    const names = db.tables.map((t) => t.name)
    for (const t of ['projects', 'canvases', 'listInsets', 'floatingCalendars', 'floatingNotes', 'floatingStatus']) {
      expect(names, t).not.toContain(t)
    }
    for (const key of ['defaultProjectId', 'defaultProjectGroupBy', 'canvasViewport', 'canvasMaxExtent', 'canvasRails']) {
      expect(await db.settings.get(key), key).toBeUndefined()
    }
  })

  it('the Default layout (made from the rails and floats at v56) and the note survive', async () => {
    await importFixture()
    const [layout] = await db.layouts.toArray()
    expect(layout!.columns.flatMap((c) => c.cells.flatMap((cell) => cell.tabs.map((t) => t.id)))).toContain('tab-listInsets-1')
    expect(await db.notes.count()).toBe(fixture.notes.length)
  })

  it('upgrading the v60 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 59, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

// ── v61: the Focus filter folds into the Markers filter ──────────────────
describe('v49 fixture → v61: list predicates use markers; no task is flagged urgent or important', () => {
  it('no stored list keeps a focus filter; the Focus list requires the Focus marker', async () => {
    await importFixture()
    const defs = await db.listDefinitions.orderBy('id').toArray()
    for (const d of defs) expect('focus' in d.membership.predicate, `${d.name}.focus`).toBe(false)
    expect(defs.find((d) => d.id === FOCUS_LIST_ID)!.membership.predicate.markers).toEqual({ focus: true })
    // The fixture's own lists had no focus filter: they gain no markers.
    for (const d of defs.filter((x) => x.id !== FOCUS_LIST_ID)) {
      expect(d.membership.predicate.markers ?? null, d.name).toBeNull()
    }
  })

  it('tasks get no urgent / important flag and no urgent-range setting is invented', async () => {
    await importFixture()
    for (const t of await db.todos.toArray()) {
      expect('urgent' in t || 'important' in t, `todo ${t.id}`).toBe(false)
    }
    expect(await db.settings.get('urgentDueWithinDays')).toBeUndefined()
  })

  it('upgrading the v61 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 60, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

// ── v62: the Status widget is retired ────────────────────────────────────
describe('v49 fixture → v62: the Default layout loses its status tabs', () => {
  it('drops the status tabs, the cell / column left empty, and keeps everything else', async () => {
    await importFixture()
    const [layout] = await db.layouts.toArray()
    const expected = V56_DEFAULT_COLUMNS
      // The bottom rail held only the status tab: its column goes.
      .filter((col) => col.id !== 'col-2')
      .map((col) => ({ ...col, cells: col.cells.filter((cell) => cell.id !== 'cell-floatingStatus-1') }))
    expect(layout!.columns).toEqual(expected)
    const kinds = layout!.columns.flatMap((c) => c.cells.flatMap((cell) => cell.tabs.map((t) => t.kind)))
    expect(kinds).not.toContain('status')
  })

  it('upgrading the v62 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 61, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

describe('v49 fixture → v63: lists lose the pin; the app background colour is renamed', () => {
  /** The fixture with the canvas background overridden in both themes (it has no such row of its own). */
  function withCanvasBackground(): Record<string, unknown> {
    const raw = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>
    raw.settings = [
      ...(raw.settings as unknown[]),
      { key: 'color.dark.canvasBg', value: '#202830' },
      { key: 'color.light.canvasBg', value: '#fdf6e3' },
    ]
    return raw
  }

  it('the fixture lists carry the pin up to v62', () => {
    const at62 = fixtureAt(62).listDefinitions!
    expect(at62.length).toBeGreaterThan(0)
    expect(at62.every((d) => typeof d.pinnedToDashboard === 'boolean')).toBe(true)
  })

  it('no stored list keeps pinnedToDashboard; the lists are otherwise as at v62', async () => {
    await importFixture()
    const defs = await db.listDefinitions.orderBy('id').toArray()
    expect(defs.some((d) => 'pinnedToDashboard' in d)).toBe(false)
    const at62 = fixtureAt(62).listDefinitions!.map((d) => {
      const rest = { ...d }
      delete rest.pinnedToDashboard
      return rest
    })
    expect(fixtureAt(63).listDefinitions).toEqual(at62)
  })

  it('canvasBg overrides of both themes become appBg with the same value; the other colours are untouched', async () => {
    const prepared = prepareImport(withCanvasBackground())
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    await restoreFromImportData(prepared.data)
    const colours = Object.fromEntries((await db.settings.toArray()).filter((s) => s.key.startsWith('color.')).map((s) => [s.key, s.value]))
    expect(colours).toEqual({
      'color.dark.accent': '#4f8cff',
      'color.light.accent': '#1a5fd0',
      'color.dark.appBg': '#202830',
      'color.light.appBg': '#fdf6e3',
    })
  })

  it('upgrading the v63 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 62, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

describe('v49 fixture → v64: date filters per date type; the list and tag caps go', () => {
  const OLD_DATE_KEYS = ['dateField', 'dateRangeStart', 'dateRangeEnd', 'dateRangeIncludeNoDate', 'hasDeadline', 'hasFollowup']
  const predicateOf = (d: Record<string, unknown>) => (d.membership as { predicate: Record<string, unknown> }).predicate

  it('up to v63 the lists keep the single range, the presence filters and the caps; maxTags is stored', () => {
    const at63 = fixtureAt(63)
    for (const d of at63.listDefinitions!) expect('dateField' in predicateOf(d), String(d.name)).toBe(true)
    expect(at63.listDefinitions!.filter((d) => 'maxTasks' in d).map((d) => [d.id, d.maxTasks, d.limitMode])).toEqual([[3, 25, 'scroll'], [4, 10, 'hard']])
    expect(at63.settings!.some((r) => r.key === 'maxTags')).toBe(true)
  })

  it('each stored predicate holds its date filters as one clause per date type, nothing else changed', async () => {
    await importFixture()
    const defs = (await db.listDefinitions.orderBy('id').toArray()).filter((d) => d.id !== EISENHOWER_LIST_ID)
    expect(defs.map((d) => [d.name, d.membership.predicate.dates])).toEqual([
      ['This week', { deadline: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'end-of-week' } } }],
      // "Has due date: no" with no range.
      ['Someday', { deadline: { match: 'unset' } }],
      ['By person', {}],
      // The v49 "include no date" was on, but inert on a due-date range (v53 turned it off).
      ['Acme next 30 days', { deadline: { match: 'range', start: { kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' }, end: { kind: 'offset', days: 30 } } }],
      ['Focus', {}],
    ])
    for (const d of defs) for (const key of OLD_DATE_KEYS) expect(key in d.membership.predicate, `${d.name} ${key}`).toBe(false)
    // Apart from the date fields and the caps, every list is as at v63.
    const strip = (d: Record<string, unknown>) => {
      const rest: Record<string, unknown> = { ...d, membership: { ...(d.membership as object), predicate: { ...predicateOf(d) } } }
      delete rest.maxTasks
      delete rest.limitMode
      const p = predicateOf(rest)
      for (const key of [...OLD_DATE_KEYS, 'dates']) delete p[key]
      return rest
    }
    expect(fixtureAt(64).listDefinitions!.map(strip)).toEqual(fixtureAt(63).listDefinitions!.map(strip))
  })

  it('no list keeps maxTasks / limitMode, and the maxTags setting is gone', async () => {
    await importFixture()
    for (const d of await db.listDefinitions.toArray()) {
      expect('maxTasks' in d, d.name).toBe(false)
      expect('limitMode' in d, d.name).toBe(false)
    }
    expect(await db.settings.get('maxTags')).toBeUndefined()
    // Every other setting of v63 is kept.
    const keysAt63 = fixtureAt(63).settings!.map((r) => r.key).filter((k) => k !== 'maxTags')
    expect(fixtureAt(64).settings!.map((r) => r.key)).toEqual(keysAt63)
  })

  it('upgrading the v64 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 63, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

describe('v49 fixture → v65: a version marker, no data change', () => {
  it('every table at v65 is the v64 table', () => {
    const at64 = fixtureAt(64)
    expect(upgradeDataSet(at64, 64, 65)).toBe(at64)
    expect(fixtureAt(65)).toEqual(at64)
  })

  it('upgrading the v65 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 64, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

describe('v49 fixture → v66: the Eisenhower panes and source become settings', () => {
  it('the fixture has no customized Eisenhower tab: every table at v66 is the v65 table', () => {
    const at65 = fixtureAt(65)
    expect(upgradeDataSet(at65, 65, 66)).toBe(at65)
    expect(fixtureAt(66)).toEqual(at65)
    expect(fixtureAt(66).settings!.some((r) => r.key === 'eisenhowerPanes' || r.key === 'eisenhowerSource')).toBe(false)
  })

  it('upgrading the v66 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 65, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

describe('v49 fixture → v67: layouts get an order; the Eisenhower gets its own list', () => {
  it('the Default layout is numbered 0; the Eisenhower (on all tasks) gets a new list with no filter, which the source setting names', async () => {
    const at66 = fixtureAt(66)
    expect(at66.settings!.some((r) => r.key === 'eisenhowerSource')).toBe(false)
    expect(at66.layouts!.every((l) => !('sortOrder' in l))).toBe(true)
    const at67 = upgradeDataSet(at66, 66, 67)
    expect(at67).toEqual(fixtureAt(67))
    // Nothing else changes.
    for (const table of Object.keys(at66)) {
      if (table !== 'layouts' && table !== 'listDefinitions' && table !== 'settings') expect(at67[table], table).toBe(at66[table])
    }
    expect(at67.layouts).toEqual(at66.layouts!.map((l) => ({ ...l, sortOrder: 0 })))
    expect(at67.listDefinitions!.slice(0, -1)).toEqual(at66.listDefinitions)
    expect(at67.settings).toEqual([...at66.settings!, { key: 'eisenhowerSource', value: `list:${EISENHOWER_LIST_ID}` }])

    await importFixture()
    // (v68 adds "Lists from upgrade" after it.)
    expect((await db.layouts.toArray()).map((l) => l.sortOrder)).toEqual([0, 1])
    expect(await db.listDefinitions.get(EISENHOWER_LIST_ID)).toEqual({
      id: EISENHOWER_LIST_ID, name: 'Eisenhower', sortOrder: 5,
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
      owner: { eisenhower: true },
    })
    expect((await db.settings.get('eisenhowerSource'))?.value).toBe(`list:${EISENHOWER_LIST_ID}`)
    // Only it is the Eisenhower's, and no layout's list chooser offers it.
    const lists = await db.listDefinitions.toArray()
    expect(lists.filter((d) => isEisenhowerOwner(d.owner)).map((d) => d.id)).toEqual([EISENHOWER_LIST_ID])
    for (const layout of await db.layouts.toArray()) expect(listedLists(lists, layout.id).map((d) => d.id)).not.toContain(EISENHOWER_LIST_ID)
  })

  it('upgrading the v67 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 66, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

/** Id of the layout v68 makes for the fixture's lists the Default layout doesn't show: after the Default layout. */
const LISTS_FROM_UPGRADE_LAYOUT_ID = 2

describe('v49 fixture → v68: every list belongs to a layout', () => {
  it('the Default layout keeps the lists it shows; the others go into a new layout "Lists from upgrade"; nothing else changes', async () => {
    const at67 = fixtureAt(67)
    expect(at67.listDefinitions!.filter((d) => !isEisenhowerOwner(d.owner as never)).every((d) => d.owner === undefined)).toBe(true)
    const at68 = upgradeDataSet(at67, 67, 68)
    expect(at68).toEqual(fixtureAt(68))
    for (const table of Object.keys(at67)) {
      if (table !== 'layouts' && table !== 'listDefinitions') expect(at68[table], table).toBe(at67[table])
    }
    // The Default layout shows "Someday" (2), "By person" (3) and the Focus list (5): they become its lists, unchanged otherwise.
    const owners = Object.fromEntries(at68.listDefinitions!.map((d) => [d.name, d.owner]))
    expect(owners).toEqual({
      'This week': { layoutId: LISTS_FROM_UPGRADE_LAYOUT_ID },
      Someday: { layoutId: 1 },
      'By person': { layoutId: 1 },
      'Acme next 30 days': { layoutId: LISTS_FROM_UPGRADE_LAYOUT_ID },
      Focus: { layoutId: 1 },
      Eisenhower: { eisenhower: true },
    })
    const withoutOwner = (rows: DataSet[string]) => rows.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'owner')))
    expect(withoutOwner(at68.listDefinitions!)).toEqual(withoutOwner(at67.listDefinitions!))
    // The Default layout is the same; the new one is after it: one cell of list tabs in the list order.
    expect(at68.layouts![0]).toBe(at67.layouts![0])
    expect(at68.layouts![1]).toEqual({
      id: LISTS_FROM_UPGRADE_LAYOUT_ID,
      name: 'Lists from upgrade',
      sortOrder: 1,
      columns: [{ id: 'col-1', weight: 1, cells: [{ id: 'cell-1', weight: 1, activeTabId: 'tab-1', tabs: [
        { id: 'tab-1', kind: 'lens', config: { listDefinitionId: 1 } },
        { id: 'tab-2', kind: 'lens', config: { listDefinitionId: 4 } },
      ] }] }],
      // The latest layout date there is (the Default layout's).
      createdAt: at67.layouts![0]!.createdAt,
      modifiedAt: at67.layouts![0]!.createdAt,
    })

    await importFixture()
    const stored = await db.layouts.get(LISTS_FROM_UPGRADE_LAYOUT_ID)
    expect(stored?.name).toBe('Lists from upgrade')
    const lists = await db.listDefinitions.toArray()
    expect(lists.every((d) => d.owner !== undefined)).toBe(true)
    expect(listedLists(lists, 1).map((d) => d.name)).toEqual(['Someday', 'By person', 'Focus'])
    expect(listedLists(lists, LISTS_FROM_UPGRADE_LAYOUT_ID).map((d) => d.name)).toEqual(['This week', 'Acme next 30 days'])
    // The fixture has no check-in scope: no check-in filter.
    expect(await db.settings.get('checkinTaskFilter')).toBeUndefined()
  })

  it('upgrading the v68 data again changes nothing', () => {
    const upgraded = fixtureAt(CURRENT_DB_VERSION)
    expect(upgradeDataSet(upgraded, 67, CURRENT_DB_VERSION)).toBe(upgraded)
  })
})

// ── Frozen transforms: the output never changes ─────────────────────────────────────────────────────
/**
 * The fixture upgraded to each version, as JSON, hashed (SHA-256, first 16
 * hex digits). The transforms up to v68 are frozen, so these never change:
 * a shared helper or a refactor that changes any transform's output fails
 * here. (A later version adds its own entry; never edit an existing one.)
 *
 * v53 turns precise scheduled dates into local midnights, so the output
 * depends on the time zone: the check runs in the zone the digests were
 * recorded in (America/Chicago), whatever the machine's zone.
 */
const FROZEN_OUTPUT_DIGESTS: Readonly<Record<number, string>> = {
  50: '59b8f9865081f2a6',
  51: 'b54d81b11fbcf000',
  52: '96dd5fd18009f5db',
  53: 'b01566b2cb7c16d0',
  54: '2d760f5ff449669a',
  55: '74e19a1ec893baf4',
  56: 'f40fd628325b9447',
  57: 'd68ab53a3969e961',
  58: 'd68ab53a3969e961',
  59: '3be17224b306621d',
  60: '5a9a472912b7f8f9',
  61: '43c2476afe90c43e',
  62: '7a756537e39297bf',
  63: '13816223c358d095',
  64: 'd89ed146e9a87d82',
  65: 'd89ed146e9a87d82',
  66: 'd89ed146e9a87d82',
  67: 'b47768b8d8181f2b',
  68: '7fedd87dbe1f7ff9',
}
const DIGESTS_TIME_ZONE = 'America/Chicago'

describe('v49 fixture → every version: frozen transforms give the recorded output', () => {
  // Node re-reads TZ when it is assigned, but deleting it keeps the last zone,
  // so put back the zone this worker had by name (shared vitest workers).
  const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  beforeAll(() => { process.env.TZ = DIGESTS_TIME_ZONE })
  afterAll(() => { process.env.TZ = originalZone })

  it('the fixture upgraded to each version hashes to its recorded digest', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(DIGESTS_TIME_ZONE)
    const digests: Record<number, string> = {}
    for (const version of Object.keys(FROZEN_OUTPUT_DIGESTS).map(Number)) {
      digests[version] = createHash('sha256').update(JSON.stringify(fixtureAt(version))).digest('hex').slice(0, 16)
    }
    expect(digests).toEqual(FROZEN_OUTPUT_DIGESTS)
    // A schema bump adds its digest (never edits the others).
    expect(Math.max(...Object.keys(FROZEN_OUTPUT_DIGESTS).map(Number))).toBe(CURRENT_DB_VERSION)
  })
})

// ── Long names and titles: imported whole, at every step ───────────────────────────────────────────
describe('v49 fixture with 1,000-character names and titles: every one survives the upgrade', () => {
  const long = (prefix: string) => `${prefix} ${'n'.repeat(1000 - prefix.length - 1)}`

  it('people, orgs (as Org: people), tags, projects (as Project: tags), statuses, lists and tasks keep their whole names / titles', async () => {
    const raw = JSON.parse(JSON.stringify(fixture)) as Record<string, Array<Record<string, unknown>>>
    raw.people![0]!.name = long('person')
    raw.orgs![0]!.name = long('org')
    raw.tags![0]!.name = long('tag')
    raw.projects![0]!.name = long('project')
    raw.statuses![0]!.name = long('status')
    raw.listDefinitions![0]!.name = long('list')
    raw.todos![0]!.title = long('title')

    const prepared = prepareImport(raw)
    if (!prepared.ok) throw new Error(prepared.error)
    await restoreFromImportData(prepared.data)

    const people = (await db.people.toArray()).map((p) => p.name)
    expect(people).toContain(long('person'))
    expect(people).toContain(`Org: ${long('org')}`)
    const tags = (await db.tags.toArray()).map((t) => t.name)
    expect(tags).toContain(long('tag'))
    expect(tags).toContain(`Project: ${long('project')}`)
    expect((await db.statuses.toArray()).map((s) => s.name)).toContain(long('status'))
    expect((await db.listDefinitions.toArray()).map((d) => d.name)).toContain(long('list'))
    expect((await db.todos.toArray()).map((t) => t.title)).toContain(long('title'))
  })
})

// ── Crafted keys: never a prototype, never a colour ─────────────────────────────────────────────────
describe('v49 fixture with a __proto__ key and colour keys that are not theme colours', () => {
  it('imports: __proto__ is skipped, unknown colour rows are dropped with a warning, real colours kept', async () => {
    const text = JSON.stringify(fixture)
    // `JSON.parse` makes `__proto__` an own property, as a crafted file would.
    const raw = JSON.parse(`{"__proto__":{"todos":[],"polluted":true},${text.slice(1)}`) as Record<string, unknown>
    expect(Object.hasOwn(raw, '__proto__')).toBe(true)
    const settings = raw.settings as Array<{ key: string; value: string }>
    settings.push(
      { key: 'color.dark.constructor', value: '#123456' },
      { key: 'color.dark.__proto__', value: '#123456' },
      { key: 'color.light.toString', value: '#123456' },
      { key: 'color.dark.priorityHigh', value: '#ff0000' }, // a colour this app no longer has
      { key: 'color.sepia.accent', value: '#123456' },
      { key: 'color.dark.accent.extra', value: '#123456' },
    )

    const prepared = prepareImport(raw)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toHaveLength(1)
    for (const key of ['color.dark.constructor', 'color.dark.__proto__', 'color.light.toString', 'color.dark.priorityHigh', 'color.sepia.accent', 'color.dark.accent.extra']) {
      expect(prepared.warnings[0]).toContain(key)
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(prepared.data)).toBe(Object.prototype)

    await restoreFromImportData(prepared.data)
    const rows = new Map((await db.settings.toArray()).map((s) => [s.key, s.value]))
    expect(rows.get('color.dark.accent')).toBe('#4f8cff')
    expect([...rows.keys()].filter((k) => k.startsWith('color.')).sort()).toEqual(['color.dark.accent', 'color.light.accent'])
    expect(await db.todos.count()).toBe(fixture.todos.length)
  })
})
