import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV53, resolveStoredScheduled } from '../../data/upgrades/v53-remove-scheduled-date'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { resetDb, v52StoreSpecs } from '../helpers'

const CREATED = new Date(2026, 8, 1, 9, 0)

function todo(id: number, extra: DataRow = {}): DataRow {
  return {
    id, uid: `uid-${id}`, title: `Task ${id}`, isCompleted: false,
    createdAt: CREATED, modifiedAt: CREATED, sortOrder: id, ...extra,
  }
}

function predicate(extra: DataRow = {}): DataRow {
  return {
    showCompleted: false, showHiddenStatuses: false,
    personIds: null, personFilterMode: 'include-orgs', orgIds: null, orgFilterMode: 'include-people',
    projectIds: null, statusIds: null, searchText: '',
    dateField: 'date', dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
    hasScheduled: null, hasDeadline: null, tags: null,
    ...extra,
  }
}

function listDef(id: number, extra: DataRow, pred: DataRow = {}): DataRow {
  return {
    id, name: `List ${id}`, sortOrder: id, pinnedToDashboard: true, favorited: false,
    membership: { kind: 'custom', predicate: predicate(pred) },
    sort: 'manual', grouping: 'none',
    ...extra,
  }
}

function v52DataSet(): DataSet {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: CREATED }],
    statuses: [
      { id: 1, name: 'Assigned', color: '#888888', sortOrder: 0, icon: 'person', hideByDefault: true },
      { id: 2, name: 'Follow-up', color: '#e0a030', sortOrder: 1, icon: 'message-bubble', hideByDefault: false },
    ],
    projects: [
      { id: 1, name: 'P1', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: CREATED, groupBy: 'date' },
      { id: 2, name: 'P2', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: CREATED, groupBy: 'scheduled' },
      { id: 3, name: 'P3', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: CREATED, groupBy: 'status' },
    ],
    todos: [
      // Precise scheduled, no follow-up yet.
      todo(1, { scheduledDate: { kind: 'date', value: new Date(2026, 9, 12, 12, 0) } }),
      // Fuzzy "this week" picked on Thu 2026-09-10 → Sun 2026-09-13 (Monday-first).
      todo(2, { scheduledDate: { kind: 'fuzzy', token: 'this-week', setAt: new Date(2026, 8, 10, 9, 30) } }),
      // Already has a follow-up: kept, scheduled dropped.
      todo(3, {
        scheduledDate: { kind: 'date', value: new Date(2026, 9, 1) },
        nextFollowupAt: new Date(2026, 10, 1),
      }),
      // Recurring, anchored on a precise scheduled date (no due date) → due date.
      todo(4, { scheduledDate: { kind: 'date', value: new Date(2026, 9, 5) }, recurrenceRule: { type: 'weekly' } }),
      // Recurring with a due date: anchor is the due date; scheduled → follow-up.
      todo(5, {
        scheduledDate: { kind: 'date', value: new Date(2026, 9, 6) },
        dueDate: new Date(2026, 9, 20), recurrenceRule: { type: 'monthly', originalDayOfMonth: 20 },
      }),
      // No scheduled date: untouched (same object).
      todo(6, { dueDate: new Date(2026, 9, 7) }),
      // Fuzzy without setAt (pre-v49 shape) falls back to createdAt.
      todo(7, { scheduledDate: { kind: 'fuzzy', token: 'tomorrow' } }),
    ],
    listDefinitions: [
      listDef(1, { sort: 'date', grouping: 'date' }, { dateRangeIncludeNoDate: true }),
      listDef(2, { sort: 'scheduled', grouping: 'scheduled' }, { dateField: 'scheduled', dateRangeIncludeNoDate: true, hasScheduled: true }),
      listDef(3, { sort: 'deadline', grouping: 'people' }, { dateField: 'deadline', dateRangeIncludeNoDate: true }),
      // Already in the current shape (no hasScheduled): untouched.
      listDef(4, { sort: 'followup', grouping: 'followup' }, { dateField: 'followup', hasFollowup: true, dateRangeIncludeNoDate: true }),
    ].map((d) => {
      if (d.id === 4) delete (d.membership as { predicate: DataRow }).predicate.hasScheduled
      return d
    }),
    settings: [
      { key: 'themeMode', value: 'dark' },
      { key: 'weekStartsOn', value: '1' },
      { key: 'seededFollowupStatusId', value: '2' },
      { key: 'defaultProjectGroupBy', value: 'date' },
      { key: 'color.dark.scheduled', value: '#7ec4bc' },
      { key: 'color.light.scheduled', value: '#3a9e93' },
      { key: 'color.dark.deadline', value: '#e86bf0' },
    ],
    todoEvents: [
      { id: 1, todoId: 1, type: 'scheduled', fromValue: null, toValue: '2026-10-12T10:00:00.000Z', timestamp: '2026-09-01T09:00:00.000Z' },
    ],
  }
}

function byId(rows: DataRow[] | undefined, id: number): DataRow {
  const row = rows?.find((r) => r.id === id)
  if (!row) throw new Error(`row ${id} missing`)
  return row
}

describe('upgradeV53 (pure transform)', () => {
  it('is the v53 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(53)
    expect(SCHEMA_UPGRADES.get(53)).toBe(upgradeV53)
  })

  it('moves scheduled days into nextFollowupAt at local midnight and strips scheduledDate', () => {
    const out = upgradeV53(v52DataSet())
    for (const row of out.todos!) expect('scheduledDate' in row, `todo ${String(row.id)}`).toBe(false)
    expect(byId(out.todos, 1).nextFollowupAt).toEqual(new Date(2026, 9, 12))
    expect(byId(out.todos, 2).nextFollowupAt).toEqual(new Date(2026, 8, 13))
    expect(byId(out.todos, 3).nextFollowupAt).toEqual(new Date(2026, 10, 1))
    expect(byId(out.todos, 7).nextFollowupAt).toEqual(new Date(2026, 8, 2))
  })

  it('gives a recurring task anchored on its scheduled date that date as its due date', () => {
    const out = upgradeV53(v52DataSet())
    const anchored = byId(out.todos, 4)
    expect(anchored.dueDate).toEqual(new Date(2026, 9, 5))
    expect(anchored.recurrenceRule).toEqual({ type: 'weekly' })
    expect('nextFollowupAt' in anchored).toBe(false)
    const dueAnchored = byId(out.todos, 5)
    expect(dueAnchored.dueDate).toEqual(new Date(2026, 9, 20))
    expect(dueAnchored.nextFollowupAt).toEqual(new Date(2026, 9, 6))
  })

  it('leaves todos without a scheduled date as the same object', () => {
    const input = v52DataSet()
    const out = upgradeV53(input)
    expect(byId(out.todos, 6)).toBe(byId(input.todos, 6))
  })

  it('rewrites removed sort / group / dateField values to deadline and drops hasScheduled', () => {
    const input = v52DataSet()
    const out = upgradeV53(input)
    const [d1, d2, d3, d4] = out.listDefinitions!.map((d) => d as {
      sort: string; grouping: string; membership: { predicate: Record<string, unknown> }
    })
    expect([d1!.sort, d1!.grouping, d1!.membership.predicate.dateField]).toEqual(['deadline', 'deadline', 'deadline'])
    expect([d2!.sort, d2!.grouping, d2!.membership.predicate.dateField]).toEqual(['deadline', 'deadline', 'deadline'])
    for (const d of [d1, d2, d3, d4]) expect('hasScheduled' in d!.membership.predicate).toBe(false)
    // "Include no date" only ever applied to the effective date: kept where it
    // was effective (now on the due date), cleared where it was inert.
    expect(d1!.membership.predicate.dateRangeIncludeNoDate).toBe(true)
    expect(d2!.membership.predicate.dateRangeIncludeNoDate).toBe(false)
    expect(d3!.membership.predicate.dateRangeIncludeNoDate).toBe(false)
    expect(d4).toBe(input.listDefinitions![3])
  })

  it('rewrites project group-by and the defaultProjectGroupBy setting', () => {
    const out = upgradeV53(v52DataSet())
    expect(out.projects!.map((p) => p.groupBy)).toEqual(['deadline', 'deadline', 'status'])
    expect(out.settings!.find((r) => r.key === 'defaultProjectGroupBy')?.value).toBe('deadline')
  })

  it('removes the seeded status pointer and the scheduled theme colors; keeps the status row', () => {
    const input = v52DataSet()
    input.settings!.push({ key: 'quickStatusId', value: '1' })
    const out = upgradeV53(input)
    const keys = out.settings!.map((r) => r.key)
    expect(keys).not.toContain('seededFollowupStatusId')
    expect(keys).not.toContain('color.dark.scheduled')
    expect(keys).not.toContain('color.light.scheduled')
    expect(keys).toContain('color.dark.deadline')
    expect(out.settings!.find((r) => r.key === 'quickStatusId')?.value).toBe('1')
    expect(out.statuses).toBe(input.statuses)
  })

  it('keeps the effective quick status when the user never picked one (it fell back to the seeded status)', () => {
    const out = upgradeV53(v52DataSet())
    expect(out.settings!.find((r) => r.key === 'quickStatusId')?.value).toBe('2')

    // Seeded status deleted → nothing to fall back to, no quick status written.
    const input = v52DataSet()
    input.statuses = input.statuses!.filter((s) => s.id !== 2)
    expect(upgradeV53(input).settings!.some((r) => r.key === 'quickStatusId')).toBe(false)
  })

  it('resolves fuzzy windows with the stored week start', () => {
    const setAt = new Date(2026, 8, 10, 9, 30) // Thursday
    const value = { kind: 'fuzzy', token: 'this-week', setAt }
    expect(resolveStoredScheduled(value, CREATED, 1)?.day).toEqual(new Date(2026, 8, 13)) // Sunday
    expect(resolveStoredScheduled(value, CREATED, 0)?.day).toEqual(new Date(2026, 8, 12)) // Saturday
    expect(resolveStoredScheduled({ ...value, token: 'next-week' }, CREATED, 1)?.day).toEqual(new Date(2026, 8, 20))
    expect(resolveStoredScheduled({ ...value, token: 'today' }, CREATED, 1)?.day).toEqual(new Date(2026, 8, 10))
    expect(resolveStoredScheduled({ ...value, token: 'this-month' }, CREATED, 1)?.day).toEqual(new Date(2026, 8, 30))
    expect(resolveStoredScheduled({ ...value, token: 'next-month' }, CREATED, 1)?.day).toEqual(new Date(2026, 9, 31))
    // Month ends: Jan 31 + next-month → Feb 28 (non-leap) / Feb 29 (leap).
    expect(resolveStoredScheduled({ kind: 'fuzzy', token: 'next-month', setAt: new Date(2027, 0, 31) }, CREATED, 1)?.day)
      .toEqual(new Date(2027, 1, 28))
    expect(resolveStoredScheduled({ kind: 'fuzzy', token: 'next-month', setAt: new Date(2028, 0, 31) }, CREATED, 1)?.day)
      .toEqual(new Date(2028, 1, 29))
    // ISO-string values (unrevived rows) still resolve; junk resolves to nothing.
    expect(resolveStoredScheduled({ kind: 'date', value: '2026-10-05T12:00:00' }, CREATED, 1)?.day).toEqual(new Date(2026, 9, 5))
    expect(resolveStoredScheduled({ kind: 'fuzzy', token: 'someday', setAt }, CREATED, 1)).toBeNull()
    expect(resolveStoredScheduled('nope', CREATED, 1)).toBeNull()
  })

  it('uses a Sunday-first week when the settings say so', () => {
    const input = v52DataSet()
    input.settings = input.settings!.map((r) => (r.key === 'weekStartsOn' ? { ...r, value: '0' } : r))
    expect(byId(upgradeV53(input).todos, 2).nextFollowupAt).toEqual(new Date(2026, 8, 12))
  })

  it('keeps historical scheduled todoEvents', () => {
    const input = v52DataSet()
    expect(upgradeV53(input).todoEvents).toBe(input.todoEvents)
  })

  it('is idempotent and does not mutate its input', () => {
    const input = v52DataSet()
    const snapshot = JSON.stringify(input)
    const once = upgradeV53(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    const twice = upgradeV53(once)
    expect(twice).toEqual(once)
    expect(twice.todos).toBe(once.todos)
    expect(twice.listDefinitions).toBe(once.listDefinitions)
    expect(twice.projects).toBe(once.projects)
    expect(twice.settings).toBe(once.settings)
  })

  it('tolerates partial datasets (task archives) and malformed rows', () => {
    expect(upgradeV53({})).toEqual({})
    const archive = { todos: [todo(1, { scheduledDate: { kind: 'date', value: new Date(2026, 9, 12) } })] }
    expect(upgradeV53(archive).todos![0]!.nextFollowupAt).toEqual(new Date(2026, 9, 12))
    const odd = [null as never, 'junk' as never, { id: 9, scheduledDate: 'garbage' }]
    const out = upgradeV53({ todos: odd, listDefinitions: [null as never], settings: [null as never] })
    expect(out.todos![2]).toEqual({ id: 9 })
    expect(out.listDefinitions).toEqual([null])
    expect(out.settings).toEqual([null])
  })
})

/** The live-DB path: a v52 database opened by the current build. */
describe('v53 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function buildV52Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v52 = new Dexie(db.name)
    v52.version(52).stores(v52StoreSpecs())
    await v52.open()
    const data = v52DataSet()
    for (const [table, rows] of Object.entries(data)) await v52.table(table).bulkAdd(rows)
    v52.close()
  }

  it('rewrites todos, lists, projects and settings, and matches the import path', async () => {
    await buildV52Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const todos = await db.todos.orderBy('id').toArray()
    for (const t of todos) expect('scheduledDate' in t).toBe(false)
    expect(todos.find((t) => t.id === 1)!.nextFollowupAt).toEqual(new Date(2026, 9, 12))
    expect(todos.find((t) => t.id === 4)!.dueDate).toEqual(new Date(2026, 9, 5))
    const defs = await db.listDefinitions.orderBy('id').toArray()
    expect(defs.map((d) => d.sort)).toEqual(['deadline', 'deadline', 'deadline', 'followup'])
    expect(await db.settings.get('seededFollowupStatusId')).toBeUndefined()

    // A JSON copy of the same v52 data upgrades to the same rows.
    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 52, ...v52DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect([...prepared.data.todos].sort((a, b) => a.id! - b.id!)).toEqual(todos)
    expect([...prepared.data.listDefinitions].sort((a, b) => a.id! - b.id!)).toEqual(defs)
    expect([...prepared.data.projects].sort((a, b) => a.id! - b.id!)).toEqual(await db.projects.orderBy('id').toArray())
    const settings = await db.settings.orderBy('key').toArray()
    expect([...prepared.data.settings].sort((a, b) => a.key.localeCompare(b.key))).toEqual(settings)
  })
})
