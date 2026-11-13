import { describe, expect, it } from 'vitest'
import { upgradeV79 } from '../../data/upgrades/v79'
import { appRangesOf, derivedColumns, layoutV79Of } from '../../data/upgrades/v79/layouts'
import { upgradeLeftoversV79 } from '../../data/upgrades/v79/leftovers'
import { CURRENT_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { rowFixes, validateRow } from '../../data/import-validation'
import { emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import { defaultBreakdownColumns } from '../../models/chart-widgets'
import type { LayoutBody, LayoutTab } from '../../models/workspace-layout'
import { DEFAULT_TAB_BADGES } from '../../utils/tab-badges'
import { cell, grid, picture } from '../helpers/layout-builders'

/**
 * v79 — the final shapes (widget feedback 2026-11-11, decision 6): every
 * shape builds after v78 read at load time is written into the data, so the
 * shims could go. The transform's own tests, part by part, then the chain
 * from the floor; the real ways in (the browser database's own upgrade, an
 * import, a backup, the sync file, an append import, an export round trip)
 * are `v79-real-paths.test`.
 */

type Obj = Record<string, unknown>

const DATE = '2026-11-01T09:00:00.000Z'
const notes = (id: string): LayoutTab => ({ id, kind: 'notes', config: {} })
/** A stored tab of any shape (stored data isn't typed). */
const raw = (tab: Obj): LayoutTab => tab as unknown as LayoutTab
const layout = (body: LayoutBody, extra: Obj = {}): Obj => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body, ...extra })
const one = (tab: Obj, extra: Obj = {}): Obj => layout(grid([[cell('k', [raw(tab)])]]), extra)
const tabOf = (row: DataRow): Obj => ((row as unknown as LayoutBody).cells[0]?.tabs[0] ?? {}) as unknown as Obj
const tabsOf = (row: DataRow, cellId: string) => (row as unknown as LayoutBody).cells.find((c) => c.id === cellId)?.tabs

/** A range from any day before up to `end` days from today, on `field`. */
const by = (field: 'deadline' | 'followup', end: number): TodoPredicate => ({
  ...emptyPredicate(),
  dates: { [field]: { match: 'range', start: null, end: { kind: 'offset', days: end } } },
})
const breakdown = (config: Obj = {}, viewState?: Obj): Obj => ({
  id: 'b', kind: 'breakdown',
  config: { name: 'People', filter: emptyPredicate(), splitBy: 'people', style: 'bars', show: 'count', showNone: true, ...config },
  ...(viewState ? { viewState } : {}),
})
const ranges = (due?: string, followup?: string): DataRow[] => [
  ...(due !== undefined ? [{ key: 'tabBadgeDue', value: due }] : []),
  ...(followup !== undefined ? [{ key: 'tabBadgeFollowup', value: followup }] : []),
]

/** A row the current schema takes as it is (no repair). */
function expectClean(row: DataRow): void {
  expect(validateRow('layouts', row)).toBe(true)
  expect(rowFixes('layouts', row)).toEqual([])
}

describe('v79: registered', () => {
  it('is registered as v79 (the current schema is past it)', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThan(79)
    expect(SCHEMA_UPGRADES.get(79)).toBe(upgradeV79)
  })
})

describe('v79 layouts: the removed kinds go', () => {
  it.each(['eisenhower', 'tagMap', 'statusFlow'])('a %s tab goes; its cell keeps its other tabs, the active tab moving to the one before', (kind) => {
    const a = cell('a', [notes('n1'), raw({ id: 'gone', kind, config: { name: 'X' }, viewState: { ignoreLens: true } }), notes('n2')], { activeTabId: 'gone' })
    const out = layoutV79Of(layout(grid([[a, cell('b', [notes('n3')])]])))
    expect(tabsOf(out, 'a')).toEqual([notes('n1'), notes('n2')])
    expect((out as unknown as LayoutBody).cells[0]?.activeTabId).toBe('n1')
    expect(picture(out as unknown as LayoutBody)).toEqual(['a b'])
    expectClean(out)
  })

  it('a cell left without tabs closes by the absorb rule: the neighbour sharing its whole edge takes its space', () => {
    const out = layoutV79Of(layout(grid([[cell('a', [raw({ id: 'e', kind: 'eisenhower', config: {} })]), cell('b', [notes('n')])]], { cols: [300, 700] })))
    expect(picture(out as unknown as LayoutBody)).toEqual(['b'])
    expect((out as unknown as LayoutBody).grid.columns).toEqual([{ id: 'c1', weight: 1000 }])
    expectClean(out)
  })

  it('a cell with no whole-edge neighbour: the cells along a side that cover its edge grow across it', () => {
    const t = cell('t', [raw({ id: 'm', kind: 'tagMap', config: {} })])
    const out = layoutV79Of(layout(grid([[t, t], [cell('l', [notes('n1')]), cell('r', [notes('n2')])]])))
    expect(picture(out as unknown as LayoutBody)).toEqual(['l r'])
    expectClean(out)
  })

  it('a pinwheel’s centre has no taker: it stays as an empty cell', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => cell(id, [notes(`n-${id}`)])) as [ReturnType<typeof cell>, ReturnType<typeof cell>, ReturnType<typeof cell>, ReturnType<typeof cell>]
    const e = cell('e', [raw({ id: 'sf', kind: 'statusFlow', config: {} })])
    const out = layoutV79Of(layout(grid([[a, a, b], [d, e, b], [d, c, c]])))
    expect(picture(out as unknown as LayoutBody)).toEqual(['a a b', 'd e b', 'd c c'])
    expect(tabsOf(out, 'e')).toEqual([])
    expectClean(out)
  })

  it('a cell that was empty before is left as it was', () => {
    const out = layoutV79Of(layout(grid([[cell('a'), cell('b', [notes('n'), raw({ id: 'e', kind: 'eisenhower', config: {} })])]])))
    expect(picture(out as unknown as LayoutBody)).toEqual(['a b'])
  })
})

describe('v79 layouts: a Review widget', () => {
  it('its kind, its pick and its saved place go; its sort and lens switch stay', () => {
    const out = layoutV79Of(one({ id: 'r', kind: 'review', config: { by: 'tag', pick: { kind: 'tag', id: 3 } }, viewState: { sort: 'due', ignoreLens: true, currentId: 7, skipped: { day: '2026-11-09', ids: [4] } } }))
    expect(tabOf(out)).toEqual({ id: 'r', kind: 'review', config: {}, viewState: { sort: 'due', ignoreLens: true } })
    expectClean(out)
  })

  it('a view state that held only the place goes', () => {
    expect(tabOf(layoutV79Of(one({ id: 'r', kind: 'review', config: { by: 'person' }, viewState: { currentId: 1 } })))).toEqual({ id: 'r', kind: 'review', config: {} })
  })
})

describe('v79 layouts: a Breakdown’s count columns from its old `badges` and the Settings ranges', () => {
  it('no badges, no settings rows: Due and Follow-up in the default ranges (as a new Breakdown has them)', () => {
    const out = layoutV79Of(one(breakdown()), appRangesOf(undefined))
    expect((tabOf(out).config as Obj).columns).toEqual(defaultBreakdownColumns(DEFAULT_TAB_BADGES))
    expectClean(out)
  })

  it('the ranges are the data’s own settings rows: each its row, else its default', () => {
    expect(derivedColumns(undefined, appRangesOf(ranges('7', '2'))).map((c) => c.filter)).toEqual([by('deadline', 7), by('followup', 2)])
    expect(derivedColumns(undefined, appRangesOf(ranges('overdue'))).map((c) => [c.id, c.filter])).toEqual([['due', by('deadline', -1)], ['followup', by('followup', 0)]])
    expect(derivedColumns(undefined, appRangesOf(ranges(undefined, 'off'))).map((c) => c.id)).toEqual(['due'])
    expect(derivedColumns(undefined, appRangesOf(ranges('off', 'off')))).toEqual([])
    // A row that doesn't read is its default.
    expect(derivedColumns(undefined, appRangesOf(ranges('soon', '1'))).map((c) => c.filter)).toEqual([by('deadline', 3), by('followup', 1)])
  })

  it('its own ranges win; one it doesn’t hold is Settings’; `off` drops both; one that doesn’t read is none', () => {
    const app = appRangesOf(ranges('5', '1'))
    expect(derivedColumns({ due: 7 }, app).map((c) => c.filter)).toEqual([by('deadline', 7), by('followup', 1)])
    expect(derivedColumns({ followup: 'overdue' }, app).map((c) => c.filter)).toEqual([by('deadline', 5), by('followup', -1)])
    expect(derivedColumns({ due: 'off' }, app).map((c) => c.id)).toEqual(['followup'])
    expect(derivedColumns('off', app)).toEqual([])
    for (const bad of [{}, { due: 'soon' }, { due: 3, weekly: true }, { due: '3' }, 7]) {
      expect(derivedColumns(bad, app).map((c) => c.filter)).toEqual([by('deadline', 5), by('followup', 1)])
    }
  })

  it('each column is a Number’s rule, lit above 0, in its colour, its id stable and unique in the tab', () => {
    const cols = derivedColumns(undefined, appRangesOf(undefined))
    expect(cols.map((c) => [c.id, c.name, c.color, c.litWhen, c.litAt])).toEqual([
      ['due', 'Due', '#e86bf0', 'above', 0],
      ['followup', 'Follow-up', '#f5c842', 'above', 0],
    ])
  })

  it('`badges` and `checkins` go; columns it already has are kept as they are', () => {
    const own = [{ id: 'col-a', name: 'Waiting', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }]
    const out = layoutV79Of(one(breakdown({ columns: own, badges: 'off', checkins: true })))
    expect(tabOf(out).config).toEqual((breakdown({ columns: own }).config))
    expectClean(out)
    const off = layoutV79Of(one(breakdown({ badges: 'off', checkins: true })))
    expect(tabOf(off).config).toEqual(breakdown({ columns: [] }).config)
  })

  it.each([
    ['overdue', undefined, { by: 'due' }],
    ['due-soon', true, { by: 'due', reversed: true }],
    ['followup-late', undefined, { by: 'followup' }],
    ['followup-due', true, { by: 'followup', reversed: true }],
  ] as const)('a sort by the older %s column becomes the column holding its tasks, in the same direction', (key, reversed, live) => {
    const sort = reversed ? { by: key, reversed } : { by: key }
    const out = layoutV79Of(one(breakdown({}, { sorts: { people: sort }, ignoreLens: true })))
    expect(tabOf(out).viewState).toEqual({ sorts: { people: live }, ignoreLens: true })
    expectClean(out)
  })

  it('a sort by the old Priority column, or by an older column whose column is off, goes (the default order)', () => {
    const out = layoutV79Of(one(breakdown({ badges: { due: 'off' } }, { sorts: { people: { by: 'priority' }, tags: { by: 'overdue' }, status: { by: 'open', reversed: true } } })))
    expect(tabOf(out).viewState).toEqual({ sorts: { status: { by: 'open', reversed: true } } })
    const gone = layoutV79Of(one(breakdown({}, { sorts: { people: { by: 'priority', reversed: true } } })))
    expect(tabOf(gone)).not.toHaveProperty('viewState')
    expectClean(gone)
  })

  it('a column a config already has keeps its sort; a sort that doesn’t read is the repair’s', () => {
    const cols = [{ id: 'overdue', name: 'Late', color: '#e86bf0', filter: emptyPredicate(), litWhen: 'never' }]
    const out = layoutV79Of(one(breakdown({ columns: cols }, { sorts: { people: { by: 'overdue' }, tags: 'garbage' } })))
    expect(tabOf(out).viewState).toEqual({ sorts: { people: { by: 'overdue' }, tags: 'garbage' } })
  })
})

describe('v79 layouts: a Number’s lens switch', () => {
  it('its config’s `ignoreLens` moves to its view state', () => {
    const out = layoutV79Of(one({ id: 'n', kind: 'number', config: { name: 'Open', filter: emptyPredicate(), show: 'count', litWhen: 'never', compare: 'yesterday', ignoreLens: true } }))
    expect(tabOf(out)).toEqual({ id: 'n', kind: 'number', config: { name: 'Open', filter: emptyPredicate(), show: 'count', litWhen: 'never', compare: 'yesterday' }, viewState: { ignoreLens: true } })
    expectClean(out)
  })

  it('a view state that says already wins (as the read had it); the config key goes either way', () => {
    const base = { name: 'Open', filter: emptyPredicate(), show: 'count', litWhen: 'never', compare: 'yesterday' }
    expect(tabOf(layoutV79Of(one({ id: 'n', kind: 'number', config: { ...base, ignoreLens: true }, viewState: { ignoreLens: false } })))).toEqual({ id: 'n', kind: 'number', config: base, viewState: { ignoreLens: false } })
    expect(tabOf(layoutV79Of(one({ id: 'n', kind: 'number', config: { ...base, ignoreLens: false } })))).toEqual({ id: 'n', kind: 'number', config: base })
  })
})

describe('v79 layouts: the rest', () => {
  it('a list tab’s Strips zoom becomes Lines; its details width stays', () => {
    const out = layoutV79Of(one({ id: 'l', kind: 'lens', config: { listDefinitionId: 3 }, viewState: { zoom: 'strips', detailsWidth: 280 } }))
    expect(tabOf(out)).toEqual({ id: 'l', kind: 'lens', config: { listDefinitionId: 3 }, viewState: { zoom: 'lines', detailsWidth: 280 } })
  })

  it('Created vs completed gets its name and Show as where absent; its filter stays absent; what it has stays', () => {
    expect(tabOf(layoutV79Of(one({ id: 't', kind: 'trend', config: { range: '4w' } })))).toEqual({ id: 't', kind: 'trend', config: { range: '4w', name: 'Created vs completed', show: 'bars' } })
    const own = { id: 't', kind: 'trend', config: { range: '14d', name: '', show: 'burndown', filter: emptyPredicate() } }
    expect(tabOf(layoutV79Of(one(own)))).toEqual(own)
    expect(tabOf(layoutV79Of(one({ id: 't', kind: 'trend', config: { range: '14d', show: 'cumulative' } })))).toEqual({ id: 't', kind: 'trend', config: { range: '14d', show: 'cumulative', name: 'Created vs completed' } })
  })

  it('an emoji icon’s `show: muted` goes (the default), on a tab and on the layout; color stays', () => {
    const out = layoutV79Of(one({ id: 'n', kind: 'notes', config: {}, icon: { kind: 'emoji', emoji: '🏠', show: 'muted' } }, { icon: { kind: 'emoji', emoji: '🚀', show: 'muted' } }))
    expect(tabOf(out).icon).toEqual({ kind: 'emoji', emoji: '🏠' })
    expect((out as Obj).icon).toEqual({ kind: 'emoji', emoji: '🚀' })
    const color = one({ id: 'n', kind: 'notes', config: {}, icon: { kind: 'emoji', emoji: '🏠', show: 'color' } })
    expect(layoutV79Of(color)).toBe(color)
  })

  it('a layout’s old lens pick (`lensId`) goes', () => {
    const out = layoutV79Of(one({ id: 'n', kind: 'notes', config: {} }, { lensId: 'lens-a' }))
    expect(out).not.toHaveProperty('lensId')
    expectClean(out)
  })
})

describe('v79 leftovers: the Eisenhower’s list and rows, the Default list zoom', () => {
  const list = (id: number, owner: unknown): DataRow => ({ id, name: `L${id}`, sortOrder: id, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner })

  it('the Eisenhower’s hidden list goes with its manual order; other lists and orders stay', () => {
    const data: DataSet = {
      listDefinitions: [list(1, { layoutId: 1 }), list(2, { eisenhower: true })],
      listOrders: [{ id: 1, listDefinitionId: 1, todoId: 1, rank: 1 }, { id: 2, listDefinitionId: 2, todoId: 1, rank: 1 }],
      layouts: [one({ id: 'l', kind: 'lens', config: { listDefinitionId: 1 } })],
    }
    const out = upgradeLeftoversV79(data)
    expect(out.listDefinitions).toEqual([list(1, { layoutId: 1 })])
    expect(out.listOrders).toEqual([{ id: 1, listDefinitionId: 1, todoId: 1, rank: 1 }])
    expect(out.layouts).toBe(data.layouts)
  })

  it('one a stored layout still names is kept, without that owner (the audit gives it the layout showing it)', () => {
    const data: DataSet = {
      listDefinitions: [list(2, { eisenhower: true })],
      listOrders: [{ id: 2, listDefinitionId: 2, todoId: 1, rank: 1 }],
      layouts: [one({ id: 'l', kind: 'lens', config: { listDefinitionId: 2 } })],
    }
    const out = upgradeLeftoversV79(data)
    expect(out.listDefinitions).toEqual([{ id: 2, name: 'L2', sortOrder: 2, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() } }])
    expect(out.listOrders).toBe(data.listOrders)
  })

  it('its settings rows go; the Default list zoom’s older values become levels; the rest stay', () => {
    const settings = [
      { key: 'eisenhowerPanes', value: '{}' }, { key: 'eisenhowerSource', value: 'list:2' },
      { key: 'rowDensity', value: 'strips' }, { key: 'historyLogSince', value: DATE }, { key: 'tabBadgeDue', value: '7' },
    ]
    expect(upgradeLeftoversV79({ settings }).settings).toEqual([
      { key: 'rowDensity', value: 'lines' }, { key: 'historyLogSince', value: DATE }, { key: 'tabBadgeDue', value: '7' },
    ])
    expect(upgradeLeftoversV79({ settings: [{ key: 'rowDensity', value: 'comfortable' }] }).settings).toEqual([{ key: 'rowDensity', value: 'stacked' }])
    expect(upgradeLeftoversV79({ settings: [{ key: 'rowDensity', value: 'compact' }] }).settings).toEqual([{ key: 'rowDensity', value: 'rows' }])
  })

  it('names of Object.prototype members are no old value and no id it knows: left as they are (cr34 S2)', () => {
    // A zoom value naming one is no old level: the row passes through (for validation), never a function as its value.
    for (const value of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const data = { settings: [{ key: 'rowDensity', value }] }
      expect(upgradeLeftoversV79(data)).toBe(data)
    }
    // A sort by one names no older derived column: dropped, as any sort by a column the Breakdown lacks.
    const sorted = (by: string) => one({ id: 'b', kind: 'breakdown', config: { name: 'B', columns: [] }, viewState: { sorts: { people: { by }, tags: { by: 'name' } } } })
    for (const by of ['constructor', '__proto__', 'valueOf']) {
      expect(tabOf(layoutV79Of(sorted(by))).viewState).toEqual({ sorts: { tags: { by: 'name' } } })
    }
    // Tab, cell and track ids named so go through the tab walk untouched: a kept tab stays, a removed kind's goes.
    const row = layout({
      grid: { columns: [{ id: 'toString', weight: 500 }, { id: 'valueOf', weight: 500 }], rows: [{ id: 'hasOwnProperty', weight: 1000 }] },
      cells: [
        { id: 'constructor', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [raw({ id: '__proto__', kind: 'notes', config: {} })] },
        { id: 'isPrototypeOf', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [raw({ id: 'propertyIsEnumerable', kind: 'eisenhower', config: {} })] },
      ],
    } as LayoutBody)
    const out = layoutV79Of(row) as unknown as LayoutBody
    expect(out.cells.map((c) => [c.id, c.tabs.map((t) => t.id)])).toEqual([['constructor', ['__proto__']]])
    expect(out.grid).toEqual({ columns: [{ id: 'toString', weight: 1000 }], rows: [{ id: 'hasOwnProperty', weight: 1000 }] })
  })
})

describe('v79: the contract', () => {
  /** A v78 dataset holding every shape v79 rewrites. */
  function v78(): DataSet {
    const k1 = cell('k1', [
      raw({ id: 'r', kind: 'review', config: { by: 'tag' }, viewState: { currentId: 2 } }),
      raw(breakdown({ badges: { due: 'overdue' }, checkins: true }, { sorts: { people: { by: 'due-soon' } } })),
      raw({ id: 'n', kind: 'number', config: { name: 'N', filter: emptyPredicate(), show: 'count', litWhen: 'never', compare: 'none', ignoreLens: true } }),
      raw({ id: 'l', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'strips' } }),
      raw({ id: 't', kind: 'trend', config: { range: '14d' } }),
    ])
    const k2 = cell('k2', [raw({ id: 'e', kind: 'eisenhower', config: {} })])
    return {
      todos: [{ id: 1, uid: 'u1', title: 'T', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
      todoEvents: [{ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: DATE }],
      settings: [{ key: 'historyLogSince', value: DATE }, { key: 'eisenhowerPanes', value: '{}' }, { key: 'tabBadgeFollowup', value: '7' }, { key: 'rowDensity', value: 'compact' }],
      listDefinitions: [{ id: 1, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: 1 } }, { id: 2, name: 'Eisenhower', sortOrder: 1, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { eisenhower: true } }],
      listOrders: [{ id: 1, listDefinitionId: 2, todoId: 1, rank: 1 }],
      layouts: [layout(grid([[k1, k2]]), { lensId: 'x' })],
    }
  }

  it('writes every shape at once, from the data’s own Settings ranges', () => {
    const out = upgradeV79(v78())
    const row = out.layouts![0]!
    expect(picture(row as unknown as LayoutBody)).toEqual(['k1'])
    const tabs = tabsOf(row, 'k1') as unknown as Obj[]
    expect(tabs.map((t) => t.id)).toEqual(['r', 'b', 'n', 'l', 't'])
    expect((tabs[1]!.config as Obj).columns).toEqual([
      { id: 'due', name: 'Due', color: '#e86bf0', filter: by('deadline', -1), litWhen: 'above', litAt: 0 },
      { id: 'followup', name: 'Follow-up', color: '#f5c842', filter: by('followup', 7), litWhen: 'above', litAt: 0 },
    ])
    expect(tabs[1]!.viewState).toEqual({ sorts: { people: { by: 'due' } } })
    expect(out.listDefinitions!.map((d) => d.id)).toEqual([1])
    expect(out.listOrders).toEqual([])
    expect(out.settings).toEqual([{ key: 'historyLogSince', value: DATE }, { key: 'tabBadgeFollowup', value: '7' }, { key: 'rowDensity', value: 'rows' }])
    expectClean(row)
  })

  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const input = v78()
    const before = JSON.stringify(input)
    const once = upgradeV79(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(upgradeV79(once)).toBe(once)
  })

  it('touches no task, no history and not the history log’s start', () => {
    const input = v78()
    const out = upgradeV79(input)
    expect(out.todos).toBe(input.todos)
    expect(out.todoEvents).toBe(input.todoEvents)
    expect(out.settings!.find((r) => r.key === 'historyLogSince')).toEqual({ key: 'historyLogSince', value: DATE })
  })

  it('tolerates missing tables and malformed rows (left for validation)', () => {
    const empty: DataSet = {}
    expect(upgradeV79(empty)).toBe(empty)
    const tasksOnly: DataSet = { todos: [{ id: 1 }] }
    expect(upgradeV79(tasksOnly)).toBe(tasksOnly)
    const odd: DataSet = {
      layouts: [{ id: 1, cells: 'none' }, { id: 2, cells: [null, { id: 'k', tabs: [7, { id: 't', kind: 'breakdown', config: 'x' }, { id: 'u', kind: 'number' }] }] }],
      settings: [null as unknown as DataRow, { key: 'rowDensity', value: 3 }],
      listDefinitions: [null as unknown as DataRow, { id: 1, owner: 'eisenhower' }],
    }
    expect(upgradeV79(odd)).toBe(odd)
  })
})

describe('v79 through the pipeline', () => {
  it('a v78 file imports with every shape written and nothing left to repair', () => {
    const data = v78File()
    const result = prepareImport(JSON.parse(JSON.stringify(data)))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.data.listDefinitions.map((d) => d.id)).toEqual([1])
    expect(result.data.settings.map((s) => s.key)).toEqual(['activeLayoutId'])
    expect(result.data.layouts[0]!.cells.flatMap((c) => c.tabs).map((t) => t.kind)).toEqual(['lens', 'notes'])
  })

  it('a file at the floor (v68) runs the whole chain to v79', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: 68,
      todos: [{ id: 1, uid: 'u1', title: 'Old', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
      settings: [{ key: 'eisenhowerSource', value: 'all' }, { key: 'rowDensity', value: 'comfortable' }],
      listDefinitions: [
        { id: 1, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: 1 } },
        { id: 2, name: 'Eisenhower', sortOrder: 1, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { eisenhower: true } },
      ],
      layouts: [{
        id: 1, name: 'Daily', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
        columns: [
          { id: 'A', weight: 1, cells: [{ id: 'a', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'strips' } }] }] },
          { id: 'B', weight: 1, cells: [{ id: 'b', weight: 1, tabs: [{ id: 'n', kind: 'notes', config: {} }] }] },
        ],
      }],
    }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.sourceVersion).toBe(68)
    expect(result.warnings).toEqual([])
    expect(result.data.listDefinitions.map((d) => d.id)).toEqual([1])
    expect(result.data.settings).toEqual([{ key: 'rowDensity', value: 'stacked' }])
    const tabs = result.data.layouts[0]!.cells.flatMap((c) => c.tabs)
    expect(tabs).toEqual([{ id: 'l', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'lines' } }, notes('n')])
    // The same through the registry alone.
    const chained = upgradeDataSet(JSON.parse(JSON.stringify(file)) as DataSet, 68, CURRENT_DB_VERSION)
    expect(chained.listDefinitions!.map((d) => d.id)).toEqual([1])
  })

  it('a layout draft kept at v78 reads back in the v79 shape, its base as the stored layout upgrades to', () => {
    const k = cell('k', [raw({ id: 'l', kind: 'lens', config: { listDefinitionId: 4 }, viewState: { zoom: 'strips' } }), raw({ id: 'e', kind: 'eisenhower', config: {} })])
    const body = grid([[k]])
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: 1, schemaVersion: 78, grid: body.grid, cells: body.cells, baseGrid: body.grid, baseCells: body.cells }))
    const draft = readLayoutDraft()
    expect(draft?.kind).toBe('saved')
    if (draft?.kind !== 'saved') return
    expect(draft.body.cells.flatMap((c) => c.tabs)).toEqual([{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 }, viewState: { zoom: 'lines' } }])
    const stored = layoutV79Of(layout(body)) as unknown as LayoutBody
    expect(draft.base).toEqual({ grid: stored.grid, cells: stored.cells })
  })

  it('a list draft of the Eisenhower’s list kept at v78 is dropped (nothing shows that list); another reads back', () => {
    const def = (id: number, owner: unknown) => ({ id, name: `L${id}`, sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner })
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      2: { draft: def(2, { eisenhower: true }), base: def(2, { eisenhower: true }), schemaVersion: 78 },
      4: { draft: def(4, { layoutId: 1 }), base: def(4, { layoutId: 1 }), schemaVersion: 78 },
    }))
    expect([...readListDrafts().keys()]).toEqual([4])
  })
})

/** A v78 export holding the retired parts beside a layout's own list. */
function v78File(): Obj {
  return {
    [SCHEMA_VERSION_KEY]: 78,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
    settings: [{ key: 'activeLayoutId', value: '1' }, { key: 'eisenhowerPanes', value: '{"do":{}}' }, { key: 'eisenhowerSource', value: 'list:2' }],
    listDefinitions: [
      { id: 1, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: 1 } },
      { id: 2, name: 'Eisenhower', sortOrder: 1, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { eisenhower: true } },
    ],
    listOrders: [{ id: 1, listDefinitionId: 2, todoId: 1, rank: 1 }],
    layouts: [layout(grid([[cell('k1', [raw({ id: 'mine', kind: 'lens', config: { listDefinitionId: 1 } })]), cell('k2', [raw({ id: 'eis', kind: 'eisenhower', config: {} }), notes('n')])]]))],
  }
}
