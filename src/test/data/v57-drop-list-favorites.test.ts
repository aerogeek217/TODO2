import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV57 } from '../../data/upgrades/v57-drop-list-favorites'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { resetDb, v56StoreSpecs } from '../helpers'

const CREATED = new Date('2026-09-01T09:00:00.000Z')

function predicate(): DataRow {
  return {
    showCompleted: false, personIds: null, projectIds: null, statusIds: null, searchText: '',
    dateField: 'deadline', dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
    hasDeadline: null, hasFollowup: null, tags: null,
  }
}

function listDef(id: number, extra: DataRow = {}): DataRow {
  return {
    id, name: `List ${id}`, sortOrder: id, pinnedToDashboard: false,
    membership: { kind: 'custom', predicate: predicate() },
    sort: 'manual', grouping: 'none', ...extra,
  }
}

function layout(): DataRow {
  return {
    id: 1, name: 'Default', createdAt: CREATED, modifiedAt: CREATED,
    columns: [
      {
        id: 'c1', weight: 1,
        cells: [
          {
            id: 'k1', weight: 1, activeTabId: 'picked',
            tabs: [
              { id: 'picked', kind: 'lens', config: { listDefinitionId: 2 }, viewState: { runtimeFilterValue: [3, 4] } },
              { id: 'plain', kind: 'lens', config: { listDefinitionId: 1 } },
              { id: 'cal', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', offset: 2 } },
            ],
          },
        ],
      },
      { id: 'c2', weight: 1, cells: [{ id: 'k2', weight: 1, tabs: [{ id: 'notes', kind: 'notes', config: {} }] }] },
    ],
  }
}

function v56DataSet(): DataSet {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: CREATED }],
    listDefinitions: [
      listDef(1, { favorited: true }),
      listDef(2, { favorited: false, runtimeFilter: { field: 'person' } }),
      listDef(3),
    ],
    layouts: [layout()],
    // The canvas keeps its own picks.
    listInsets: [{ id: 1, listDefinitionId: 2, canvasId: 1, x: 0, y: 0, width: 300, height: 200, isCollapsed: false, runtimeFilterValue: [3] }],
    settings: [{ key: 'activeLayoutId', value: '1' }],
  }
}

type Tab = { id: string; viewState?: DataRow }

function tabsOf(out: DataSet): Tab[] {
  const cols = (out.layouts?.[0]?.columns ?? []) as Array<{ cells: Array<{ tabs: Tab[] }> }>
  return cols.flatMap((c) => c.cells.flatMap((k) => k.tabs))
}

describe('upgradeV57 (pure)', () => {
  it('is the v57 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(57)
    expect(SCHEMA_UPGRADES.get(57)).toBe(upgradeV57)
  })

  it('strips favorited from every list definition and keeps the rest', () => {
    const input = v56DataSet()
    const out = upgradeV57(input)
    for (const def of out.listDefinitions!) expect('favorited' in def, `list ${String(def.id)}`).toBe(false)
    expect(out.listDefinitions![1]).toEqual({ ...listDef(2), runtimeFilter: { field: 'person' } })
    // A row without the flag is the same object.
    expect(out.listDefinitions![2]).toBe(input.listDefinitions![2])
  })

  it('drops saved prompt picks from list tabs, and an emptied viewState with them', () => {
    const input = v56DataSet()
    const out = upgradeV57(input)
    const tabs = tabsOf(out)
    expect(tabs.find((t) => t.id === 'picked')).toEqual({ id: 'picked', kind: 'lens', config: { listDefinitionId: 2 } })
    // Other tabs, cells and columns are untouched (same objects).
    const before = tabsOf(input)
    for (const id of ['plain', 'cal', 'notes']) {
      expect(tabs.find((t) => t.id === id)).toBe(before.find((t) => t.id === id))
    }
    const inCols = input.layouts![0]!.columns as unknown[]
    const outCols = out.layouts![0]!.columns as unknown[]
    expect(outCols[1]).toBe(inCols[1])
    expect(out.listInsets).toBe(input.listInsets)
    expect(out.settings).toBe(input.settings)
  })

  it('keeps other view state on a list tab', () => {
    const data: DataSet = {
      layouts: [{
        id: 1, name: 'L', createdAt: CREATED, modifiedAt: CREATED,
        columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [
          { id: 't', kind: 'lens', config: {}, viewState: { runtimeFilterValue: [1], other: true } },
        ] }] }],
      }],
    }
    expect(tabsOf(upgradeV57(data))[0]).toEqual({ id: 't', kind: 'lens', config: {}, viewState: { other: true } })
  })

  it('is idempotent and tolerates missing tables and malformed rows', () => {
    const once = upgradeV57(v56DataSet())
    const twice = upgradeV57(once)
    expect(twice.listDefinitions).toBe(once.listDefinitions)
    expect(twice.layouts).toBe(once.layouts)
    const archive: DataSet = { todos: [], todoPeople: [] }
    expect(upgradeV57(archive)).toEqual(archive)
    const junk: DataSet = { listDefinitions: [null as never, 'x' as never], layouts: [{ id: 1, columns: 'nope' }, null as never] }
    const out = upgradeV57(junk)
    expect(out.listDefinitions).toBe(junk.listDefinitions)
    expect(out.layouts).toBe(junk.layouts)
  })
})

/** The live-DB path: a v56 database opened by the current build. */
describe('v57 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('strips favorites and saved picks, matching the import path', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v56 = new Dexie(db.name)
    v56.version(56).stores(v56StoreSpecs())
    await v56.open()
    for (const [table, rows] of Object.entries(v56DataSet())) {
      if (rows.length > 0) await v56.table(table).bulkAdd(rows)
    }
    v56.close()

    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const defs = await db.listDefinitions.toArray()
    expect(defs.every((d) => !('favorited' in d))).toBe(true)
    const layouts = await db.layouts.toArray()
    expect(JSON.stringify(layouts)).not.toContain('runtimeFilterValue')
    expect((await db.listInsets.get(1))?.runtimeFilterValue).toEqual([3])

    // An export of the same data carries the empty taskboards table.
    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 56, taskboards: [], ...v56DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.layouts).toEqual(layouts)
    expect(prepared.data.listDefinitions).toEqual(defs)
  })
})
