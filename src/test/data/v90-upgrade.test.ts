import { afterEach, describe, expect, it } from 'vitest'
import { upgradeV90 } from '../../data/upgrades/v90'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, db } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { rowFixes, validateRow } from '../../data/import-validation'
import { LAYOUT_PART_LIMIT } from '../../data/layout-shape'
import { layoutSizeProblem } from '../../data/layout-size'
import { emptyPredicate } from '../../models/filter-predicate'
import type { LayoutBody, LayoutTab } from '../../models/workspace-layout'
import { cell, grid, numberItem, picture } from '../helpers/layout-builders'
import { expectWithin } from '../timing'

/**
 * v90 — the Pivot removed: every `pivot` tab goes, a cell left without
 * tabs closes by the absorb rule. And every Number lives in a Numbers
 * widget: a cell of only Numbers becomes one `numbers` widget holding them
 * in order (its active tab that widget), a Number among other kinds a
 * widget of its own in its place; each Number keeps its id, config and
 * icon; tracks, `fitPx` and collapse stay. The transform's own tests, then
 * the pipeline and the browser database.
 */

type Obj = Record<string, unknown>

const DATE = '2026-11-24T09:00:00.000Z'
const notes = (id: string): LayoutTab => ({ id, kind: 'notes', config: {} })
/** A stored tab of any shape (stored data isn't typed — the kind is gone from the model). */
const raw = (tab: Obj): LayoutTab => tab as unknown as LayoutTab
/** A v89 Number tab: its config a metric's ready-made one, `extra` over the tab. */
const number = (id: string, metric: Parameters<typeof numberItem>[1] = 'open', extra: Obj = {}): LayoutTab => {
  const { id: _id, ...config } = numberItem(id, metric)
  void _id
  return raw({ id, kind: 'number', config, ...extra })
}
/** The item a v89 Number tab becomes. */
const item = (tab: LayoutTab, extra: Obj = {}): Obj => ({ ...(tab.config as Obj), id: tab.id, ...extra })
/** A v89 Pivot tab, with its rows' sort. */
const pivot = (id: string): LayoutTab => raw({ id, kind: 'pivot', config: { name: 'Who × status', filter: emptyPredicate(), rows: 'people', cols: 'status' }, viewState: { sort: { by: 'total' } } })
const layout = (body: LayoutBody, extra: Obj = {}): DataRow => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body, ...extra })
const bodyOf = (row: DataRow) => row as unknown as LayoutBody
const cellOf = (row: DataRow, cellId: string) => bodyOf(row).cells.find((c) => c.id === cellId)
const upgradeOne = (row: DataRow): DataRow => upgradeV90({ layouts: [row] }).layouts![0]!

/** A row the current schema takes as it is (no repair). */
function expectClean(row: DataRow): void {
  expect(validateRow('layouts', row)).toBe(true)
  expect(rowFixes('layouts', row)).toEqual([])
}

describe('v90: registered', () => {
  it('is registered above the floor, at or below the current version', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(90)
    expect(OLDEST_SUPPORTED_DB_VERSION).toBe(87)
    expect(SCHEMA_UPGRADES.get(90)).toBe(upgradeV90)
  })
})

describe('v90: the Pivot goes', () => {
  it('a Pivot among other tabs goes; its cell keeps the rest, the active tab moving to the one before', () => {
    const a = cell('a', [notes('n1'), pivot('gone'), notes('n2')], { activeTabId: 'gone' })
    const out = upgradeOne(layout(grid([[a, cell('b', [notes('n3')])]])))
    expect(cellOf(out, 'a')?.tabs).toEqual([notes('n1'), notes('n2')])
    expect(cellOf(out, 'a')?.activeTabId).toBe('n1')
    expect(picture(bodyOf(out))).toEqual(['a b'])
    expectClean(out)
  })

  it('the first tab active and a Pivot: the one after it shows', () => {
    const out = upgradeOne(layout(grid([[cell('a', [pivot('gone'), notes('n1')], { activeTabId: 'gone' })]])))
    expect(cellOf(out, 'a')?.activeTabId).toBe('n1')
    expectClean(out)
  })

  it('a cell of only a Pivot closes: the neighbour sharing its whole edge takes its space, the line between them goes', () => {
    const out = upgradeOne(layout(grid([[cell('a', [pivot('p')]), cell('b', [notes('n')])]], { cols: [300, 700] })))
    expect(picture(bodyOf(out))).toEqual(['b'])
    expect(bodyOf(out).grid.columns).toEqual([{ id: 'c1', weight: 1000 }])
    expectClean(out)
  })

  it('with no whole-edge neighbour, the cells along a side that cover its edge grow across it', () => {
    const t = cell('t', [pivot('p')])
    const out = upgradeOne(layout(grid([[t, t], [cell('l', [notes('n1')]), cell('r', [notes('n2')])]])))
    expect(picture(bodyOf(out))).toEqual(['l r'])
    expectClean(out)
  })

  it('a pinwheel’s centre has no taker: it stays as an empty cell', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => cell(id, [notes(`n-${id}`)])) as [ReturnType<typeof cell>, ReturnType<typeof cell>, ReturnType<typeof cell>, ReturnType<typeof cell>]
    const out = upgradeOne(layout(grid([[a, a, b], [d, cell('e', [pivot('p')]), b], [d, c, c]])))
    expect(picture(bodyOf(out))).toEqual(['a a b', 'd e b', 'd c c'])
    expect(cellOf(out, 'e')?.tabs).toEqual([])
    expectClean(out)
  })

  it('a cell that was empty before is left as it was', () => {
    const out = upgradeOne(layout(grid([[cell('a'), cell('b', [notes('n'), pivot('p')])]])))
    expect(picture(bodyOf(out))).toEqual(['a b'])
    expect(cellOf(out, 'b')?.tabs).toEqual([notes('n')])
  })

  it('a Pivot beside Numbers goes first: the Numbers left are a cell of only Numbers, one widget', () => {
    const a = number('a', 'overdue')
    const b = number('b')
    const out = upgradeOne(layout(grid([[cell('k', [pivot('p'), a, b], { activeTabId: 'p' })]])))
    expect(cellOf(out, 'k')).toMatchObject({ tabs: [{ id: 'n-a', kind: 'numbers', config: { items: [item(a), item(b)] } }], activeTabId: 'n-a' })
    expectClean(out)
  })

  it('a table that doesn’t read: the Pivot still goes, no cell closes (the repair closes what’s left empty)', () => {
    const row: DataRow = { id: 5, grid: 'x', cells: [{ id: 'a', tabs: [pivot('p')] }, { id: 'b', tabs: [notes('n')] }] }
    const out = upgradeOne(row) as { cells: Array<{ id: string; tabs: unknown[] }> }
    expect(out.cells.map((c) => [c.id, c.tabs.length])).toEqual([['a', 0], ['b', 1]])
  })

  it('stays within a time bound at the part limit, just past it, and at the most the import admits', () => {
    // `n` cells stacked in one column, every other one a Pivot: those close into the one above.
    const stack = (n: number): DataRow => layout({
      grid: { columns: [{ id: 'c', weight: 1 }], rows: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, weight: 1 })) },
      cells: Array.from({ length: n }, (_, i) => ({ id: `k${i}`, area: { col: 0, row: i, colSpan: 1, rowSpan: 1 }, tabs: [i % 2 ? pivot(`t${i}`) : notes(`t${i}`)] })),
    })
    for (const n of [LAYOUT_PART_LIMIT, LAYOUT_PART_LIMIT + 1, 3300]) {
      const layouts = [stack(n)]
      expect(layoutSizeProblem(layouts), `${n} cells`).toBeNull()
      const data: DataSet = { layouts }
      expectWithin(1000, () => {
        const out = upgradeDataSet(data, 89, 90)
        expect((out.layouts![0]!.cells as unknown[]).length).toBe(Math.ceil(n / 2))
      })
    }
  })
})

describe('v90: a cell of only Numbers becomes one Numbers widget', () => {
  it('a strip: its Numbers in strip order, ids, configs and icons kept; the widget is the active tab; the fit row and its height stay', () => {
    const icon = { kind: 'emoji', emoji: '🔥' }
    const a = number('a', 'overdue', { icon })
    const b = number('b', 'open')
    const c = number('c', 'focus', { icon: { kind: 'none' } })
    const strip = cell('s', [a, b, c], { activeTabId: 'b' })
    const body = grid([[strip, strip], [cell('k', [notes('n')]), cell('m', [notes('o')])]], { rows: [{ weight: 1000, fitPx: 90 }, { weight: 1000, collapsed: true }] })
    const out = upgradeOne(layout(body))
    const s = cellOf(out, 's')!
    expect(s.tabs).toEqual([{ id: 'n-a', kind: 'numbers', config: { items: [item(a, { icon }), item(b), item(c, { icon: { kind: 'none' } })] } }])
    expect(s.activeTabId).toBe('n-a')
    // Tracks, their fitPx and collapse untouched; the other cells the same objects.
    expect(bodyOf(out).grid).toBe(body.grid)
    expect(cellOf(out, 'k')).toBe(body.cells.find((x) => x.id === 'k'))
    expectClean(out)
  })

  it('a lone Number: a Numbers widget of one, under a new id; its Number keeps its own', () => {
    const n = number('u1', 'urgent')
    const out = upgradeOne(layout(grid([[cell('k', [n])]])))
    expect(cellOf(out, 'k')).toMatchObject({ tabs: [{ id: 'n-u1', kind: 'numbers', config: { items: [item(n)] } }], activeTabId: 'n-u1' })
    expectClean(out)
  })

  it('a new widget id is new to the layout: numbered past one already taken', () => {
    const out = upgradeOne(layout(grid([[cell('n-a', [notes('x')]), cell('k', [number('a')])]])))
    expect(cellOf(out, 'k')?.tabs[0]?.id).toBe('n-a-2')
    expectClean(out)
  })

  it('a tab name a Number stored apart from its config names it only when its config has none', () => {
    const named = raw({ id: 'a', kind: 'number', config: { ...item(number('a')), id: undefined, name: undefined }, name: 'From the tab' })
    const kept = number('b', 'open', { name: 'Ignored' })
    const out = upgradeOne(layout(grid([[cell('k', [named, kept])]])))
    const items = (cellOf(out, 'k')!.tabs[0]!.config as { items: Obj[] }).items
    expect(items.map((i) => i.name)).toEqual(['From the tab', 'Open'])
  })
})

describe('v90: a Number among other kinds becomes a Numbers widget of its own, in its place', () => {
  it('the tab strip reads as before; the active tab follows its Number to its widget', () => {
    const a = number('a', 'overdue')
    const b = number('b', 'open')
    const out = upgradeOne(layout(grid([[cell('k', [notes('n1'), a, notes('n2'), b], { activeTabId: 'a' })]])))
    const k = cellOf(out, 'k')!
    expect(k.tabs).toEqual([
      notes('n1'),
      { id: 'n-a', kind: 'numbers', config: { items: [item(a)] } },
      notes('n2'),
      { id: 'n-b', kind: 'numbers', config: { items: [item(b)] } },
    ])
    expect(k.activeTabId).toBe('n-a')
    expectClean(out)
  })

  it('a cell whose active tab is another kind keeps it', () => {
    const out = upgradeOne(layout(grid([[cell('k', [notes('n1'), number('a')], { activeTabId: 'n1' })]])))
    expect(cellOf(out, 'k')?.activeTabId).toBe('n1')
  })
})

describe('v90: the contract', () => {
  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const data: DataSet = { layouts: [layout(grid([[cell('s', [number('a'), number('b')]), cell('k', [notes('n'), number('c')]), cell('p', [pivot('p1')])]]))] }
    const before = JSON.parse(JSON.stringify(data)) as DataSet
    const once = upgradeV90(data)
    expect(data).toEqual(before)
    expect(once).not.toBe(data)
    expect(upgradeV90(once)).toBe(once)
  })

  it('a layout with neither a Pivot nor a Number tab comes back as the same object; other tables are the same arrays', () => {
    const plain = layout(grid([[cell('a', [notes('n')])]]), { id: 2 })
    const todos: DataRow[] = [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }]
    const settings: DataRow[] = [{ key: 'staleAfterDays', value: '30' }]
    const out = upgradeV90({ todos, settings, layouts: [layout(grid([[cell('a', [number('x')])]])), plain] })
    expect(out.layouts![1]).toBe(plain)
    expect(out.todos).toBe(todos)
    expect(out.settings).toBe(settings)
  })

  it('tolerates missing tables and malformed rows (left for the repair)', () => {
    const empty: DataSet = {}
    expect(upgradeV90(empty)).toBe(empty)
    const odd: DataSet = {
      layouts: [null as unknown as DataRow, { id: 2, cells: 'none' }, { id: 3, cells: [null, { id: 'k', tabs: 'x' }, { id: 'j', tabs: [null, 4, { kind: 'number' }] }] }, { id: 4, grid: 'x', cells: [] }],
    }
    expect(upgradeV90(odd)).toBe(odd)
  })
})

describe('v90 through the pipeline', () => {
  const v89File = () => ({
    [SCHEMA_VERSION_KEY]: 89,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
    layouts: [layout(grid([
      [cell('s', [number('a', 'overdue', { icon: { kind: 'emoji', emoji: '⏰' } }), number('b')], { activeTabId: 'b' }), cell('k', [notes('n'), number('c')], { activeTabId: 'c' })],
    ], { rows: [{ weight: 1000, fitPx: 80 }] }))],
    settings: [{ key: 'weekStartsOn', value: '1' }],
  })

  it('a v89 file imports with its strips and lone Numbers as Numbers widgets, and no warning', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v89File())))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    const [s, k] = result.data.layouts[0]!.cells
    expect(s?.tabs.map((t) => t.kind)).toEqual(['numbers'])
    expect(s?.tabs[0]?.kind === 'numbers' && s.tabs[0].config.items.map((n) => [n.id, n.icon])).toEqual([['a', { kind: 'emoji', emoji: '⏰' }], ['b', undefined]])
    expect(s?.activeTabId).toBe(s?.tabs[0]?.id)
    expect(k?.tabs.map((t) => t.kind)).toEqual(['notes', 'numbers'])
    expect(k?.activeTabId).toBe(k?.tabs[1]?.id)
    expect(result.data.layouts[0]!.grid.rows[0]).toEqual({ id: 'r1', weight: 1000, fitPx: 80 })
  })

  it('a v89 file imports without its Pivots, a cell of only a Pivot closed, and no warning', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: 89,
      todos: [],
      layouts: [layout(grid([[cell('p', [pivot('p1')]), cell('k', [notes('n'), pivot('p2')], { activeTabId: 'p2' })]]))],
      settings: [],
    }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    const cells = result.data.layouts[0]!.cells
    expect(cells.map((c) => c.id)).toEqual(['k'])
    expect(cells[0]?.tabs.map((t) => t.id)).toEqual(['n'])
    expect(cells[0]?.activeTabId).toBe('n')
    expect(cells[0]?.area).toEqual({ col: 0, row: 0, colSpan: 1, rowSpan: 1 })
  })

  it('the registry runs it from v87 to the current version', () => {
    const chained = upgradeDataSet(JSON.parse(JSON.stringify({ ...v89File(), [SCHEMA_VERSION_KEY]: 87 })) as DataSet, 87, CURRENT_DB_VERSION)
    expect(cellOf(chained.layouts![0]!, 's')?.tabs.map((t) => t.kind)).toEqual(['numbers'])
  })
})

// ── The browser database ────────────────────────────────────────────────────

type IndexSpec = [name: string, keyPath: string | string[], unique?: 'unique']

/** The v87 – v89 stores and indexes (no step since changed a store). */
const STORES: Record<string, { keyPath: string; auto: boolean; indexes: IndexSpec[] }> = {
  backups: { keyPath: 'id', auto: true, indexes: [['createdAt', 'createdAt'], ['trigger', 'trigger']] },
  layouts: { keyPath: 'id', auto: true, indexes: [] },
  listDefinitions: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  listOrders: { keyPath: 'id', auto: true, indexes: [['[listDefinitionId+todoId]', ['listDefinitionId', 'todoId'], 'unique'], ['listDefinitionId', 'listDefinitionId'], ['todoId', 'todoId']] },
  notes: { keyPath: 'id', auto: true, indexes: [['modifiedAt', 'modifiedAt']] },
  people: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  settings: { keyPath: 'key', auto: false, indexes: [] },
  statuses: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  statusUpdates: { keyPath: 'id', auto: true, indexes: [['date', 'date'], ['todoId', 'todoId']] },
  subtasks: { keyPath: 'id', auto: true, indexes: [['todoId', 'todoId']] },
  tags: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  todoEvents: { keyPath: 'id', auto: true, indexes: [['timestamp', 'timestamp'], ['todoId', 'todoId'], ['type', 'type']] },
  todoPeople: { keyPath: 'id', auto: true, indexes: [['personId', 'personId'], ['todoId', 'todoId']] },
  todoTags: { keyPath: 'id', auto: true, indexes: [['tagId', 'tagId'], ['todoId', 'todoId']] },
  todos: { keyPath: 'id', auto: true, indexes: [['dueDate', 'dueDate'], ['isCompleted', 'isCompleted'], ['sortOrder', 'sortOrder'], ['statusId', 'statusId'], ['uid', 'uid', 'unique']] },
}

/** A raw `todo2` database as a v89 build left it (native version 890), holding `row` in `layouts`. */
function createV89Db(row: DataRow): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', 890)
    req.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(STORES)) {
        const store = req.result.createObjectStore(name, { keyPath: spec.keyPath, autoIncrement: spec.auto })
        for (const [index, keyPath, unique] of spec.indexes) store.createIndex(index, keyPath, { unique: unique === 'unique' })
      }
      req.transaction!.objectStore('layouts').add(row)
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

describe('v90 in the browser database', () => {
  afterEach(async () => {
    db.close()
    await db.delete()
  })

  it('a v89 database opens with its Number tabs made Numbers widgets', async () => {
    db.close()
    await db.delete()
    const a = number('a', 'overdue')
    const b = number('b')
    await createV89Db(layout(grid([[cell('s', [a, b], { activeTabId: 'a' })]], { rows: [{ weight: 1000, fitPx: 70 }] }), { createdAt: new Date(DATE), modifiedAt: new Date(DATE) }))
    await db.open()
    const [row] = await db.layouts.toArray()
    expect(row?.cells[0]?.tabs).toEqual([{ id: 'n-a', kind: 'numbers', config: { items: [item(a), item(b)] } }])
    expect(row?.cells[0]?.activeTabId).toBe('n-a')
    expect(row?.grid.rows[0]).toEqual({ id: 'r1', weight: 1000, fitPx: 70 })
  })

  it('a v89 database opens without its Pivots, a cell of only a Pivot closed', async () => {
    db.close()
    await db.delete()
    await createV89Db(layout(grid([[cell('p', [pivot('p1')]), cell('k', [notes('n'), pivot('p2')], { activeTabId: 'p2' })]]), { createdAt: new Date(DATE), modifiedAt: new Date(DATE) }))
    await db.open()
    const [row] = await db.layouts.toArray()
    expect(row?.cells.map((c) => [c.id, c.tabs.map((t) => t.id), c.activeTabId])).toEqual([['k', ['n'], 'n']])
    expect(row?.grid.columns).toHaveLength(1)
  })
})
