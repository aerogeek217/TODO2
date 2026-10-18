import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV55, MIGRATED_ORG_COLOR } from '../../data/upgrades/v55-merge-orgs-into-people'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { resetDb, v54StoreSpecs } from '../helpers'

function predicate(extra: DataRow = {}): DataRow {
  return {
    showCompleted: false,
    personIds: null, personFilterMode: 'include-orgs', orgIds: null, orgFilterMode: 'include-people',
    projectIds: null, statusIds: null, searchText: '',
    dateField: 'deadline', dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false,
    hasDeadline: null, hasFollowup: null, tags: null,
    ...extra,
  }
}

function listDef(id: number, pred: DataRow, extra: DataRow = {}): DataRow {
  return {
    id, name: `List ${id}`, sortOrder: id, pinnedToDashboard: true, favorited: false,
    membership: { kind: 'custom', predicate: predicate(pred) },
    sort: 'manual', grouping: 'none',
    ...extra,
  }
}

const RAILS = JSON.stringify({
  left: {
    orientation: 'vertical',
    slots: [{
      id: 's1', activeTabId: 't1',
      tabs: [
        { id: 't1', type: 'lens', listDefinitionId: 5, runtimeFilterValue: [1, 2, 99] },
        { id: 't2', type: 'lens', listDefinitionId: 1, runtimeFilterValue: [1] },
      ],
    }],
  },
  right: null, top: null, bottom: null,
})

function v54DataSet(): DataSet {
  const created = new Date(2026, 8, 1, 9, 0)
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: created }],
    people: [
      { id: 1, name: 'Ann Lee', initials: 'AL' },
      { id: 2, name: 'Bob Stone', initials: 'BS' },
      // Already exists under the merged name: reused.
      { id: 7, name: 'org: initech', initials: 'IN' },
    ],
    orgs: [
      { id: 1, name: 'Acme', initials: 'AC', color: '#e05050' },
      { id: 2, name: 'Globex' },
      { id: 3, name: ' Initech ', color: '#00aa00' },
    ],
    personOrgs: [
      { id: 1, personId: 1, orgId: 2 }, // Globex has no color — skipped
      { id: 2, personId: 1, orgId: 1 }, // first org with a color → Ann is red
      { id: 3, personId: 2, orgId: 2 },
    ],
    todos: [
      { id: 1, uid: 'u1', title: 'One', isCompleted: false, createdAt: created, modifiedAt: created, sortOrder: 1 },
      { id: 2, uid: 'u2', title: 'Two', isCompleted: false, createdAt: created, modifiedAt: created, sortOrder: 2 },
    ],
    todoPeople: [{ id: 4, todoId: 1, personId: 7 }],
    todoOrgs: [
      { id: 1, todoId: 1, orgId: 3 }, // same person as the existing assignment → deduped
      { id: 2, todoId: 1, orgId: 1 },
      { id: 3, todoId: 2, orgId: 2 },
      { id: 4, todoId: 2, orgId: 99 }, // dangling org → dropped
      { id: 5, todoId: 42, orgId: 1 }, // dangling task → dropped
    ],
    listDefinitions: [
      listDef(1, {}),
      listDef(2, { orgIds: [1, 0], orgFilterMode: 'direct-only' }),
      listDef(3, { personIds: [2], orgIds: [2, 1], personFilterMode: 'direct-only' }),
      listDef(4, { personIds: [], orgIds: [1] }),
      listDef(5, {}, { sort: 'org', grouping: 'org', runtimeFilter: { field: 'org', label: 'Client' } }),
      listDef(6, { personIds: [1], orgIds: [] }),
      listDef(7, { orgIds: [99] }),
    ],
    listInsets: [
      { id: 1, listDefinitionId: 5, canvasId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false, runtimeFilterValue: [3] },
      { id: 2, listDefinitionId: 5, canvasId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false, runtimeFilterValue: [99] },
      { id: 3, listDefinitionId: 1, canvasId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false, runtimeFilterValue: [1] },
    ],
    projects: [
      { id: 1, name: 'Work', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: created, groupBy: 'org' },
      { id: 2, name: 'Home', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: created, groupBy: 'status' },
    ],
    settings: [
      { key: 'defaultProjectGroupBy', value: 'org' },
      { key: 'canvasRails', value: RAILS },
      { key: 'themeMode', value: 'dark' },
    ],
  }
}

function byId(rows: DataRow[] | undefined, id: number): DataRow {
  const row = rows?.find((r) => r.id === id)
  if (!row) throw new Error(`row ${id} missing`)
  return row
}

function predicateOf(row: DataRow): DataRow {
  return (row.membership as { predicate: DataRow }).predicate
}

describe('upgradeV55 (pure transform)', () => {
  it('is the v55 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(55)
    expect(SCHEMA_UPGRADES.get(55)).toBe(upgradeV55)
  })

  it('drops the org tables', () => {
    const out = upgradeV55(v54DataSet())
    for (const t of ['orgs', 'todoOrgs', 'personOrgs']) expect(t in out, t).toBe(false)
  })

  it('turns each org into an Org: person (orange, initials kept or generated), reusing a same-named person', () => {
    const out = upgradeV55(v54DataSet())
    expect(out.people).toEqual([
      { id: 1, name: 'Ann Lee', initials: 'AL', color: '#e05050' },
      { id: 2, name: 'Bob Stone', initials: 'BS' },
      { id: 7, name: 'org: initech', initials: 'IN', color: MIGRATED_ORG_COLOR },
      { id: 8, name: 'Org: Acme', initials: 'AC', color: MIGRATED_ORG_COLOR },
      { id: 9, name: 'Org: Globex', initials: 'G', color: MIGRATED_ORG_COLOR },
    ])
    expect(MIGRATED_ORG_COLOR).toBe('#f28c4e')
  })

  it('a reused person keeps a color of its own', () => {
    const data = v54DataSet()
    data.people = [{ id: 7, name: 'Org: Initech', initials: 'IN', color: '#123456' }]
    data.personOrgs = []
    const out = upgradeV55(data)
    expect(byId(out.people, 7).color).toBe('#123456')
  })

  it('two orgs with the same name become one person', () => {
    const out = upgradeV55({
      people: [],
      orgs: [{ id: 1, name: 'Acme' }, { id: 2, name: 'ACME' }],
      todoOrgs: [{ id: 1, todoId: 1, orgId: 1 }, { id: 2, todoId: 1, orgId: 2 }],
    })
    expect(out.people).toEqual([{ id: 1, name: 'Org: Acme', initials: 'A', color: MIGRATED_ORG_COLOR }])
    expect(out.todoPeople).toEqual([{ id: 1, todoId: 1, personId: 1 }])
  })

  it('org assignments become person assignments: deduped, dangling rows dropped, explicit ids', () => {
    const out = upgradeV55(v54DataSet())
    expect(out.todoPeople).toEqual([
      { id: 4, todoId: 1, personId: 7 },
      { id: 5, todoId: 1, personId: 8 },
      { id: 6, todoId: 2, personId: 9 },
    ])
  })

  it('folds the org filter into the person filter (union) and drops both filter modes', () => {
    const out = upgradeV55(v54DataSet())
    const p = (id: number) => predicateOf(byId(out.listDefinitions, id))
    for (const def of out.listDefinitions!) {
      for (const key of ['orgIds', 'orgFilterMode', 'personFilterMode']) {
        expect(key in predicateOf(def), `list ${String(def.id)} ${key}`).toBe(false)
      }
    }
    expect(p(1).personIds).toBeNull() // null + null
    expect(p(2).personIds).toEqual([8, 0]) // null + orgs: "no org" → unassigned
    expect(p(3).personIds).toEqual([2, 9, 8]) // union, deduped
    expect(p(4).personIds).toEqual([]) // empty person filter matched nothing; still does
    expect(p(6).personIds).toEqual([]) // empty org filter matched nothing; still does
    expect(p(7).personIds).toEqual([]) // only a missing org: matched nothing; still does
  })

  it('rewrites org sort / group / runtime filter on list definitions and remaps stored picks', () => {
    const out = upgradeV55(v54DataSet())
    expect(byId(out.listDefinitions, 5)).toMatchObject({
      sort: 'people', grouping: 'people', runtimeFilter: { field: 'person', label: 'Client' },
    })
    expect(byId(out.listInsets, 1).runtimeFilterValue).toEqual([7])
    expect('runtimeFilterValue' in byId(out.listInsets, 2)).toBe(false) // nothing left to pick
    expect(byId(out.listInsets, 3).runtimeFilterValue).toEqual([1]) // a person list: untouched
    const rails = JSON.parse(String(out.settings!.find((s) => s.key === 'canvasRails')!.value))
    expect(rails.left.slots[0].tabs[0].runtimeFilterValue).toEqual([8, 9])
    expect(rails.left.slots[0].tabs[1].runtimeFilterValue).toEqual([1])
  })

  it('rewrites the org axis on projects and defaultProjectGroupBy', () => {
    const data = v54DataSet()
    const out = upgradeV55(data)
    expect(byId(out.projects, 1).groupBy).toBe('people')
    expect(byId(out.projects, 2)).toBe(byId(data.projects, 2))
    expect(out.settings!.find((s) => s.key === 'defaultProjectGroupBy')?.value).toBe('people')
    expect(out.settings!.find((s) => s.key === 'themeMode')).toBe(data.settings!.find((s) => s.key === 'themeMode'))
  })

  it('leaves untouched tables as the same array', () => {
    const input = v54DataSet()
    const out = upgradeV55(input)
    expect(out.todos).toBe(input.todos)
    expect(out.canvases).toBe(input.canvases)
  })

  it('is idempotent', () => {
    const once = upgradeV55(v54DataSet())
    const twice = upgradeV55(once)
    for (const table of Object.keys(once)) expect(twice[table], table).toBe(once[table])
  })

  it('tolerates missing tables, partial archives and malformed rows', () => {
    expect(upgradeV55({})).toEqual({})
    // A task archive: tasks, joins and only the referenced entities.
    const archive: DataSet = {
      todos: [{ id: 3, uid: 'a', title: 'T' }],
      people: [{ id: 2, name: 'Bob', initials: 'B' }],
      todoPeople: [{ id: 1, todoId: 3, personId: 2 }],
      orgs: [{ id: 5, name: 'Acme' }],
      todoOrgs: [{ id: 1, todoId: 3, orgId: 5 }],
    }
    const out = upgradeV55(archive)
    expect(out.people).toEqual([
      { id: 2, name: 'Bob', initials: 'B' },
      { id: 3, name: 'Org: Acme', initials: 'A', color: MIGRATED_ORG_COLOR },
    ])
    expect(out.todoPeople).toEqual([{ id: 1, todoId: 3, personId: 2 }, { id: 2, todoId: 3, personId: 3 }])
    expect('listDefinitions' in out).toBe(false)
    expect('settings' in out).toBe(false)

    const odd = upgradeV55({
      people: [null as never],
      orgs: [null as never, { id: 'x' }, { id: 4 }],
      todoOrgs: [null as never, { todoId: 1 }],
      listDefinitions: [null as never, { id: 9 }, { id: 10, membership: { kind: 'custom', predicate: null } }],
    })
    expect(odd.people).toEqual([null])
    expect(odd.todoPeople).toBeUndefined()
  })
})

/** The live-DB path: a v54 database opened by the current build. */
describe('v55 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function buildV54Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v54 = new Dexie(db.name)
    v54.version(54).stores(v54StoreSpecs())
    await v54.open()
    for (const [table, rows] of Object.entries(v54DataSet())) await v54.table(table).bulkAdd(rows)
    v54.close()
  }

  it('merges orgs into people, drops the org stores, and matches the import path', async () => {
    await buildV54Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const storeNames = Array.from(db.backendDB().objectStoreNames)
    for (const t of ['orgs', 'todoOrgs', 'personOrgs']) expect(storeNames, t).not.toContain(t)

    const people = await db.people.orderBy('id').toArray()
    expect(people.map((p) => p.name)).toEqual(['Ann Lee', 'Bob Stone', 'org: initech', 'Org: Acme', 'Org: Globex'])
    const todoPeople = await db.todoPeople.orderBy('id').toArray()
    const defs = await db.listDefinitions.orderBy('id').toArray()
    // The insets / rails whose org picks v55 rewrites are gone since v60 (the
    // pure transform tests cover them); the layout v56 made from them stays.
    const layouts = await db.layouts.orderBy('id').toArray()

    // A JSON copy of the same v54 data (an export carries the empty
    // taskboards table) upgrades to the same rows.
    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 54, taskboards: [], ...v54DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect([...prepared.data.people].sort((a, b) => a.id! - b.id!)).toEqual(people)
    expect([...prepared.data.todoPeople].sort((a, b) => a.id! - b.id!)).toEqual(todoPeople)
    expect([...prepared.data.listDefinitions].sort((a, b) => a.id! - b.id!)).toEqual(defs)
    expect(prepared.data.layouts.map((l) => l.columns)).toEqual(layouts.map((l) => l.columns))
    expect('orgs' in prepared.data).toBe(false)
  })
})
