import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import fixture from '../fixtures/v49-export.json'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { upgradeDataSet, type DataSet } from '../../data/schema-upgrades'
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

/** The stored lists that came from the fixture (v59 adds the Focus list). */
async function fixtureListDefinitions() {
  return (await db.listDefinitions.orderBy('sortOrder').toArray()).filter((d) => d.id !== FOCUS_LIST_ID)
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
      // v56 adds `activeLayoutId`; v60 removes the five canvas / project settings.
      if (table.name === 'settings') expected -= 3 - 1 + 5
      // v56 seeds the Default layout.
      if (table.name === 'layouts') expected = 1
      // v55 turns the two orgs into people and their two assignments into person assignments.
      if (table.name === 'people' || table.name === 'todoPeople') expected += 2
      // v59 adds the Focus list and ranks its two tasks.
      if (table.name === 'listDefinitions') expected += 1
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
      pinnedToDashboard: false, maxTasks: 25, limitMode: 'scroll',
      runtimeFilter: { field: 'person', label: 'Who' }, sort: 'deadline', grouping: 'people',
    })
    expect(defs[3]!.membership.predicate.dateRangeEnd).toEqual({ kind: 'offset', days: 30 })
    expect(defs[3]!.membership.predicate.dateRangeStart).toEqual({ kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' })

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
    expect(settings.size).toBe(fixture.settings.length - 3 + 1 - 5)
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

  it('stored predicates without hasFollowup still load, and no default-interval row is invented', async () => {
    await importFixture()
    for (const def of await fixtureListDefinitions()) {
      expect('hasFollowup' in def.membership.predicate, `${def.name} predicate`).toBe(false)
    }
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
      expect(['date', 'scheduled'], `${def.name} dateField`).not.toContain(def.membership.predicate.dateField)
      expect('hasScheduled' in def.membership.predicate, `${def.name} hasScheduled`).toBe(false)
    }
    const [thisWeek, someday, byPerson, acme] = defs
    expect(thisWeek).toMatchObject({ sort: 'deadline', grouping: 'none' })
    // The removed 'date' grouping of "Acme" became 'project' at v53 (and 'tag' at v60).
    expect(fixtureAt(53).listDefinitions![3]).toMatchObject({ grouping: 'project' })
    expect(thisWeek!.membership.predicate).toMatchObject({
      dateField: 'deadline',
      dateRangeStart: { kind: 'relative', token: 'start-of-week' },
      dateRangeEnd: { kind: 'relative', token: 'end-of-week' },
    })
    expect(someday!.membership.predicate).toMatchObject({ dateField: 'deadline', hasDeadline: false })
    expect(byPerson!.membership.predicate.dateField).toBe('deadline')
    // "Include no date" only applied to the effective date; on a predicate that
    // already filtered by due date it was inert, and stays inert.
    expect(acme!.membership.predicate).toMatchObject({ dateField: 'deadline', dateRangeIncludeNoDate: false })
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
    const layouts = await db.layouts.toArray()
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
      id: FOCUS_LIST_ID, name: 'Focus', sortOrder: 4, pinnedToDashboard: true, sort: 'manual', grouping: 'none',
    })
    // v61 turned its focus filter into the Markers filter.
    expect(focus!.membership.predicate).toMatchObject({ markers: { focus: true }, showCompleted: false, personIds: null, tags: null, hasFollowup: null })
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

// ── Frozen transforms: the output never changes ─────────────────────────────────────────────────────
/**
 * The fixture upgraded to each version, as JSON, hashed (SHA-256, first 16
 * hex digits). The transforms up to v62 are frozen, so these never change:
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
