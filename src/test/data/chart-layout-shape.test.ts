import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { checkLayoutBody } from '../../data/layout-shape'
import { emptyPredicate } from '../../models/filter-predicate'
import { BREAKDOWN_PRESETS, breakdownPreset, newBreakdownConfig } from '../../models/chart-widgets'
import { createTab, isWidgetKind, kindTabTitle, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { cell, grid, single } from '../helpers/layout-builders'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return { id: 1, name: 'Charts', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }) }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]

describe('a Breakdown in a stored layout (D26 P8)', () => {
  const full = {
    ...newBreakdownConfig({ ...emptyPredicate(), statusIds: [3] }),
    name: 'Waiting on', show: 'oldest', oldestBy: 'lastFollowup', checkins: true, style: 'donut', showNone: false,
    badges: { due: 'overdue', followup: 2 },
  }

  it('every field round-trips, with its sorts (view state)', () => {
    for (const tab of [
      createTab('breakdown', 't') as unknown as Record<string, unknown>,
      { id: 't', kind: 'breakdown', config: full, viewState: { sorts: { people: { by: 'due', reversed: true }, status: { by: 'name' } } } },
      { id: 't', kind: 'breakdown', config: { ...newBreakdownConfig(emptyPredicate()), splitBy: 'age', badges: 'off' } },
      // One range of its own: the other follows Settings.
      { id: 't', kind: 'breakdown', config: { ...newBreakdownConfig(emptyPredicate()), badges: { followup: 2 } } },
      { id: 't', kind: 'breakdown', config: { ...newBreakdownConfig(emptyPredicate()), badges: { due: 'overdue' } } },
    ]) {
      const row = layoutRow(tab)
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual(tab)
    }
  })

  it.each([
    ['name', 7, { name: 'Breakdown' }],
    ['splitBy', 'month', { splitBy: 'people' }],
    ['style', 'pie', { style: 'bars' }],
    ['show', 'sum', { show: 'count', oldestBy: undefined }],
    ['oldestBy', 'birthday', { oldestBy: undefined }],
    ['showNone', 'yes', { showNone: true }],
    ['checkins', false, { checkins: undefined }],
    ['badges', { due: 'soon', followup: 0 }, { badges: undefined }],
    ['badges', {}, { badges: undefined }],
    ['badges', { due: 3, weekly: true }, { badges: undefined }],
  ] as const)('its %s %j is reset (a fix)', (key, value, reset) => {
    const row = layoutRow({ id: 't', kind: 'breakdown', config: { ...full, [key]: value } })
    expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.${key}`)
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    const expected: Record<string, unknown> = { ...full, ...reset }
    for (const [k, v] of Object.entries(expected)) if (v === undefined) delete expected[k]
    expect(tabOf(row)).toEqual({ id: 't', kind: 'breakdown', config: expected })
  })

  it('an oldestBy without oldest goes; a missing filter is none (a fix); a bad sort is dropped', () => {
    const counts = layoutRow({ id: 't', kind: 'breakdown', config: { ...full, show: 'count' } })
    expect(checkLayoutBody(counts)).toBe('cells[0].tabs[0].config.oldestBy')
    expect(tabOf(counts)?.config).not.toHaveProperty('oldestBy')
    const { filter: _f, ...noFilter } = full
    void _f
    expect((tabOf(layoutRow({ id: 't', kind: 'breakdown', config: noFilter }))?.config as { filter: unknown }).filter).toEqual(emptyPredicate())
    const sorts = layoutRow({ id: 't', kind: 'breakdown', config: full, viewState: { sorts: { people: { by: 'a height' }, tags: { by: 'open' } } } })
    expect(checkLayoutBody(sorts)).toBe('cells[0].tabs[0].viewState.sorts.people')
    expect(tabOf(sorts)).toEqual({ id: 't', kind: 'breakdown', config: full, viewState: { sorts: { tags: { by: 'open' } } } })
  })

  it('its count columns (board BC) and its lens switch (view state) round-trip; a column sort is any column id', () => {
    const columns = [
      { id: 'col-a', name: 'Waiting', color: '#7ec4bc', filter: { ...emptyPredicate(), statusIds: [3] }, litWhen: 'above', litAt: 2 },
      { id: 'due', name: '', color: '#e86bf0', filter: emptyPredicate(), litWhen: 'never' },
    ]
    const tab = { id: 't', kind: 'breakdown', config: { ...full, columns }, viewState: { sorts: { people: { by: 'col-a' } }, ignoreLens: true } }
    const row = layoutRow(tab)
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    expect(tabOf(row)).toEqual(tab)
    // No columns at all is kept (it isn't the same as none stored).
    const none = { id: 't', kind: 'breakdown', config: { ...full, columns: [] } }
    expect(tabOf(layoutRow(none))).toEqual(none)
  })

  it.each([
    ['five columns', Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: 'C', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }))],
    ['a repeated id', [{ id: 'c', name: 'A', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }, { id: 'c', name: 'B', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }]],
    ['a fixed heading as its id', [{ id: 'open', name: 'A', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }]],
    ['a colour that is no hex', [{ id: 'c', name: 'A', color: 'teal', filter: emptyPredicate(), litWhen: 'never' }]],
    ['a rule with no threshold', [{ id: 'c', name: 'A', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'above' }]],
    ['a threshold with Never', [{ id: 'c', name: 'A', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never', litAt: 1 }]],
  ])('count columns with %s are repaired (a fix)', (_what, columns) => {
    const row = layoutRow({ id: 't', kind: 'breakdown', config: { ...full, columns } })
    expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].config.columns')
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    const picked = (tabOf(row)?.config as { columns: Array<{ id: string; color: string; litWhen: string; litAt?: number }> }).columns
    expect(picked.length).toBeLessThanOrEqual(4)
    expect(new Set(picked.map((c) => c.id)).size).toBe(picked.length)
    for (const c of picked) {
      expect(c.id).not.toBe('open')
      expect(c.color).toMatch(/^#/)
      expect(c.litWhen === 'never' ? c.litAt : typeof c.litAt).toBe(c.litWhen === 'never' ? undefined : 'number')
    }
  })

  it('a column filter that doesn’t read is checked as a Number’s', () => {
    const row = layoutRow({ id: 't', kind: 'breakdown', config: { ...full, columns: [{ id: 'c', name: 'A', color: '#7ec4bc', filter: { nope: 1 }, litWhen: 'never' }] } })
    expect(checkLayoutBody(row)).toMatch(/^cells\[0\]\.tabs\[0\]\.config\.columns\.0\.filter/)
  })

  it('a lens switch that is no boolean is dropped (a fix)', () => {
    const row = layoutRow({ id: 't', kind: 'breakdown', config: full, viewState: { ignoreLens: 'yes' } })
    expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].viewState.ignoreLens')
    expect(tabOf(row)).toEqual({ id: 't', kind: 'breakdown', config: full })
  })

  it('its tab reads its name, Breakdown while blank', () => {
    expect(kindTabTitle(createTab('breakdown', 'b', { breakdown: { name: 'Waiting on' } }))).toBe('Waiting on')
    expect(kindTabTitle(createTab('breakdown', 'b', { breakdown: { name: '  ' } }))).toBe('Breakdown')
  })
})

describe('a Pivot in a stored layout (D26 P8)', () => {
  it('round-trips; a bad axis or name is reset (a fix)', () => {
    const tab = { id: 't', kind: 'pivot', config: { name: 'Who × status', filter: { ...emptyPredicate(), tags: [2] }, rows: 'tags', cols: 'priority' } }
    expect(validateRow('layouts', layoutRow(tab))).toBe(true)
    expect(tabOf(layoutRow(tab))).toEqual(tab)
    expect(createTab('pivot', 'p').config).toEqual({ name: 'Pivot', filter: emptyPredicate(), rows: 'people', cols: 'status' })
    for (const [key, value, reset] of [['rows', 'weeks', 'people'], ['cols', 7, 'status'], ['name', null, 'Pivot']] as const) {
      const row = layoutRow({ ...tab, config: { ...tab.config, [key]: value } })
      expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.${key}`)
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect((tabOf(row)?.config as unknown as Record<string, unknown>)[key]).toBe(reset)
    }
  })
})

// Kinds removed while the schema stayed at v78: the Status flow, then the Tag map.
describe.each([
  ['a Status flow', { id: 'gone', kind: 'statusFlow', config: { name: 'Flow', filter: emptyPredicate(), weeks: 12 } }],
  ['a Tag map', { id: 'gone', kind: 'tagMap', config: { name: 'Projects', filter: emptyPredicate(), tagIds: [1] } }],
])('%s saved before it was removed (v78)', (_what, removed) => {
  const notes = { id: 'n', kind: 'notes', config: {} }

  it('is no widget kind any more', () => {
    expect(isWidgetKind(removed.kind)).toBe(false)
  })

  it('passes the check, so a v78 file holding one still imports; the repair drops it (a fix) and its emptied cell closes', () => {
    const row = { id: 1, name: 'Charts', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
      ...grid([[cell('a', [removed as unknown as LayoutTab]), cell('b', [notes as LayoutTab])]]) }
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual(['tab dropped'])
    const picked = sanitizeRow('layouts', row) as WorkspaceLayout
    expect(picked.cells.map((c) => c.id)).toEqual(['b'])
    expect(picked.cells[0]!.area).toEqual({ col: 0, row: 0, colSpan: 1, rowSpan: 1 })
    expect(picked.cells[0]!.tabs).toEqual([notes])
  })

  it('beside another tab, only it goes', () => {
    const row = layoutRow(removed)
    const body = { ...row, cells: [{ ...(row.cells as WorkspaceLayout['cells'])[0]!, tabs: [notes, removed] }] }
    expect(validateRow('layouts', body)).toBe(true)
    expect((sanitizeRow('layouts', body) as WorkspaceLayout).cells[0]!.tabs).toEqual([notes])
  })

  it('still needs a fresh id', () => {
    const row = layoutRow(removed)
    const body = { ...row, cells: [{ ...(row.cells as WorkspaceLayout['cells'])[0]!, tabs: [notes, { ...removed, id: 'n' }] }] }
    expect(checkLayoutBody(body)).toBe('cells[0].tabs[1].id')
  })
})

describe('the Add widget presets', () => {
  it('People, Tags and Status split every open task by theirs; Custom is a new Breakdown; Waiting on is gone (board BC)', () => {
    expect(BREAKDOWN_PRESETS).toEqual(['people', 'tags', 'status', 'custom'])
    expect(breakdownPreset('people')).toEqual({ name: 'People', splitBy: 'people' })
    expect(breakdownPreset('tags')).toEqual({ name: 'Tags', splitBy: 'tags' })
    expect(breakdownPreset('status')).toEqual({ name: 'Status', splitBy: 'status' })
    expect(breakdownPreset('custom')).toEqual({})
  })
})
