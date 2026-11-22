import { describe, it, expect, afterEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV87 } from '../../data/upgrades/v87'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyPredicate, type ListDefinition } from '../../models'
import { resetDb } from '../helpers'

/**
 * v87 — a version marker for the planned date in filters, sorts and groups
 * (a `planned` date clause, its `held`, a list sorted or grouped by
 * `planned`): no row changes, the stamp alone makes a v86 build refuse the
 * data. The transform's own tests, then the pipeline.
 */

const CREATED = '2026-10-01T09:00:00.000Z'
const MODIFIED = '2026-11-02T09:00:00.000Z'

/** A task as a v86 build wrote it: a planned day, and one held in Unplanned. */
const v86Tasks = (): DataRow[] => [
  { id: 1, uid: 'u1', title: 'Draft the plan', isCompleted: false, sortOrder: 0, createdAt: CREATED, modifiedAt: MODIFIED, doDate: '2026-11-20T06:00:00.000Z' },
  { id: 2, uid: 'u2', title: 'Call the vendor', isCompleted: false, sortOrder: 1, createdAt: CREATED, modifiedAt: MODIFIED, nextFollowupAt: '2026-11-23T06:00:00.000Z', unplanned: true },
]

/** A v86 list: due-date filter, sorted and grouped by due. */
const v86List = (): DataRow => ({
  id: 1, name: 'Due soon', sortOrder: 0,
  membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { deadline: { match: 'set' } } } },
  sort: 'deadline', grouping: 'deadline',
})

describe('upgradeV87 (pure): a version marker, no data change', () => {
  it('is the current schema’s registry entry, after v86', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(87)
    expect(SCHEMA_UPGRADES.get(87)).toBe(upgradeV87)
  })

  it('returns the input itself — also for malformed rows and missing tables', () => {
    const data: DataSet = { todos: v86Tasks(), listDefinitions: [v86List(), { sort: 5 }], settings: [] }
    expect(upgradeV87(data)).toBe(data)
    expect(upgradeV87({})).toEqual({})
    expect(upgradeDataSet(data, 86, 87)).toBe(data)
  })
})

describe('v87 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v86 file imports as an upgraded file, its tasks and lists as they were', () => {
    const file = { [SCHEMA_VERSION_KEY]: 86, todos: v86Tasks(), listDefinitions: [v86List()], settings: [] }
    const prepared = prepareImport(JSON.parse(JSON.stringify(file)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(86)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.todos.map((t) => [t.doDate, t.unplanned])).toEqual([[new Date('2026-11-20T06:00:00.000Z'), undefined], [undefined, true]])
    const [list] = prepared.data.listDefinitions
    expect(list?.sort).toBe('deadline')
    expect(list?.membership).toEqual({ kind: 'custom', predicate: { ...emptyPredicate(), dates: { deadline: { match: 'set' } } } })
  })

  it('an export holding a planned filter, sort and group is stamped v87 or later, and a restore puts them back', async () => {
    const graphical: ListDefinition = {
      name: 'Planned this week', sortOrder: 0,
      membership: {
        kind: 'custom',
        predicate: { ...emptyPredicate(), dates: { planned: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'offset', days: 7 }, includeNoDate: true } } },
      },
      sort: 'planned', sortDirection: 'desc', grouping: 'planned',
    }
    const typed: ListDefinition = {
      name: 'Held or not planned', sortOrder: 1,
      membership: {
        kind: 'custom',
        predicate: { ...emptyPredicate(), expression: { kind: 'or', items: [{ kind: 'date', field: 'planned', match: { match: 'held' } }, { kind: 'not', item: { kind: 'date', field: 'planned', match: { match: 'set' } } }] } },
      },
      sort: 'planned', grouping: 'none',
    }
    await db.listDefinitions.bulkAdd([graphical, typed])
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(86)
    const before = await db.listDefinitions.toArray()

    await resetDb()
    const prepared = prepareImport(JSON.parse(JSON.stringify(exported)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(false)
    expect(prepared.warnings).toEqual([])
    await restoreFromImportData(prepared.data)
    expect(await db.listDefinitions.toArray()).toEqual(before)
  })

  it('a `held` clause on any type but Planned is dropped with a fix', () => {
    const bad = { ...v86List(), membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { deadline: { match: 'held' } } } } }
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 87, todos: [], listDefinitions: [bad], settings: [] })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    const [list] = prepared.data.listDefinitions
    expect(list?.membership).toEqual({ kind: 'custom', predicate: emptyPredicate() })
    expect(prepared.warnings.join(' ')).toContain('due date filter dropped')
  })
})
