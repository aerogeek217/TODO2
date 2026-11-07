import { describe, expect, it } from 'vitest'
import { upgradeV77 } from '../../data/upgrades/v77-dashboard-widgets'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft } from '../../data/draft-storage'
import { rowFixes } from '../../data/import-validation'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { layoutListRefs } from '../../utils/workspace-layout-ops'
import type { LayoutBody } from '../../models/workspace-layout'

const DATE = '2026-11-01T09:00:00.000Z'
type Obj = Record<string, unknown>
const notes = (id: string) => ({ id, kind: 'notes', config: {} })
const dash = (id: string, config: Obj = {}, extra: Obj = {}) => ({ id, kind: 'dashboard', config, ...extra })
const layout = (body: Obj, id = 1): DataRow => ({ id, name: 'Daily', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body })
const upgraded = (row: DataRow): DataRow => upgradeV77({ layouts: [row] }).layouts![0]!
const one = (rowId: string, cellId: string, tabs: unknown[], extra: Obj = {}) => ({ id: rowId, weight: 1, ...extra, cells: [{ id: cellId, weight: 1, tabs }] })
const numberCell = (d: string, i: number, metric: string) => ({ id: `${d}-c${i}`, weight: 1, tabs: [{ id: `${d}-n${i}`, kind: 'number', config: { metric } }] })
const partCell = (d: string, i: number, weight: number, kind: string, config: Obj = {}, extra: Obj = {}) => ({ id: `${d}-c${i}`, weight, tabs: [{ id: `${d}-n${i}`, kind, config, ...extra }] })
const rowsOf = (out: DataRow, col = 0) => (out.columns as Array<{ rows: Obj[] }>)[col]!.rows
const noFixes = (out: DataRow) => expect(rowFixes('layouts', out)).toEqual([])

describe('v77 — the Dashboard as widgets', () => {
  it('is registered as the v77 step', () => {
    expect(SCHEMA_UPGRADES.get(77)).toBe(upgradeV77)
  })

  it('a Dashboard alone in its cell: its row becomes a row of Numbers and its sections packed into rows, sharing the row’s weight', () => {
    const before = layout({
      columns: [{ id: 'A', weight: 1, rows: [
        one('top-r', 'top', [notes('t1')]),
        // A new Dashboard's config: every part absent takes the default.
        { id: 'k-r', weight: 4, cells: [{ id: 'k', weight: 1, tabs: [dash('d')] }] },
        one('end-r', 'end', [notes('t2')]),
      ] }],
    })
    const out = upgraded(before)
    expect(rowsOf(out)).toEqual([
      one('top-r', 'top', [notes('t1')]),
      // The five default tiles, a fit row (weight 1, unused).
      { id: 'd-r1', weight: 1, cells: [
        numberCell('d', 1, 'open'), numberCell('d', 2, 'focus'), numberCell('d', 3, 'urgent'), numberCell('d', 4, 'overdue'), numberCell('d', 5, 'followupDue'),
      ] },
      // The default sections as the Dashboard packed them: 4 + 3 + 5, then 3 + 4 (stretched to 9).
      { id: 'd-r2', weight: 2, cells: [
        partCell('d', 6, 4, 'followup', { lookAhead: 7 }), partCell('d', 7, 3, 'next7'), partCell('d', 8, 5, 'trend', { range: '14d' }),
      ] },
      { id: 'd-r3', weight: 2, cells: [partCell('d', 9, 3, 'status'), partCell('d', 10, 9, 'people', { showUnassigned: true })] },
      one('end-r', 'end', [notes('t2')]),
    ])
    noFixes(out)
  })

  it('more than six Numbers go six to a row', () => {
    const tiles = ['open', 'focus', 'urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup']
    const out = upgraded(layout({ columns: [{ id: 'A', weight: 1, rows: [one('k-r', 'k', [dash('d', { tiles, sections: [] })])] }] }))
    expect(rowsOf(out).map((r) => (r.cells as unknown[]).length)).toEqual([6, 2])
    expect(rowsOf(out).map((r) => r.id)).toEqual(['d-r1', 'd-r2'])
    noFixes(out)
  })

  it('list tiles become a short row of List tabs on those lists, and section options their widgets’ configs', () => {
    const before = layout({
      columns: [{ id: 'A', weight: 1, rows: [{ id: 'k-r', weight: 3, cells: [{ id: 'k', weight: 1, tabs: [dash('d', {
        tiles: ['overdue', 'bogus', 'overdue'],
        listTiles: [4, 4, 7, -1, 'x'],
        sections: [
          { id: 'stale', options: { staleDays: 30 } },
          { id: 'trend', options: { range: '4w', lookAhead: 3 } },
          { id: 'eisenhower' },
          // An option out of range takes the default.
          { id: 'followup', options: { lookAhead: 99 } },
          { id: 'people', options: { showUnassigned: false } },
          { id: 'tags', options: { showUntagged: false } },
          { id: 'recent', options: { recentDays: 30 } },
          { id: 'stale' },
          { id: 'nope' },
          'junk',
        ],
      }, { viewState: { detailsWidth: 320 } })] }] }] }],
    })
    const out = upgraded(before)
    // Shares: the list row a quarter, each of the three section rows one — of the old weight 3.
    const share = (3 * 1) / 3.25
    const rows = rowsOf(out)
    expect(rows).toEqual([
      { id: 'd-r1', weight: 1, cells: [numberCell('d', 1, 'overdue')] },
      { id: 'd-r2', weight: (3 * 0.25) / 3.25, cells: [partCell('d', 2, 1, 'lens', { listDefinitionId: 4 }), partCell('d', 3, 1, 'lens', { listDefinitionId: 7 })] },
      { id: 'd-r3', weight: share, cells: [
        partCell('d', 4, 5, 'stale', { staleDays: 30 }, { viewState: { detailsWidth: 320 } }),
        partCell('d', 5, 7, 'trend', { range: '4w' }),
      ] },
      { id: 'd-r4', weight: share, cells: [
        partCell('d', 6, 3, 'eisenhowerSummary'),
        partCell('d', 7, 4, 'followup', { lookAhead: 7 }, { viewState: { detailsWidth: 320 } }),
        partCell('d', 8, 5, 'people', { showUnassigned: false }),
      ] },
      { id: 'd-r5', weight: share, cells: [
        partCell('d', 9, 4, 'tags', { showUntagged: false }),
        partCell('d', 10, 8, 'recent', { recentDays: 30 }, { viewState: { detailsWidth: 320 } }),
      ] },
    ])
    // The layout still names the lists it showed.
    expect([...layoutListRefs(out as unknown as LayoutBody)].sort()).toEqual([4, 7])
    noFixes(out)
  })

  it('a Dashboard sharing its cell: the cell keeps its other tabs, the new rows go below it, the kept row one share', () => {
    const config = { tiles: ['open'], sections: [{ id: 'trend' }] }
    const before = layout({
      columns: [{ id: 'A', weight: 1, rows: [
        { id: 'k-r', weight: 2, cells: [{ id: 'k', weight: 1, activeTabId: 'd', tabs: [notes('n1'), dash('d', config), notes('n2')] }] },
        one('end-r', 'end', [notes('t2')]),
      ] }],
    })
    const out = upgraded(before)
    expect(rowsOf(out)).toEqual([
      // The Dashboard was active: the next tab is.
      { id: 'k-r', weight: 1, cells: [{ id: 'k', weight: 1, activeTabId: 'n2', tabs: [notes('n1'), notes('n2')] }] },
      { id: 'd-r1', weight: 1, cells: [numberCell('d', 1, 'open')] },
      { id: 'd-r2', weight: 1, cells: [partCell('d', 2, 12, 'trend', { range: '14d' })] },
      one('end-r', 'end', [notes('t2')]),
    ])
    noFixes(out)
  })

  it('a cell whose active tab isn’t the Dashboard keeps it; a last Dashboard that was active hands over to the tab before it', () => {
    const config = { tiles: ['open'], sections: [] }
    const keeps = upgraded(layout({ columns: [{ id: 'A', weight: 1, rows: [
      { id: 'k-r', weight: 1, cells: [{ id: 'k', weight: 1, activeTabId: 'n1', tabs: [notes('n1'), dash('d', config)] }] },
    ] }] }))
    expect(rowsOf(keeps)[0]!.cells).toEqual([{ id: 'k', weight: 1, activeTabId: 'n1', tabs: [notes('n1')] }])
    const before = upgraded(layout({ columns: [{ id: 'A', weight: 1, rows: [
      { id: 'k-r', weight: 1, cells: [{ id: 'k', weight: 1, activeTabId: 'd', tabs: [notes('n1'), notes('n2'), dash('d', config)] }] },
    ] }] }))
    expect(rowsOf(before)[0]!.cells).toEqual([{ id: 'k', weight: 1, activeTabId: 'n2', tabs: [notes('n1'), notes('n2')] }])
    // No active tab named: the first tab is active — the Dashboard, so the next one is named.
    const first = upgraded(layout({ columns: [{ id: 'A', weight: 1, rows: [
      { id: 'k-r', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [dash('d', config), notes('n1')] }] },
    ] }] }))
    expect(rowsOf(first)[0]!.cells).toEqual([{ id: 'k', weight: 1, activeTabId: 'n1', tabs: [notes('n1')] }])
  })

  it('a Dashboard alone in a cell of a row with other cells: the cell goes, the row keeps the rest, the new rows go below', () => {
    const before = layout({ columns: [{ id: 'A', weight: 1, rows: [
      { id: 'R', weight: 2, cells: [{ id: 'x', weight: 1, tabs: [notes('n1')] }, { id: 'k', weight: 1, tabs: [dash('d', { tiles: [], sections: [{ id: 'status' }] })] }] },
    ] }] })
    const out = upgraded(before)
    expect(rowsOf(out)).toEqual([
      { id: 'R', weight: 1, cells: [{ id: 'x', weight: 1, tabs: [notes('n1')] }] },
      { id: 'd-r1', weight: 1, cells: [partCell('d', 1, 12, 'status')] },
    ])
    noFixes(out)
  })

  it('a collapsed row’s new rows are collapsed', () => {
    const out = upgraded(layout({ columns: [{ id: 'A', weight: 1, rows: [
      one('top-r', 'top', [notes('t1')]),
      { id: 'k-r', weight: 1, collapsed: true, cells: [{ id: 'k', weight: 1, tabs: [dash('d', { tiles: ['open'], sections: [{ id: 'status' }] })] }] },
    ] }] }))
    expect(rowsOf(out).map((r) => [r.id, r.collapsed])).toEqual([['top-r', undefined], ['d-r1', true], ['d-r2', true]])
    noFixes(out)
  })

  it('a Dashboard in a band: each part a cell of the band’s row, side by side — a Number 1, a list tile 2, a section its span', () => {
    const before = layout({
      columns: [],
      top: { id: 'T', height: 220, collapsed: true, cells: [{ id: 'k', weight: 1, tabs: [dash('d', {
        tiles: ['dueToday', 'open'], listTiles: [9], sections: [{ id: 'followup', options: { lookAhead: 3 } }, { id: 'next7' }],
      }, { viewState: { detailsWidth: 200 } })] }] },
    })
    const out = upgraded(before)
    expect(out.top).toEqual({ id: 'T', height: 220, collapsed: true, cells: [
      numberCell('d', 1, 'dueToday'),
      numberCell('d', 2, 'open'),
      partCell('d', 3, 2, 'lens', { listDefinitionId: 9 }),
      partCell('d', 4, 4, 'followup', { lookAhead: 3 }, { viewState: { detailsWidth: 200 } }),
      partCell('d', 5, 3, 'next7'),
    ] })
    noFixes(out)
  })

  it('in a band beside other cells (or sharing its cell), the parts share what the Dashboard’s cell had', () => {
    const config = { tiles: ['open'], sections: [{ id: 'status' }] }
    const out = upgraded(layout({
      columns: [],
      bottom: { id: 'B', height: 160, cells: [{ id: 'x', weight: 1, tabs: [notes('n1')] }, { id: 'k', weight: 2, tabs: [dash('d', config)] }] },
      top: { id: 'T', height: 160, cells: [{ id: 'm', weight: 1, activeTabId: 'e', tabs: [notes('n2'), dash('e', config)] }] },
    }))
    expect(out.bottom).toEqual({ id: 'B', height: 160, cells: [
      { id: 'x', weight: 1, tabs: [notes('n1')] },
      { ...numberCell('d', 1, 'open'), weight: 0.5 },
      partCell('d', 2, 1.5, 'status'),
    ] })
    expect(out.top).toEqual({ id: 'T', height: 160, cells: [
      { id: 'm', weight: 1, activeTabId: 'n2', tabs: [notes('n2')] },
      { ...numberCell('e', 1, 'open'), weight: 0.25 },
      partCell('e', 2, 0.75, 'status'),
    ] })
    noFixes(out)
  })

  it('a Dashboard with no parts just goes, and so does a cell, row, column or band left empty', () => {
    const none = { tiles: [], listTiles: [], sections: [] }
    const out = upgraded(layout({
      columns: [
        { id: 'A', weight: 1, rows: [one('a1-r', 'a1', [dash('d1', none)])] },
        { id: 'B', weight: 1, rows: [
          one('b1-r', 'b1', [notes('n1')], { collapsed: true }),
          one('b2-r', 'b2', [dash('d2', none)]),
          one('b3-r', 'b3', [notes('n2'), dash('d3', none)]),
          one('b4-r', 'b4', [notes('n3')], { collapsed: true }),
        ] },
      ],
      top: { id: 'T', height: 160, cells: [{ id: 't1', weight: 1, tabs: [dash('d4', none)] }] },
      bottom: { id: 'X', height: 160, cells: [{ id: 'x1', weight: 1, tabs: [dash('d5', none)] }, { id: 'x2', weight: 1, tabs: [notes('n4')] }] },
    }))
    expect(out.columns).toEqual([{ id: 'B', weight: 1, rows: [
      one('b1-r', 'b1', [notes('n1')], { collapsed: true }),
      one('b3-r', 'b3', [notes('n2')]),
      one('b4-r', 'b4', [notes('n3')], { collapsed: true }),
    ] }])
    expect(out).not.toHaveProperty('top')
    expect(out.bottom).toEqual({ id: 'X', height: 160, cells: [{ id: 'x2', weight: 1, tabs: [notes('n4')] }] })
    noFixes(out)
  })

  it('a column left with only collapsed rows expands the row above the one that went', () => {
    const none = { tiles: [], listTiles: [], sections: [] }
    const out = upgraded(layout({ columns: [{ id: 'A', weight: 1, rows: [
      one('a-r', 'a', [notes('n1')], { collapsed: true }),
      one('b-r', 'b', [notes('n2')], { collapsed: true }),
      one('k-r', 'k', [dash('d', none)]),
    ] }] }))
    expect(rowsOf(out)).toEqual([one('a-r', 'a', [notes('n1')], { collapsed: true }), one('b-r', 'b', [notes('n2')])])
  })

  it('a fresh id never repeats one the layout holds, at any level, nor another fresh one; the same layout upgrades to the same ids', () => {
    const before = layout({
      columns: [
        { id: 'd-r1', weight: 1, rows: [one('d-c1', 'd-n1', [notes('d-n2'), dash('d', { tiles: ['open', 'focus'], sections: [{ id: 'status' }] })])] },
      ],
    })
    const out = upgraded(before)
    const rows = rowsOf(out)
    expect(rows.map((r) => r.id)).toEqual(['d-c1', 'd-r1_2', 'd-r2'])
    const cells = rows.slice(1).flatMap((r) => r.cells as Array<{ id: string; tabs: Array<{ id: string }> }>)
    expect(cells.map((c) => [c.id, c.tabs[0]!.id])).toEqual([['d-c1_2', 'd-n1_2'], ['d-c2', 'd-n2_2'], ['d-c3', 'd-n3']])
    noFixes(out)
    expect(upgraded(before)).toEqual(out)
  })

  it('a fresh id stays within the longest id a part may have', () => {
    const long = 'x'.repeat(100)
    const out = upgraded(layout({ columns: [{ id: 'A', weight: 1, rows: [one('k-r', 'k', [dash(long, { tiles: ['open'], sections: [] })])] }] }))
    const [row] = rowsOf(out)
    expect(row!.id).toBe(`${'x'.repeat(97)}-r1`)
    noFixes(out)
  })

  it('leaves a layout without a Dashboard, and every other table, as they are; passes through what it can’t read', () => {
    const plain = { layouts: [layout({ columns: [{ id: 'A', weight: 1, rows: [one('k-r', 'k', [notes('n')])] }] })], todos: [] }
    expect(upgradeV77(plain)).toBe(plain)
    const none = { todos: [] }
    expect(upgradeV77(none)).toBe(none)
    const odd = layout({ columns: ['not a column', { id: 'A', weight: 1, rows: ['nope', { id: 'R', weight: 1, cells: 'x' }, one('k-r', 'k', [dash('d', 'bad config' as unknown as Obj)])] }], top: 7 })
    const out = upgraded(odd)
    const cols = out.columns as unknown[]
    expect(cols[0]).toBe('not a column')
    // A config that isn't an object reads as a new Dashboard's.
    expect((cols[1] as { rows: unknown[] }).rows.slice(0, 2)).toEqual(['nope', { id: 'R', weight: 1, cells: 'x' }])
    expect((cols[1] as { rows: unknown[] }).rows).toHaveLength(5)
    expect(out.top).toBe(7)
  })

  it('a v75 export imports through v76 and v77: its Dashboard arrives as widgets', () => {
    const file = {
      [SCHEMA_VERSION_KEY]: 75,
      todos: [],
      settings: [],
      layouts: [layout({
        columns: [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 2, tabs: [dash('d', { tiles: ['overdue'], listTiles: [], sections: [{ id: 'eisenhower' }] })] }] }],
      })],
    }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    expect(result.data.layouts[0]?.columns).toEqual([{ id: 'A', weight: 1, rows: [
      { id: 'd-r1', weight: 1, cells: [numberCell('d', 1, 'overdue')] },
      { id: 'd-r2', weight: 2, cells: [partCell('d', 2, 12, 'eisenhowerSummary')] },
    ] }])
  })

  it('runs in the chain from the floor', () => {
    const out = upgradeDataSet({ layouts: [layout({ columns: [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [dash('d', { tiles: ['open'], sections: [] })] }] }] })] }, 68, 77)
    expect(rowsOf(out.layouts![0]!)).toEqual([{ id: 'd-r1', weight: 1, cells: [numberCell('d', 1, 'open')] }])
  })
})

describe('a layout draft kept at v76', () => {
  it('reads back upgraded, its base the same ids its stored layout upgrades to', () => {
    const config = { tiles: ['open'], sections: [{ id: 'status' }] }
    const v76Base = [{ id: 'A', weight: 1, rows: [one('k-r', 'k', [dash('d', config)])] }]
    const v76Columns = [{ id: 'A', weight: 1, rows: [one('k-r', 'k', [dash('d', config)]), one('m-r', 'm', [notes('n')])] }]
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({
      kind: 'saved', layoutId: 2, schemaVersion: 76,
      columns: v76Columns, baseColumns: v76Base,
    }))
    const widgets = [
      { id: 'd-r1', weight: 1, cells: [numberCell('d', 1, 'open')] },
      { id: 'd-r2', weight: 1, cells: [partCell('d', 2, 12, 'status')] },
    ]
    expect(readLayoutDraft()).toEqual({
      kind: 'saved',
      layoutId: 2,
      base: { columns: [{ id: 'A', weight: 1, rows: widgets }] },
      body: { columns: [{ id: 'A', weight: 1, rows: [...widgets, one('m-r', 'm', [notes('n')])] }] },
    })
    expect(rowsOf(upgraded(layout({ columns: v76Base })))).toEqual(widgets)
  })
})
