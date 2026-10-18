import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV64 } from '../../data/upgrades/v64-date-filters-and-caps'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { pickPredicate } from '../../data/predicate-shape'
import { validateImportData } from '../../data/import-validation'
import { runAppendImport } from '../../services/append-import'
import { predicateToCriteria } from '../../utils/filter-criteria'
import { makeTodo, matchesFilterNow, resetDb, v63StoreSpecs } from '../helpers'

/** A predicate as v63 stored it: one range on one date type, two presence filters. */
const OLD = {
  showCompleted: false, personIds: null, statusIds: null, searchText: '', dateField: 'deadline',
  dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: null, hasFollowup: null,
  markers: null, tags: null,
}

const OCT_1 = { kind: 'fixed', iso: new Date(2026, 9, 1).toISOString() }
const OCT_31 = { kind: 'fixed', iso: new Date(2026, 9, 31).toISOString() }
const OCT = { dateRangeStart: OCT_1, dateRangeEnd: OCT_31 }
const OCT_RANGE = { match: 'range', start: OCT_1, end: OCT_31 }

const list = (id: number, predicate: DataRow, extra: DataRow = {}): DataRow => ({
  id, name: `List ${id}`, sortOrder: id, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate }, ...extra,
})

/** The `dates` map v64 makes of an old predicate (through the whole transform). */
function datesOf(patch: DataRow): unknown {
  const out = upgradeV64({ listDefinitions: [list(1, { ...OLD, ...patch })] })
  return ((out.listDefinitions![0]!.membership as DataRow).predicate as DataRow).dates
}

describe('upgradeV64 (pure): the date filters', () => {
  it('is the v64 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(64)
    expect(SCHEMA_UPGRADES.get(64)).toBe(upgradeV64)
  })

  it('a predicate without date filters gets an empty map, and none of the old keys', () => {
    const out = upgradeV64({ listDefinitions: [list(1, OLD)] })
    const predicate = (out.listDefinitions![0]!.membership as DataRow).predicate
    expect(predicate).toEqual({ showCompleted: false, personIds: null, statusIds: null, searchText: '', markers: null, tags: null, dates: {} })
  })

  it.each([
    ['deadline', { ...OCT }, { deadline: OCT_RANGE }],
    ['followup', { ...OCT, dateField: 'followup' }, { followup: OCT_RANGE }],
    ['created', { dateRangeStart: OCT_1, dateField: 'created' }, { created: { match: 'range', start: OCT_1, end: null } }],
    ['modified', { dateRangeEnd: OCT_31, dateField: 'modified' }, { modified: { match: 'range', start: null, end: OCT_31 } }],
  ])('a range on the %s date becomes that type’s clause', (_field, patch, dates) => {
    expect(datesOf(patch)).toEqual(dates)
  })

  it('no dateField means the due date', () => {
    const p: DataRow = { ...OLD, ...OCT }
    delete p.dateField
    const out = upgradeV64({ listDefinitions: [list(1, p)] })
    expect(((out.listDefinitions![0]!.membership as DataRow).predicate as DataRow).dates).toEqual({ deadline: OCT_RANGE })
  })

  it('"include no date" carries over on the due date only (it never applied to another date)', () => {
    expect(datesOf({ ...OCT, dateRangeIncludeNoDate: true })).toEqual({ deadline: { ...OCT_RANGE, includeNoDate: true } })
    expect(datesOf({ ...OCT, dateField: 'followup', dateRangeIncludeNoDate: true })).toEqual({ followup: OCT_RANGE })
    expect(datesOf({ ...OCT, dateField: 'created', dateRangeIncludeNoDate: true })).toEqual({ created: OCT_RANGE })
    // Alone, it filtered nothing.
    expect(datesOf({ dateRangeIncludeNoDate: true })).toEqual({})
  })

  it.each([
    ['Has due date: yes, no range', { hasDeadline: true }, { deadline: { match: 'set' } }],
    ['Has due date: no, no range', { hasDeadline: false }, { deadline: { match: 'unset' } }],
    ['a due range + has due date', { ...OCT, hasDeadline: true }, { deadline: OCT_RANGE }],
    ['a due range with no date + has due date (= the range)', { ...OCT, dateRangeIncludeNoDate: true, hasDeadline: true }, { deadline: OCT_RANGE }],
    ['a due range with no date + no due date (= no date)', { ...OCT, dateRangeIncludeNoDate: true, hasDeadline: false }, { deadline: { match: 'unset' } }],
    ['Has follow-up: yes', { hasFollowup: true }, { followup: { match: 'set' } }],
    ['Has follow-up: no', { hasFollowup: false }, { followup: { match: 'unset' } }],
    ['a follow-up range + has follow-up', { ...OCT, dateField: 'followup', hasFollowup: true }, { followup: OCT_RANGE }],
    ['a created range + has due date: two clauses', { ...OCT, dateField: 'created', hasDeadline: true }, { deadline: { match: 'set' }, created: OCT_RANGE }],
    ['both presence filters', { hasDeadline: true, hasFollowup: false }, { deadline: { match: 'set' }, followup: { match: 'unset' } }],
    ['a due range + has follow-up', { ...OCT, hasFollowup: true }, { deadline: OCT_RANGE, followup: { match: 'set' } }],
  ])('%s', (_name, patch, dates) => {
    expect(datesOf(patch)).toEqual(dates)
  })

  it('a range that matched no task (range without no date ∧ no date) keeps the range and drops the presence filter', () => {
    expect(datesOf({ ...OCT, hasDeadline: false })).toEqual({ deadline: OCT_RANGE })
    // Follow-up: the old "include no date" never applied to it, so its range ∧ no follow-up matched nothing too.
    expect(datesOf({ ...OCT, dateField: 'followup', dateRangeIncludeNoDate: true, hasFollowup: false })).toEqual({ followup: OCT_RANGE })
  })

  it('a legacy ISO-string range end becomes a fixed anchor; a malformed one is carried for validation', () => {
    expect(datesOf({ dateRangeStart: '2026-10-01', dateRangeEnd: null })).toEqual({ deadline: { match: 'range', start: { kind: 'fixed', iso: '2026-10-01' }, end: null } })
    expect(datesOf({ dateRangeEnd: { kind: 'bogus' } })).toEqual({ deadline: { match: 'range', start: null, end: { kind: 'bogus' } } })
    // A presence value that isn't a boolean is no filter.
    expect(datesOf({ hasDeadline: 'no', hasFollowup: 0 })).toEqual({})
  })
})

describe('upgradeV64 (pure): the caps and the rest of the dataset', () => {
  function v63DataSet(): DataSet {
    return {
      listDefinitions: [
        list(1, { ...OLD, ...OCT }, { maxTasks: 10, limitMode: 'hard', runtimeFilter: { field: 'person' } }),
        list(2, OLD, { maxTasks: 25 }),
        list(3, OLD, { limitMode: 'scroll' }),
      ],
      settings: [
        { key: 'themeMode', value: 'dark' },
        { key: 'maxTags', value: '3' },
        { key: 'weekStartsOn', value: '1' },
      ],
      todos: [{ id: 1 }],
    }
  }

  it('drops maxTasks / limitMode from every list and the maxTags setting; keeps everything else, untouched tables by reference', () => {
    const input = v63DataSet()
    const out = upgradeV64(input)
    expect(out.listDefinitions!.map((d) => Object.keys(d).sort())).toEqual([
      ['grouping', 'id', 'membership', 'name', 'runtimeFilter', 'sort', 'sortOrder'],
      ['grouping', 'id', 'membership', 'name', 'sort', 'sortOrder'],
      ['grouping', 'id', 'membership', 'name', 'sort', 'sortOrder'],
    ])
    expect(out.settings).toEqual([{ key: 'themeMode', value: 'dark' }, { key: 'weekStartsOn', value: '1' }])
    expect(out.todos).toBe(input.todos)
  })

  it('the result passes import validation with no warning', () => {
    const result = validateImportData({ ...upgradeV64(v63DataSet()), todos: [] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([])
  })

  it('is idempotent, does not mutate its input, and tolerates missing tables and malformed rows', () => {
    const input = v63DataSet()
    const copy = JSON.parse(JSON.stringify(input)) as DataSet
    const once = upgradeV64(input)
    expect(input).toEqual(copy)
    expect(upgradeV64(once)).toBe(once)
    const archive: DataSet = { todos: [{ id: 1 }], todoPeople: [] }
    expect(upgradeV64(archive)).toBe(archive)
    const junk: DataSet = {
      listDefinitions: [null as never, 'x' as never, { id: 1, name: 'No membership' }, { id: 2, membership: { kind: 'custom', predicate: 'x' } }],
      settings: [null as never, { key: 7, value: '3' }, { value: '3' }],
    }
    expect(upgradeV64(junk)).toBe(junk)
  })

  it('a predicate already holding `dates` is left as it is', () => {
    const v64 = list(1, { ...OLD, dates: { followup: { match: 'set' } } })
    const input: DataSet = { listDefinitions: [v64] }
    expect(upgradeV64(input)).toBe(input)
  })
})

describe('an upgraded list keeps its members', () => {
  // Today: Wed 14 Oct 2026.
  const today = new Date(2026, 9, 14)
  const created = new Date(2026, 9, 2)
  const tasks = [
    makeTodo({ id: 1, dueDate: new Date(2026, 9, 5), nextFollowupAt: new Date(2026, 9, 6), createdAt: created }),
    makeTodo({ id: 2, dueDate: new Date(2026, 10, 20), createdAt: created }),
    makeTodo({ id: 3, nextFollowupAt: new Date(2026, 9, 7), createdAt: created }),
    makeTodo({ id: 4, createdAt: new Date(2026, 8, 20) }),
  ]
  function members(old: DataRow): number[] {
    const out = upgradeV64({ listDefinitions: [list(1, { ...OLD, ...old })] })
    const { predicate, fixes } = pickPredicate((out.listDefinitions![0]!.membership as DataRow).predicate)
    expect(fixes).toEqual([])
    const criteria = predicateToCriteria(predicate)
    return tasks.filter((t) => matchesFilterNow(criteria, t, undefined, today)).map((t) => t.id)
  }

  // The members the old single-range evaluator gave each predicate.
  it.each([
    ['a due range', { ...OCT }, [1]],
    ['a due range + no due date', { ...OCT, dateRangeIncludeNoDate: true }, [1, 3, 4]],
    ['a due range + has due date', { ...OCT, hasDeadline: true }, [1]],
    ['a due range with no date + has due date', { ...OCT, dateRangeIncludeNoDate: true, hasDeadline: true }, [1]],
    ['a due range with no date + no due date', { ...OCT, dateRangeIncludeNoDate: true, hasDeadline: false }, [3, 4]],
    ['has due date', { hasDeadline: true }, [1, 2]],
    ['no due date', { hasDeadline: false }, [3, 4]],
    ['a follow-up range ("include no date" inert)', { ...OCT, dateField: 'followup', dateRangeIncludeNoDate: true }, [1, 3]],
    ['a follow-up range + has follow-up', { ...OCT, dateField: 'followup', hasFollowup: true }, [1, 3]],
    ['a created range + has due date', { ...OCT, dateField: 'created', hasDeadline: true }, [1, 2]],
    ['has due date, no follow-up', { hasDeadline: true, hasFollowup: false }, [2]],
  ])('%s', (_name, old, ids) => {
    expect(members(old)).toEqual(ids)
  })

  it('the range that matched no task now shows the range’s tasks (the presence filter is dropped)', () => {
    expect(members({ ...OCT, hasDeadline: false })).toEqual([1])
  })
})

describe('a v63 file imports into the current build', () => {
  const v63File = () => JSON.stringify({
    __schemaVersion: 63,
    todos: [makeTodo({ id: 1, title: 'Kept' })],
    listDefinitions: [list(1, { ...OLD, ...OCT, hasFollowup: true }, { maxTasks: 5, limitMode: 'hard' })],
    settings: [{ key: 'maxTags', value: '3' }, { key: 'themeMode', value: 'dark' }],
  })

  beforeEach(async () => {
    await resetDb()
  })

  it('prepareImport upgrades it: date filters per type, no caps, no maxTags, no warnings', () => {
    const prepared = prepareImportText(v63File())
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(63)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions).toEqual([{
      id: 1, name: 'List 1', sortOrder: 1, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', markers: null, tags: null, dates: { deadline: OCT_RANGE, followup: { match: 'set' } } } },
    }])
    expect(prepared.data.settings).toEqual([{ key: 'themeMode', value: 'dark' }])
  })

  it('a malformed range end in a v63 list is dropped with a warning, not a failure', () => {
    const prepared = prepareImport({
      __schemaVersion: 63, todos: [], settings: [],
      listDefinitions: [list(1, { ...OLD, dateRangeEnd: { kind: 'relative', token: 'someday' }, hasFollowup: true })],
    })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions[0]!.membership.predicate.dates).toEqual({ followup: { match: 'set' } })
    expect(prepared.warnings.join('\n')).toContain('due date filter dropped')
  })

  it('a v64 file in the old single-range shape is refused (only an older file is upgraded)', () => {
    const prepared = prepareImport({ __schemaVersion: 64, todos: [], settings: [], listDefinitions: [list(1, OLD)] })
    expect(prepared.ok).toBe(false)
  })

  it('a v63 task archive (no lists, no settings) appends unchanged', async () => {
    const archive = JSON.stringify({ __schemaVersion: 63, kind: 'task-archive', todos: [makeTodo({ id: 1, uid: 'archived-1', title: 'Archived' })] })
    const prepared = prepareImportText(archive, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.kind).toBe('task-archive')
    expect(await runAppendImport(prepared.data, new Map())).toMatchObject({ status: 'done' })
    expect((await db.todos.toArray()).map((t) => t.title)).toEqual(['Archived'])
  })
})

/** The live-DB path: a v63 database opened by the current build. */
describe('v64 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  const v63Rows = (): DataSet => ({
    listDefinitions: [
      list(1, { ...OLD, ...OCT, dateRangeIncludeNoDate: true, hasDeadline: false }, { maxTasks: 10, limitMode: 'scroll' }),
      list(2, { ...OLD, dateField: 'created', dateRangeStart: { kind: 'relative', token: 'start-of-month' }, hasFollowup: true }),
    ],
    settings: [{ key: 'maxTags', value: '3' }, { key: 'weekStartsOn', value: '1' }],
  })

  it('rewrites the stored lists and settings exactly as the import path does', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v63 = new Dexie(db.name)
    v63.version(63).stores(v63StoreSpecs())
    await v63.open()
    for (const [table, rows] of Object.entries(v63Rows())) await v63.table(table).bulkAdd(rows)
    v63.close()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const lists = await db.listDefinitions.orderBy('id').toArray()
    expect(lists.map((d) => d.membership.predicate.dates)).toEqual([
      { deadline: { match: 'unset' } },
      { followup: { match: 'set' }, created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null } },
    ])
    expect(lists.some((d) => 'maxTasks' in d || 'limitMode' in d)).toBe(false)
    expect(await db.settings.get('maxTags')).toBeUndefined()

    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 63, todos: [], ...v63Rows() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions).toEqual(lists)
    expect(prepared.data.settings).toEqual(await db.settings.toArray())
  })
})
