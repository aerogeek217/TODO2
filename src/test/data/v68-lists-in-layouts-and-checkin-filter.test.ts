import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV68 } from '../../data/upgrades/v68-lists-in-layouts-and-checkin-filter'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyPredicate } from '../../models/filter-predicate'
import { listedLists, type PersistedListDefinition } from '../../models/list-definition'
import { useSettingsStore } from '../../stores/settings-store'
import { checkinFiltersEqual, dueSoonCheckinFilter } from '../../utils/checkin-settings'
import { resetDb, v67StoreSpecs } from '../helpers'

const AT = new Date('2026-10-01T09:00:00.000Z')
const LATER = new Date('2026-10-05T09:00:00.000Z')

const predicate = (extra: Record<string, unknown> = {}) => ({ ...emptyPredicate(), ...extra })
const list = (id: number, extra: Record<string, unknown> = {}): DataRow => ({
  id, name: `List ${id}`, sortOrder: id - 1, sort: 'deadline', grouping: 'people',
  membership: { kind: 'custom', predicate: predicate({ statusIds: [2] }) }, ...extra,
})
const lens = (id: string, listDefinitionId?: number): DataRow =>
  ({ id, kind: 'lens', config: listDefinitionId !== undefined ? { listDefinitionId } : {} })
const dash = (id: string, listTiles: unknown[]): DataRow => ({ id, kind: 'dashboard', config: { tiles: [], listTiles, sections: [] } })
const cells = (...tabs: DataRow[][]) => [{ id: 'c1', weight: 1, cells: tabs.map((t, i) => ({ id: `k${i}`, weight: 1, tabs: t })) }]
const layout = (id: number, sortOrder: number, columns: unknown, extra: Record<string, unknown> = {}): DataRow =>
  ({ id, name: `L${id}`, sortOrder, createdAt: AT, modifiedAt: AT, columns, ...extra })
const owned = (layoutId: number) => ({ owner: { layoutId } })
const EISENHOWER = { owner: { eisenhower: true } }
const settings = (...rows: DataRow[]): DataRow[] => [{ key: 'themeMode', value: 'dark' }, ...rows]
const scope = (value: string): DataRow => ({ key: 'checkinTaskScope', value })

/** The layout v68 makes for the lists no layout shows. */
const UPGRADE_LAYOUT = (id: number, sortOrder: number, listIds: number[], at: Date = AT): DataRow => {
  const tabs = listIds.map((listDefinitionId, i) => ({ id: `tab-${i + 1}`, kind: 'lens', config: { listDefinitionId } }))
  return {
    id, name: 'Lists from upgrade', sortOrder,
    columns: [{ id: 'col-1', weight: 1, cells: [{ id: 'cell-1', weight: 1, tabs, activeTabId: tabs[0]?.id }] }],
    createdAt: at, modifiedAt: at,
  }
}

describe('upgradeV68 (pure): every list belongs to a layout', () => {
  it('is the v68 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(68)
    expect(SCHEMA_UPGRADES.get(68)).toBe(upgradeV68)
  })

  it('a list becomes the list of the first layout (by order, then id) that names it; nothing else changes', () => {
    const layouts = [
      layout(3, 1, cells([lens('a', 1)])),
      layout(2, 0, [], { bottom: { id: 'b', height: 100, tabs: [lens('x', 2)] } }),
    ]
    const data: DataSet = { listDefinitions: [list(1), list(2)], layouts, settings: settings() }
    const out = upgradeV68(data)
    expect(out.listDefinitions).toEqual([{ ...list(1), ...owned(3) }, { ...list(2), ...owned(2) }])
    expect(out.layouts).toBe(layouts)
    expect(out.settings).toBe(data.settings)
  })

  it.each([
    ['a list tab in a cell', (id: number) => layout(5, 1, cells([lens('z'), lens('a', id)]))],
    ['a list tab in the top band', (id: number) => layout(5, 1, [], { top: { id: 't', height: 100, tabs: [lens('a', id)] } })],
    ['a list tab in the bottom band', (id: number) => layout(5, 1, [], { bottom: { id: 'b', height: 100, tabs: [lens('a', id)] } })],
    ['a dashboard list tile', (id: number) => layout(5, 1, cells([dash('d', [id, 'x'])]))],
  ])('every other layout naming it (by %s) gets its own copy, with the manual order, and names the copy', (_what, other) => {
    const orders = [
      { id: 1, listDefinitionId: 1, todoId: 5, rank: 1 },
      { id: 3, listDefinitionId: 2, todoId: 5, rank: 4 },
      { id: 2, listDefinitionId: 1, todoId: 6, rank: 2 },
    ]
    // (A tab on a deleted list, 9, names it still.)
    const layouts = [layout(4, 0, cells([lens('a', 1), lens('b', 2), lens('z', 9)])), other(1)]
    const out = upgradeV68({ listDefinitions: [list(1), list(2)], layouts, settings: settings(), listOrders: orders })
    // A new id after every list id named (the dangling 9 included).
    expect(out.listDefinitions).toEqual([
      { ...list(1), ...owned(4) },
      { ...list(2), ...owned(4) },
      { ...list(1), id: 10, sortOrder: 2, ...owned(5) },
    ])
    expect(out.listOrders).toEqual([
      ...orders,
      { id: 4, listDefinitionId: 10, todoId: 5, rank: 1 },
      { id: 5, listDefinitionId: 10, todoId: 6, rank: 2 },
    ])
    expect(out.layouts![0]).toBe(layouts[0])
    expect(out.layouts![1]).toEqual(other(10))
    // Each layout's list chooser offers only its own.
    const defs = out.listDefinitions as unknown as PersistedListDefinition[]
    expect(listedLists(defs, 4).map((d) => d.id)).toEqual([1, 2])
    expect(listedLists(defs, 5).map((d) => d.id)).toEqual([10])
  })

  it('a list a layout owns stays its own; another layout naming it gets a copy', () => {
    const layouts = [layout(1, 0, cells([lens('a', 1)])), layout(2, 1, cells([lens('b', 1)]))]
    const out = upgradeV68({ listDefinitions: [list(1, owned(2))], layouts, settings: settings() })
    expect(out.listDefinitions).toEqual([{ ...list(1), ...owned(2) }, { ...list(1), id: 2, sortOrder: 1, ...owned(1) }])
    expect(out.layouts).toEqual([layout(1, 0, cells([lens('a', 2)])), layouts[1]])
  })

  it('the lists no layout names — no owner, a layout that is gone, an owner that doesn’t read — go into a new layout “Lists from upgrade”, in the list order', () => {
    const lists = [
      list(1, { sortOrder: 5 }),
      list(2, owned(77)),
      list(3, { sortOrder: 0, owner: { layoutId: 'x' } }),
      list(4, owned(1)),
      list(5, EISENHOWER),
    ]
    const layouts = [layout(1, 3, cells([lens('a', 9)]), { modifiedAt: LATER }), layout(2, 0, [])]
    const out = upgradeV68({ listDefinitions: lists, layouts, settings: settings({ key: 'activeLayoutId', value: '80' }) })
    // An id after every layout id named (an owner's 77, the active 80).
    expect(out.layouts).toEqual([...layouts, UPGRADE_LAYOUT(81, 4, [3, 2, 1], LATER)])
    expect(out.listDefinitions).toEqual([
      { ...list(1, { sortOrder: 5 }), ...owned(81) },
      { ...list(2), ...owned(81) },
      { ...list(3, { sortOrder: 0 }), ...owned(81) },
      // An owned list no tab shows stays its layout's; the Eisenhower's is left alone.
      lists[3],
      lists[4],
    ])
  })

  it('a layout’s list it doesn’t show that the check-in scope named goes into “Lists from upgrade”; one the scope didn’t name stays its layout’s', () => {
    const layouts = [layout(1, 0, cells([lens('a', 3)]))]
    const out = upgradeV68({
      listDefinitions: [list(1, owned(1)), list(2, owned(1)), list(3, owned(1))],
      layouts,
      settings: settings(scope('list:1')),
    })
    expect(out.listDefinitions).toEqual([{ ...list(1), ...owned(2) }, { ...list(2), ...owned(1) }, { ...list(3), ...owned(1) }])
    expect(out.layouts).toEqual([...layouts, UPGRADE_LAYOUT(2, 1, [1])])
    // A layout that shows it keeps it.
    const shown = upgradeV68({ listDefinitions: [list(1, owned(1))], layouts: [layout(1, 0, cells([lens('a', 1)]))], settings: settings(scope('list:1')) })
    expect(shown.listDefinitions).toEqual([{ ...list(1), ...owned(1) }])
  })

  it('an owner with keys it doesn’t know is rewritten to the layout alone', () => {
    const layouts = [layout(1, 0, cells([lens('a', 1)]))]
    const out = upgradeV68({ listDefinitions: [list(1, { owner: { layoutId: 1, extra: true } })], layouts, settings: settings() })
    expect(out.listDefinitions).toEqual([{ ...list(1), ...owned(1) }])
  })

  it('the Eisenhower’s list is never moved or copied, even when a list tab names it', () => {
    const lists = [list(1, EISENHOWER)]
    const layouts = [layout(1, 0, cells([lens('a', 1)])), layout(2, 1, cells([lens('b', 1)]))]
    const data: DataSet = { listDefinitions: lists, layouts, settings: settings() }
    expect(upgradeV68(data)).toBe(data)
  })

  it('without a layouts table the lists go into the new layout (id 1, order 0), dated by the fixed date', () => {
    const out = upgradeV68({ listDefinitions: [list(1)], settings: [] })
    expect(out.layouts).toEqual([UPGRADE_LAYOUT(1, 0, [1], new Date('2026-10-20T00:00:00.000Z'))])
    expect(out.listDefinitions).toEqual([{ ...list(1), ...owned(1) }])
  })

  it('past the safe ids (a huge id stored earlier) a copy takes the smallest free id', () => {
    const big = Number.MAX_SAFE_INTEGER
    const layouts = [layout(1, 0, cells([lens('a', big)])), layout(2, 1, cells([lens('b', big)]))]
    const out = upgradeV68({ listDefinitions: [list(big), list(1, owned(1))], layouts, settings: settings() })
    expect(out.listDefinitions!.map((d) => [d.id, d.owner])).toEqual([[big, { layoutId: 1 }], [1, { layoutId: 1 }], [2, { layoutId: 2 }]])
  })

  it('a kept layout draft, a kept list draft or a task archive is left as it is', () => {
    const drafts: DataSet[] = [
      { layouts: [{ columns: cells([lens('a', 1)]) }, { columns: [] }] },
      { listDefinitions: [list(1), list(1)] },
      { todos: [{ id: 1 }], todoPeople: [] },
    ]
    for (const d of drafts) expect(upgradeV68(d)).toBe(d)
  })

  it('returns its input when nothing changes: v68 data, rows it can’t walk', () => {
    const data: DataSet = {
      listDefinitions: [list(1, owned(1)), list(2, owned(2)), list(3, EISENHOWER), null as never, { id: 'x' }],
      layouts: [layout(1, 0, cells([lens('a', 1), { id: 'q' }, 'junk' as never])), layout(2, 1, 'nope'), null as never],
      settings: settings({ key: 'checkinTaskFilter', value: '{}' }),
    }
    expect(upgradeV68(data)).toBe(data)
    const once = upgradeV68({ listDefinitions: [list(1), list(2)], layouts: [layout(1, 0, cells([lens('a', 1)])), layout(2, 1, cells([lens('a', 1)]))], settings: settings(scope('hot')) })
    expect(upgradeV68(once)).toBe(once)
  })

  it('never changes its input', () => {
    const data: DataSet = {
      listDefinitions: [list(1), list(2), list(3)],
      layouts: [layout(1, 0, cells([lens('a', 1)])), layout(2, 1, cells([dash('d', [1])]))],
      listOrders: [{ id: 1, listDefinitionId: 1, todoId: 5, rank: 1 }],
      settings: settings(scope('list:2')),
    }
    const before = JSON.stringify(data)
    upgradeV68(data)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('upgradeV68 (pure): the check-in scope becomes the check-in filter', () => {
  const run = (value: string, lists: DataRow[] = []) => {
    const out = upgradeV68({ settings: settings(scope(value)), listDefinitions: lists, layouts: [layout(1, 0, [])] })
    const row = out.settings!.find((r) => r.key === 'checkinTaskFilter')
    expect(out.settings!.some((r) => r.key === 'checkinTaskScope')).toBe(false)
    return row ? JSON.parse(row.value as string) as Record<string, unknown> : undefined
  }

  it.each(['all', 'list:x', 'soon', 'list:9'])('%s → no filter (the scope row goes)', (value) => {
    expect(run(value, [list(1)])).toBeUndefined()
  })

  it('hot → Priority Hot', () => {
    expect(run('hot')).toEqual(predicate({ markers: 'hot' }))
  })

  it('due-soon → due today + 14 days or before (overdue included)', () => {
    const filter = run('due-soon')
    expect(filter).toEqual(predicate({ dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: 14 } } } }))
    expect(checkinFiltersEqual(filter as never, dueSoonCheckinFilter())).toBe(true)
  })

  it('list:<id> → that list’s filter, without its people (nor their “is not”), completed tasks off', () => {
    const source = list(2, {
      membership: { kind: 'custom', predicate: predicate({ showCompleted: true, personIds: [3], tags: [4], negate: { personIds: true, tags: true }, searchText: 'x' }) },
    })
    expect(run('list:2', [list(1), source])).toEqual(predicate({ tags: [4], negate: { tags: true }, searchText: 'x' }))
    const onlyPeople = list(2, { membership: { kind: 'custom', predicate: predicate({ personIds: [3], negate: { personIds: true } }) } })
    expect(run('list:2', [onlyPeople])).toEqual(predicate())
  })

  it('a check-in filter already there wins; the scope row goes', () => {
    const filterRow = { key: 'checkinTaskFilter', value: '{"x":1}' }
    const out = upgradeV68({ settings: [scope('hot'), filterRow] })
    expect(out.settings).toEqual([filterRow])
  })

  it('without a settings table nothing changes', () => {
    const data: DataSet = { listDefinitions: [list(1)], layouts: [] }
    expect(upgradeV68(data)).toBe(data)
  })
})

describe('v68 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  const v67File = () => JSON.parse(JSON.stringify({
    [SCHEMA_VERSION_KEY]: 67, todos: [],
    listDefinitions: [list(1), list(2), list(3, EISENHOWER), list(4)],
    settings: [{ key: 'themeMode', value: 'dark' }, { key: 'eisenhowerSource', value: 'list:3' }, scope('list:1')],
    layouts: [layout(1, 0, cells([lens('a', 1), lens('b', 2)])), layout(2, 1, cells([lens('c', 2)]))],
    listOrders: [{ id: 1, listDefinitionId: 2, todoId: 5, rank: 1 }],
  })) as unknown

  it('a v67 file imports with every list in a layout, a copy for the second layout, the unused list in “Lists from upgrade” and the check-in filter', async () => {
    const prepared = prepareImport(v67File())
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared).toMatchObject({ sourceVersion: 67, upgraded: true, warnings: [] })
    expect(prepared.data.listDefinitions.map((d) => [d.id, d.owner])).toEqual([
      [1, { layoutId: 1 }], [2, { layoutId: 1 }], [3, { eisenhower: true }], [4, { layoutId: 3 }], [5, { layoutId: 2 }],
    ])
    expect(prepared.data.layouts.map((l) => [l.id, l.name, l.sortOrder])).toEqual([[1, 'L1', 0], [2, 'L2', 1], [3, 'Lists from upgrade', 2]])
    expect(prepared.data.listOrders).toEqual([
      { id: 1, listDefinitionId: 2, todoId: 5, rank: 1 },
      { id: 2, listDefinitionId: 5, todoId: 5, rank: 1 },
    ])
    const filterRow = prepared.data.settings.find((r) => r.key === 'checkinTaskFilter')
    expect(prepared.data.settings.some((r) => r.key === 'checkinTaskScope')).toBe(false)
    expect(JSON.parse(filterRow!.value)).toEqual(predicate({ statusIds: [2] }))

    // Restored, the settings store reads the filter.
    await db.settings.bulkPut(prepared.data.settings)
    await useSettingsStore.getState().load()
    expect(checkinFiltersEqual(useSettingsStore.getState().checkinTaskFilter, predicate({ statusIds: [2] }))).toBe(true)
  })

  it('a v67 list draft kept in the browser stays with its list (the original id)', () => {
    const v67List = list(2)
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 2: { draft: { ...v67List, name: 'Edited' }, base: v67List, schemaVersion: 67 } }))
    const drafts = readListDrafts()
    expect([...drafts.keys()]).toEqual([2])
    expect(drafts.get(2)?.draft).toMatchObject({ id: 2, name: 'Edited' })
  })
})

/** The live-DB path: a v67 database opened by the current build. */
describe('v68 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  const rows = (): DataSet => ({
    listDefinitions: [list(1), list(2), list(3, EISENHOWER), list(4)],
    settings: [{ key: 'eisenhowerSource', value: 'list:3' }, scope('due-soon')],
    layouts: [layout(1, 0, cells([lens('a', 1), dash('d', [2])])), layout(2, 1, cells([lens('c', 2)]))],
    listOrders: [{ id: 1, listDefinitionId: 2, todoId: 5, rank: 1 }],
  })

  it('makes the same lists, layouts, ranks and settings as the import path', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v67 = new Dexie(db.name)
    v67.version(67).stores(v67StoreSpecs())
    await v67.open()
    for (const [table, tableRows] of Object.entries(rows())) await v67.table(table).bulkAdd(tableRows)
    v67.close()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const lists = await db.listDefinitions.orderBy('id').toArray()
    expect(lists.map((d) => [d.id, d.owner])).toEqual([
      [1, { layoutId: 1 }], [2, { layoutId: 1 }], [3, { eisenhower: true }], [4, { layoutId: 3 }], [5, { layoutId: 2 }],
    ])
    const layouts = await db.layouts.orderBy('id').toArray()
    expect(layouts.map((l) => l.name)).toEqual(['L1', 'L2', 'Lists from upgrade'])
    expect(await db.settings.get('checkinTaskScope')).toBeUndefined()
    await useSettingsStore.getState().load()
    expect(checkinFiltersEqual(useSettingsStore.getState().checkinTaskFilter, dueSoonCheckinFilter())).toBe(true)

    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 67, todos: [], ...rows() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions).toEqual(lists)
    expect(prepared.data.layouts).toEqual(layouts)
    expect(prepared.data.listOrders).toEqual(await db.listOrders.toArray())
    expect([...prepared.data.settings].sort((a, b) => a.key.localeCompare(b.key))).toEqual(await db.settings.toArray())
  })
})
