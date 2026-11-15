import { describe, expect, it } from 'vitest'
import { upgradeV81 } from '../../data/upgrades/v81'
import { CURRENT_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { rowFixes, validateRow } from '../../data/import-validation'

/**
 * v81 — lenses removed (user feedback 2026-11-15): the `lenses`,
 * `activeLensId` and `lensPresetsSeeded` settings rows deleted, the lens
 * shortcuts out of the `keyboardShortcuts` row, and every list's and layout
 * tab's `ignoreLens` gone. The transform's own tests, then the pipeline
 * from v80 and from the floor; the browser database's own upgrade and the
 * real ways in are `v81-real-paths.test`.
 */

const DATE = '2026-11-01T09:00:00.000Z'
const LENSES = JSON.stringify([{ id: 'lens-a', name: 'Aisha', predicate: { showCompleted: false, personIds: [1], statusIds: null, searchText: '', dates: {}, markers: null, tags: null } }])

/** A list definition row, `extra` merged in. */
function list(id: number, extra: DataRow = {}): DataRow {
  return {
    id,
    name: `List ${id}`,
    sortOrder: id,
    membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
    sort: 'manual',
    grouping: 'none',
    owner: { layoutId: 1 },
    ...extra,
  }
}

/** A layout of one row of cells, each holding `tabs`. */
function layout(cells: DataRow[][]): DataRow {
  return {
    id: 1,
    name: 'Main',
    sortOrder: 0,
    grid: { columns: cells.map((_, i) => ({ id: `c${i}`, weight: 1 })), rows: [{ id: 'r0', weight: 1 }] },
    cells: cells.map((tabs, i) => ({ id: `k${i}`, area: { col: i, row: 0, colSpan: 1, rowSpan: 1 }, tabs, activeTabId: tabs[0]?.id })),
    createdAt: DATE,
    modifiedAt: DATE,
  }
}

describe('v81: registered', () => {
  it('is the current schema, after v80', () => {
    expect(CURRENT_DB_VERSION).toBe(81)
    expect(SCHEMA_UPGRADES.get(81)).toBe(upgradeV81)
  })
})

describe('v81: settings', () => {
  it('the lens rows go; every other row stays, in order', () => {
    const out = upgradeV81({
      settings: [
        { key: 'historyLogSince', value: DATE },
        { key: 'lenses', value: LENSES },
        { key: 'activeLensId', value: 'lens-a' },
        { key: 'lensPresetsSeeded', value: 'true' },
        { key: 'weekStartsOn', value: '1' },
      ],
    })
    expect(out.settings).toEqual([
      { key: 'historyLogSince', value: DATE },
      { key: 'weekStartsOn', value: '1' },
    ])
  })

  it('the keyboard shortcuts lose the lens bindings and keep the rest', () => {
    const out = upgradeV81({
      settings: [{ key: 'keyboardShortcuts', value: JSON.stringify({ 'cycle-lens': 'l', 'focus-filters': 'n', 'lift-lens': 'k' }) }],
    })
    expect(out.settings).toEqual([{ key: 'keyboardShortcuts', value: JSON.stringify({ 'focus-filters': 'n' }) }])
  })

  it('a shortcut row naming no lens binding, or one that doesn’t read, is left as it is', () => {
    const clean = { key: 'keyboardShortcuts', value: JSON.stringify({ 'focus-filters': 'n' }) }
    const input: DataSet = { settings: [clean] }
    expect(upgradeV81(input)).toBe(input)
    const odd: DataSet = { settings: [{ key: 'keyboardShortcuts', value: 'not json' }, { key: 'keyboardShortcuts', value: 7 }] }
    expect(upgradeV81(odd)).toBe(odd)
  })
})

describe('v81: lists and layouts', () => {
  it('every list loses its lens switch; the rest of the row stays', () => {
    const out = upgradeV81({ listDefinitions: [list(1, { ignoreLens: true }), list(2)] })
    expect(out.listDefinitions).toEqual([list(1), list(2)])
    for (const row of out.listDefinitions!) {
      expect(validateRow('listDefinitions', row)).toBe(true)
      expect(rowFixes('listDefinitions', row)).toEqual([])
    }
  })

  it('every tab’s view state loses its lens switch; a view state left empty goes, the others keep their keys', () => {
    const out = upgradeV81({
      layouts: [layout([
        [
          { id: 'cal', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', ignoreLens: true } },
          { id: 'num', kind: 'number', config: { name: 'Open' }, viewState: { ignoreLens: false } },
        ],
        [
          { id: 'rv', kind: 'review', config: {}, viewState: { sort: 'due', ignoreLens: true } },
          { id: 'list', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'rows' } },
        ],
      ])],
    })
    const tabs = (out.layouts![0]!.cells as DataRow[]).flatMap((c) => c.tabs as DataRow[])
    expect(tabs).toEqual([
      { id: 'cal', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week' } },
      { id: 'num', kind: 'number', config: { name: 'Open' } },
      { id: 'rv', kind: 'review', config: {}, viewState: { sort: 'due' } },
      { id: 'list', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'rows' } },
    ])
    // The cells and the grid are as they were: no tab dropped, no cell closed.
    expect(out.layouts![0]!.grid).toEqual(layout([[], []]).grid)
    expect((out.layouts![0]!.cells as DataRow[]).map((c) => c.activeTabId)).toEqual(['cal', 'rv'])
  })
})

describe('v81: the contract', () => {
  function v80(): DataSet {
    return {
      todos: [{ id: 1, uid: 'u1', title: 'T', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
      todoEvents: [{ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: DATE }],
      listDefinitions: [list(1, { ignoreLens: true })],
      layouts: [layout([[{ id: 'pv', kind: 'pivot', config: {}, viewState: { ignoreLens: true } }]])],
      settings: [{ key: 'historyLogSince', value: DATE }, { key: 'lenses', value: LENSES }, { key: 'activeLensId', value: 'lens-a' }],
    }
  }

  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const input = v80()
    const before = JSON.stringify(input)
    const once = upgradeV81(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(once).not.toBe(input)
    expect(upgradeV81(once)).toBe(once)
  })

  it('touches no task, no history and not the history log’s start', () => {
    const input = v80()
    const out = upgradeV81(input)
    expect(out.todos).toBe(input.todos)
    expect(out.todoEvents).toBe(input.todoEvents)
    expect(out.settings).toEqual([{ key: 'historyLogSince', value: DATE }])
  })

  it('a table with nothing to change comes back as the same array', () => {
    const input: DataSet = {
      listDefinitions: [list(1)],
      layouts: [layout([[{ id: 'n', kind: 'notes', config: {} }]])],
      settings: [{ key: 'weekStartsOn', value: '0' }],
    }
    expect(upgradeV81(input)).toBe(input)
  })

  it('tolerates missing tables and malformed rows (left for validation)', () => {
    const empty: DataSet = {}
    expect(upgradeV81(empty)).toBe(empty)
    const odd: DataSet = {
      listDefinitions: [null as unknown as DataRow, 7 as unknown as DataRow, { id: 3, ignoreLens: 'yes' }],
      layouts: [null as unknown as DataRow, { id: 2, cells: 'none' }, { id: 3, cells: [null, { tabs: [null, { id: 't', viewState: { ignoreLens: 1 } }] }] }],
      settings: [null as unknown as DataRow, { key: 'lenses', value: 9 }, { value: 'x' }],
    }
    const out = upgradeV81(odd)
    expect(out.listDefinitions).toEqual([null, 7, { id: 3 }])
    expect(out.layouts).toEqual([null, { id: 2, cells: 'none' }, { id: 3, cells: [null, { tabs: [null, { id: 't' }] }] }])
    expect(out.settings).toEqual([null, { value: 'x' }])
  })
})

describe('v81 through the pipeline', () => {
  it('a v80 file imports without its lenses, the pick or any lens switch, and no warning about them', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v80File())))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.data.settings.map((s) => s.key)).toEqual(['weekStartsOn'])
    expect(result.data.listDefinitions.every((d) => !('ignoreLens' in d))).toBe(true)
    const text = JSON.stringify(result.data.layouts)
    expect(text).not.toContain('ignoreLens')
  })

  it('a v81 file still holding a lens switch reads without it, quietly — no warning', () => {
    // (A lens settings row in a v81 file is a key this build doesn't know, ignored as any such row is.)
    const file = { ...JSON.parse(JSON.stringify(v80File())) as Record<string, unknown>, settings: [{ key: 'weekStartsOn', value: '1' }] }
    const result = prepareImport({ ...file, [SCHEMA_VERSION_KEY]: 81 })
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(false)
    expect(result.warnings).toEqual([])
    expect(result.data.listDefinitions.every((d) => !('ignoreLens' in d))).toBe(true)
    expect(JSON.stringify(result.data.layouts)).not.toContain('ignoreLens')
  })

  it('a file at the floor (v68) runs the whole chain to v81', () => {
    const file = { ...v80File(), [SCHEMA_VERSION_KEY]: 68 }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.sourceVersion).toBe(68)
    expect(result.data.settings.map((s) => s.key)).toEqual(['weekStartsOn'])
    const chained = upgradeDataSet(JSON.parse(JSON.stringify(file)) as DataSet, 68, CURRENT_DB_VERSION)
    expect(chained.settings!.map((s) => s.key)).toEqual(['weekStartsOn'])
    expect(chained.listDefinitions!.every((d) => !('ignoreLens' in d))).toBe(true)
  })
})

/** A v80 export with lenses, a pick, a lens shortcut and lens switches on a list and a tab. */
function v80File(): Record<string, unknown> {
  return {
    [SCHEMA_VERSION_KEY]: 80,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
    listDefinitions: [list(1, { ignoreLens: true })],
    layouts: [layout([
      [{ id: 'list', kind: 'lens', config: { listDefinitionId: 1 } }],
      [{ id: 'cal', kind: 'calendar', config: { dateTypes: { due: true, followup: true } }, viewState: { ignoreLens: true } }],
    ])],
    settings: [
      { key: 'lenses', value: LENSES },
      { key: 'activeLensId', value: 'lens-a' },
      { key: 'lensPresetsSeeded', value: 'true' },
      { key: 'weekStartsOn', value: '1' },
    ],
  }
}
