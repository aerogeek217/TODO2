import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV67 } from '../../data/upgrades/v67-layout-order-and-eisenhower-list'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyPredicate } from '../../models/filter-predicate'
import { useSettingsStore } from '../../stores/settings-store'
import { resetDb, v66StoreSpecs } from '../helpers'

const AT = new Date('2026-10-01T09:00:00.000Z')
const LATER = new Date('2026-10-05T09:00:00.000Z')

const predicate = (extra: Record<string, unknown> = {}) => ({ ...emptyPredicate(), ...extra })
const list = (id: number, extra: Record<string, unknown> = {}): DataRow => ({
  id, name: `List ${id}`, sortOrder: id - 1, sort: 'deadline', grouping: 'people',
  membership: { kind: 'custom', predicate: predicate({ personIds: [1] }) }, ...extra,
})
const lens = (id: string, listDefinitionId?: number): DataRow =>
  ({ id, kind: 'lens', config: listDefinitionId !== undefined ? { listDefinitionId } : {} })
const eis = (id: string): DataRow => ({ id, kind: 'eisenhower', config: {} })
const dash = (id: string, listTiles: number[]): DataRow => ({ id, kind: 'dashboard', config: { tiles: [], listTiles, sections: [] } })
const cells = (...tabs: DataRow[][]) => [{ id: 'c1', weight: 1, cells: tabs.map((t, i) => ({ id: `k${i}`, weight: 1, tabs: t })) }]
const layout = (id: number, columns: unknown, extra: Record<string, unknown> = {}): DataRow =>
  ({ id, name: `L${id}`, createdAt: AT, modifiedAt: AT, columns, ...extra })
const source = (id: number): DataRow => ({ key: 'eisenhowerSource', value: `list:${id}` })

/** The list v67 makes for an Eisenhower on all tasks. */
const NEW_LIST = (id: number, sortOrder: number): DataRow => ({
  id, name: 'Eisenhower', sortOrder,
  membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
  owner: { eisenhower: true },
})

const OWNER = { eisenhower: true }

describe('upgradeV67 (pure): the layout order', () => {
  it('is the v67 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(67)
    expect(SCHEMA_UPGRADES.get(67)).toBe(upgradeV67)
  })

  it('numbers the layouts in the picker’s old order: by creation (a Date or a date text), then id; an unreadable date last', () => {
    const rows: DataRow[] = [
      layout(3, [], { createdAt: LATER }),
      layout(5, [], { createdAt: 'never' }),
      layout(2, [], { createdAt: LATER.toISOString() }),
      layout(4, []),
      layout(1, [], { createdAt: LATER }),
    ]
    const out = upgradeV67({ layouts: rows }).layouts!
    expect(out.map((l) => [l.id, l.sortOrder])).toEqual([[3, 3], [5, 4], [2, 2], [4, 0], [1, 1]])
    // Only the order is added.
    expect(out).toEqual(rows.map((row, i) => ({ ...row, sortOrder: out[i]!.sortOrder })))
  })

  it('keeps an order already there and numbers the rest after the highest', () => {
    const out = upgradeV67({ layouts: [layout(1, [], { sortOrder: 4 }), layout(2, []), layout(3, [], { createdAt: LATER })] }).layouts!
    expect(out.map((l) => l.sortOrder)).toEqual([4, 5, 6])
  })

  it('a kept layout draft (bodies only, no other table) only gets an order', () => {
    const data: DataSet = { layouts: [{ columns: cells([lens('a', 1)]) }, { columns: [] }] }
    const out = upgradeV67(data)
    expect(out).toEqual({ layouts: [{ columns: cells([lens('a', 1)]), sortOrder: 0 }, { columns: [], sortOrder: 1 }] })
  })
})

describe('upgradeV67 (pure): the Eisenhower’s own list', () => {
  it('a source list nothing else uses becomes the Eisenhower’s in place; nothing else changes', () => {
    const lists = [list(1), list(2)]
    const settings = [{ key: 'themeMode', value: 'dark' }, source(2)]
    const layouts = [layout(1, cells([lens('a', 1), eis('e')]), { sortOrder: 0 })]
    const orders = [{ id: 1, listDefinitionId: 2, todoId: 5, rank: 1 }]
    const data: DataSet = { listDefinitions: lists, settings, layouts, listOrders: orders }
    const out = upgradeV67(data)
    expect(out.listDefinitions).toEqual([list(1), { ...list(2), owner: OWNER }])
    expect(out.listDefinitions![0]).toBe(lists[0])
    expect(out.settings).toBe(settings)
    expect(out.layouts).toBe(layouts)
    expect(out.listOrders).toBe(orders)
  })

  it.each([
    ['a list tab in a cell', [layout(1, cells([lens('a', 2)]))], []],
    ['a list tab in the top band', [layout(1, [], { top: { id: 't', height: 120, tabs: [lens('a', 2)] } })], []],
    ['a list tab in the bottom band of another layout', [layout(1, []), layout(2, [], { bottom: { id: 'b', height: 120, tabs: [lens('a', 2)] } })], []],
    ['a dashboard list tile', [layout(1, cells([dash('d', [1, 2])]))], []],
    ['the check-in scope', [layout(1, [])], [{ key: 'checkinTaskScope', value: 'list:2' }]],
  ])('a source list that %s uses too: a copy (with its manual order) becomes the Eisenhower’s', (_what, layouts, extraSettings) => {
    const settings = [source(2), ...extraSettings]
    const orders = [
      { id: 1, listDefinitionId: 2, todoId: 5, rank: 1 },
      { id: 4, listDefinitionId: 1, todoId: 5, rank: 3 },
      { id: 2, listDefinitionId: 2, todoId: 6, rank: 2 },
    ]
    const out = upgradeV67({ listDefinitions: [list(1), list(2)], settings, layouts, listOrders: orders })
    expect(out.listDefinitions).toEqual([list(1), list(2), { ...list(2), id: 3, name: 'Eisenhower', sortOrder: 2, owner: OWNER }])
    expect(out.settings).toEqual([source(3), ...extraSettings])
    expect(out.listOrders).toEqual([
      ...orders,
      { id: 5, listDefinitionId: 3, todoId: 5, rank: 1 },
      { id: 6, listDefinitionId: 3, todoId: 6, rank: 2 },
    ])
    // The original stays a list without an owner (a saved list, at v67).
    expect(out.listDefinitions!.filter((d) => d.owner === undefined).map((d) => d.id)).toEqual([1, 2])
  })

  it.each([
    ['no source setting (all tasks)', []],
    ['the source `all`', [{ key: 'eisenhowerSource', value: 'all' }]],
    ['a deleted list', [source(9)]],
    ['a value that doesn’t read', [{ key: 'eisenhowerSource', value: 'list:x' }]],
  ])('%s: a new list with no filter, which the setting names (replaced where it was)', (_what, sourceRows) => {
    const settings = [...sourceRows, { key: 'themeMode', value: 'dark' }]
    const out = upgradeV67({ listDefinitions: [list(1), list(2)], settings, layouts: [layout(1, [], { sortOrder: 0 })] })
    const id = sourceRows.length > 0 && sourceRows[0]!.value === 'list:9' ? 10 : 3
    expect(out.listDefinitions).toEqual([list(1), list(2), NEW_LIST(id, 2)])
    expect(out.settings).toEqual(sourceRows.length > 0 ? [source(id), { key: 'themeMode', value: 'dark' }] : [{ key: 'themeMode', value: 'dark' }, source(id)])
  })

  it('a new id comes after every list id the dataset names, so a stale reference never starts naming it', () => {
    const out = upgradeV67({
      listDefinitions: [list(1)],
      settings: [{ key: 'checkinTaskScope', value: 'list:12' }],
      layouts: [layout(1, cells([lens('a', 20), dash('d', [15])]))],
      listOrders: [{ id: 1, listDefinitionId: 30, todoId: 1, rank: 1 }],
    })
    expect(out.listDefinitions!.at(-1)).toEqual(NEW_LIST(31, 1))
    expect(out.settings).toEqual([{ key: 'checkinTaskScope', value: 'list:12' }, source(31)])
  })

  it('past the safe ids (a huge id stored earlier) the new id is the smallest one free, and its source reads back', () => {
    for (const huge of [2 ** 53, 1e300, Number.MAX_SAFE_INTEGER]) {
      const out = upgradeV67({
        listDefinitions: [list(1), list(huge), list(3)],
        settings: [],
        layouts: [layout(1, cells([lens('a', 2)]))],
      })
      const made = out.listDefinitions!.at(-1)!
      expect(made.id).toBe(4)
      expect(new Set(out.listDefinitions!.map((d) => d.id)).size).toBe(4)
      expect(out.settings).toEqual([source(4)])
    }
  })

  it('a copy’s manual-order rows past the safe ids get the smallest free ids', () => {
    const out = upgradeV67({
      listDefinitions: [list(1)],
      settings: [source(1)],
      layouts: [layout(1, cells([lens('a', 1)]))],
      listOrders: [{ id: 2 ** 53, listDefinitionId: 1, todoId: 1, rank: 1 }, { id: 1, listDefinitionId: 1, todoId: 2, rank: 2 }],
    })
    const ids = out.listOrders!.map((r) => r.id)
    expect(new Set(ids).size).toBe(4)
    expect(ids.slice(2)).toEqual([2, 3])
  })

  it('the first list made: id 1, order 0', () => {
    expect(upgradeV67({ listDefinitions: [], settings: [] })).toEqual({ listDefinitions: [NEW_LIST(1, 0)], settings: [source(1)] })
  })

  it('without a settings or a lists table (a kept list draft, a task archive) no list is made', () => {
    const drafts: DataSet = { listDefinitions: [list(2), list(2)] }
    expect(upgradeV67(drafts)).toBe(drafts)
    const archive: DataSet = { todos: [], todoPeople: [] }
    expect(upgradeV67(archive)).toBe(archive)
    const settingsOnly: DataSet = { settings: [source(2)] }
    expect(upgradeV67(settingsOnly)).toBe(settingsOnly)
  })

  it('returns its input when nothing changes: v67 data, rows it can’t walk', () => {
    const v67: DataSet = { listDefinitions: [list(1), list(2, { owner: OWNER })], settings: [source(1)], layouts: [layout(1, [], { sortOrder: 0 })] }
    expect(upgradeV67(v67)).toBe(v67)
    const twice = upgradeV67({ listDefinitions: [list(1)], settings: [source(1)], layouts: [layout(1, cells([lens('a', 1)]))] })
    expect(upgradeV67(twice)).toBe(twice)
    const odd: DataSet = {
      listDefinitions: [null as unknown as DataRow, list(1, { owner: OWNER })],
      settings: ['x' as unknown as DataRow],
      layouts: [null as unknown as DataRow, 7 as unknown as DataRow, layout(1, 'x', { sortOrder: 0 })],
    }
    expect(upgradeV67(odd)).toBe(odd)
  })

  it('tolerates rows it can’t walk while making the list', () => {
    const out = upgradeV67({
      listDefinitions: [null as unknown as DataRow, list(1)],
      settings: ['x' as unknown as DataRow, source(1)],
      layouts: [{ id: 1, columns: [null, { cells: 'x' }, { cells: [{ tabs: [null, { kind: 'lens', config: null }, lens('a', 1)] }] }], top: 'x' }],
    })
    expect(out.listDefinitions!.at(-1)).toMatchObject({ id: 2, name: 'Eisenhower', owner: OWNER })
  })

  it('never changes its input', () => {
    const data: DataSet = {
      listDefinitions: [list(1), list(2)], settings: [source(2)],
      layouts: [layout(1, cells([lens('a', 2)]))], listOrders: [{ id: 1, listDefinitionId: 2, todoId: 5, rank: 1 }],
    }
    const before = JSON.stringify(data)
    upgradeV67(data)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('v67 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  const v66File = () => JSON.parse(JSON.stringify({
    [SCHEMA_VERSION_KEY]: 66, todos: [],
    listDefinitions: [list(1), list(2)],
    settings: [{ key: 'themeMode', value: 'dark' }, source(2)],
    layouts: [
      layout(2, cells([lens('a', 2), eis('e')])),
      layout(1, cells([lens('b', 1)]), { createdAt: LATER }),
    ],
    listOrders: [{ id: 1, listDefinitionId: 2, todoId: 5, rank: 1 }],
  })) as unknown

  it('a v66 file imports with the layouts numbered and a copy of the shared source list as the Eisenhower’s', () => {
    const prepared = prepareImport(v66File())
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared).toMatchObject({ sourceVersion: 66, upgraded: true, warnings: [] })
    expect(prepared.data.layouts.map((l) => [l.id, l.sortOrder])).toEqual([[2, 0], [1, 1]])
    // (v68 then gives each other list the layout that shows it.)
    expect(prepared.data.listDefinitions.map((d) => [d.id, d.name, d.owner])).toEqual([
      [1, 'List 1', { layoutId: 1 }], [2, 'List 2', { layoutId: 2 }], [3, 'Eisenhower', OWNER],
    ])
    expect(prepared.data.listDefinitions[2]).toMatchObject({ sort: 'deadline', grouping: 'people', membership: list(2).membership })
    expect(prepared.data.settings).toEqual([{ key: 'themeMode', value: 'dark' }, source(3)])
    expect(prepared.data.listOrders).toEqual([
      { id: 1, listDefinitionId: 2, todoId: 5, rank: 1 },
      { id: 2, listDefinitionId: 3, todoId: 5, rank: 1 },
    ])
  })

  it('a v66 list draft kept in the browser stays with its list (the original id)', () => {
    const v66List = list(2)
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 2: { draft: { ...v66List, name: 'Edited' }, base: v66List, schemaVersion: 66 } }))
    const drafts = readListDrafts()
    expect([...drafts.keys()]).toEqual([2])
    expect(drafts.get(2)?.draft).toMatchObject({ id: 2, name: 'Edited' })
  })
})

/** The live-DB path: a v66 database opened by the current build. */
describe('v67 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function openV66(rows: DataSet): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v66 = new Dexie(db.name)
    v66.version(66).stores(v66StoreSpecs())
    await v66.open()
    for (const [table, tableRows] of Object.entries(rows)) await v66.table(table).bulkAdd(tableRows)
    v66.close()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
  }

  it('the source list only the Eisenhower shows becomes its own in place; the layouts are numbered; the store reads it', async () => {
    await openV66({
      listDefinitions: [list(1), list(2)],
      settings: [source(2)],
      layouts: [layout(1, cells([lens('a', 1), eis('e')]))],
    })
    // (v68 then gives list 1 the layout that shows it.)
    expect(await db.listDefinitions.orderBy('id').toArray()).toEqual([{ ...list(1), owner: { layoutId: 1 } }, { ...list(2), owner: OWNER }])
    expect(await db.layouts.toArray()).toEqual([layout(1, cells([lens('a', 1), eis('e')]), { sortOrder: 0 })])
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().eisenhowerListId).toBe(2)
  })

  it('a shared source list: a copy with its ranks, the same as the import path makes', async () => {
    const rows = (): DataSet => ({
      listDefinitions: [list(1), list(2)],
      settings: [source(2)],
      layouts: [layout(1, cells([lens('a', 2)]))],
      listOrders: [{ id: 1, listDefinitionId: 2, todoId: 5, rank: 1 }],
    })
    await openV66(rows())
    const lists = await db.listDefinitions.orderBy('id').toArray()
    // (v68 then gives list 2 the layout that shows it, and list 1 a layout "Lists from upgrade".)
    expect(lists.map((d) => [d.id, d.owner])).toEqual([[1, { layoutId: 2 }], [2, { layoutId: 1 }], [3, OWNER]])
    expect(await db.listOrders.where('listDefinitionId').equals(3).toArray()).toEqual([{ id: 2, listDefinitionId: 3, todoId: 5, rank: 1 }])
    expect(await db.settings.get('eisenhowerSource')).toEqual(source(3))
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 66, todos: [], ...rows() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions).toEqual(lists)
    expect(prepared.data.listOrders).toEqual(await db.listOrders.toArray())
  })

  it('an Eisenhower on all tasks gets a new list of its own', async () => {
    await openV66({ listDefinitions: [list(1)], settings: [], layouts: [layout(1, cells([eis('e')]))] })
    expect(await db.listDefinitions.get(2)).toEqual(NEW_LIST(2, 1))
    expect(await db.settings.get('eisenhowerSource')).toEqual(source(2))
  })
})
