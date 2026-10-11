import { describe, it, expect } from 'vitest'
import { validateImportData, validateRow } from '../../data/import-validation'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(columns: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 1, name: 'Daily', columns, createdAt: DATE, modifiedAt: DATE, ...extra }
}

function oneTab(tab: Record<string, unknown>, cell: Record<string, unknown> = {}): unknown[] {
  return [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [tab], ...cell }] }]
}

describe('layouts row validation', () => {
  it('accepts every kind, an empty cell and an empty layout', () => {
    const columns = [
      { id: 'c1', weight: 1, cells: [
        { id: 'k1', weight: 1, activeTabId: 't2', collapsed: true, tabs: [
          { id: 't1', kind: 'lens', config: { listDefinitionId: 3 } },
          { id: 't2', kind: 'calendar', config: { dateTypes: { due: false, followup: true } }, viewState: { view: 'month', offset: -2 } },
          { id: 't3', kind: 'notes', config: {} },
          { id: 't5', kind: 'status', config: {} },
        ] },
        { id: 'k2', weight: 0.5, tabs: [] },
      ] },
    ]
    expect(validateRow('layouts', layoutRow(columns, { lastUsedAt: DATE }))).toBe(true)
    expect(validateRow('layouts', layoutRow([]))).toBe(true)
  })

  it.each([
    ['blank name', layoutRow([], { name: '  ' }), 'name'],
    ['bad date', layoutRow([], { modifiedAt: 'nope' }), 'modifiedAt'],
    ['columns not an array', layoutRow({}), 'columns'],
    ['column without cells', layoutRow([{ id: 'c', weight: 1, cells: [] }]), 'columns[0].cells'],
    ['zero weight', layoutRow([{ id: 'c', weight: 0, cells: [] }]), 'columns[0].weight'],
    ['unknown kind', layoutRow(oneTab({ id: 't', kind: 'horizons', config: {} })), 'columns[0].cells[0].tabs[0].kind'],
    ['missing config', layoutRow(oneTab({ id: 't', kind: 'notes' })), 'columns[0].cells[0].tabs[0].config'],
    ['calendar with no date type', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: false, followup: false } } })), 'columns[0].cells[0].tabs[0].config.dateTypes'],
    ['bad calendar view', layoutRow(oneTab({ id: 't', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'year' } })), 'columns[0].cells[0].tabs[0].viewState.view'],
    ['bad list id', layoutRow(oneTab({ id: 't', kind: 'lens', config: { listDefinitionId: '3' } })), 'columns[0].cells[0].tabs[0].config.listDefinitionId'],
    ['bad collapsed', layoutRow(oneTab({ id: 't', kind: 'notes', config: {} }, { collapsed: 'yes' })), 'columns[0].cells[0].collapsed'],
    ['duplicate id', layoutRow(oneTab({ id: 'k', kind: 'notes', config: {} })), 'columns[0].cells[0].tabs[0].id'],
  ])('rejects %s', (_label, row, field) => {
    expect(validateRow('layouts', row)).toBe(field)
  })

  it('import keeps only model keys and drops a stale activeTabId', () => {
    const columns = [{
      id: 'c', weight: 2, extra: 1, cells: [{
        id: 'k', weight: 1, activeTabId: 'gone', collapsed: false, junk: true,
        tabs: [
          { id: 't1', kind: 'notes', config: { stray: 1 }, viewState: { stray: 2 } },
          // A list tab saves no prompt picks.
          { id: 't3', kind: 'lens', config: { listDefinitionId: 4 }, viewState: { runtimeFilterValue: [1] } },
          { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false, x: 1 } }, viewState: { offset: 500 } },
        ],
      }],
    }]
    const res = validateImportData({ todos: [], settings: [], layouts: [layoutRow(columns, { stray: 'x' })] })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts).toEqual([{
      id: 1, name: 'Daily', createdAt: new Date(DATE), modifiedAt: new Date(DATE),
      columns: [{ id: 'c', weight: 2, cells: [{ id: 'k', weight: 1, tabs: [
        { id: 't1', kind: 'notes', config: {} },
        { id: 't3', kind: 'lens', config: { listDefinitionId: 4 } },
        { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { offset: 104 } },
      ] }] }],
    }])
  })

  it('validates the activeLayoutId setting as a number', () => {
    expect(validateRow('settings', { key: 'activeLayoutId', value: '3' })).toBe(true)
    expect(validateRow('settings', { key: 'activeLayoutId', value: 'x' })).toBe('value (activeLayoutId must be numeric)')
  })
})
