import { afterEach, describe, expect, it } from 'vitest'
import { upgradeV90 } from '../../data/upgrades/v90'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, db } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { rowFixes, validateRow } from '../../data/import-validation'
import type { LayoutBody, LayoutTab } from '../../models/workspace-layout'
import { cell, grid, numberItem } from '../helpers/layout-builders'

/**
 * v90 — every Number lives in a Numbers widget: a cell of only Numbers
 * becomes one `numbers` widget holding them in order (its active tab that
 * widget), a Number among other kinds a widget of its own in its place;
 * each Number keeps its id, config and icon; tracks, `fitPx` and collapse
 * stay. The transform's own tests, then the pipeline and the browser
 * database.
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
    const data: DataSet = { layouts: [layout(grid([[cell('s', [number('a'), number('b')]), cell('k', [notes('n'), number('c')])]]))] }
    const before = JSON.parse(JSON.stringify(data)) as DataSet
    const once = upgradeV90(data)
    expect(data).toEqual(before)
    expect(once).not.toBe(data)
    expect(upgradeV90(once)).toBe(once)
  })

  it('a layout without a Number tab comes back as the same object; other tables are the same arrays', () => {
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
      layouts: [null as unknown as DataRow, { id: 2, cells: 'none' }, { id: 3, cells: [null, { id: 'k', tabs: 'x' }, { id: 'j', tabs: [null, 4, { kind: 'number' }] }] }],
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
})
