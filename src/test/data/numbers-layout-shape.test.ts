import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { checkLayoutBody, pickLayoutBody } from '../../data/layout-shape'
import { layoutPartCount } from '../../data/layout-size'
import type { LayoutTab, WorkspaceLayout } from '../../models/workspace-layout'
import { cell, grid, numberItem, numbersTab, single } from '../helpers/layout-builders'

/**
 * A Numbers widget in a stored layout (v90): one Number or more, each a
 * Number's config with its own id — in the layout's id space — and icon;
 * the widget's own name and icon are the tab's.
 */

const DATE = '2026-11-24T09:00:00.000Z'

function layoutRow(tabs: unknown[]): Record<string, unknown> {
  return { id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...single({ id: 'k', tabs: tabs as LayoutTab[] }) }
}

const read = (row: Record<string, unknown>) => sanitizeRow('layouts', row) as WorkspaceLayout

describe('a stored Numbers widget', () => {
  it('several Numbers, the widget’s name and icon and each Number’s icon round-trip', () => {
    const widget = numbersTab('w', [
      numberItem('a', 'overdue', { icon: { kind: 'emoji', emoji: '⏰' } }),
      numberItem('b', 'open', { icon: { kind: 'none' } }),
      numberItem('c', 'focus'),
    ], { name: 'Today', icon: { kind: 'line', key: 'number' } })
    const row = layoutRow([widget])
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    expect(read(row).cells[0]!.tabs).toEqual([widget])
  })

  it('without a Number: refused by the check; the repair drops the widget and its emptied cell', () => {
    const row = layoutRow([{ id: 'w', kind: 'numbers', config: { items: [] } }])
    expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].config.items')
    expect(pickLayoutBody(row).fixes).toEqual(['tab dropped'])
    expect(pickLayoutBody(row).cells).toEqual([{ id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [] }])
    expect(checkLayoutBody(layoutRow([{ id: 'w', kind: 'numbers', config: {} }]))).toBe('cells[0].tabs[0].config.items')
  })

  it('a Number’s id is in the layout’s id space: one repeating a cell’s, a tab’s or another Number’s is refused, and its Number dropped', () => {
    for (const id of ['k', 'w', 'a', 'c1']) {
      const row = layoutRow([numbersTab('w', [numberItem('a'), numberItem(id)])])
      expect(checkLayoutBody(row), id).toBe('cells[0].tabs[0].config.items[1].id')
      const picked = pickLayoutBody(row)
      expect(picked.fixes, id).toEqual(['tab or cell settings reset'])
      expect(picked.cells[0]!.tabs).toEqual([numbersTab('w', [numberItem('a')])])
    }
    // And no tab after it may take a Number's id.
    const later = layoutRow([numbersTab('w', [numberItem('a')]), { id: 'a', kind: 'notes', config: {} }])
    expect(checkLayoutBody(later)).toBe('cells[0].tabs[1].id')
  })

  it('a bad Number is dropped, the rest kept; a bad icon on one goes alone', () => {
    const row = layoutRow([{ id: 'w', kind: 'numbers', config: { items: [7, numberItem('a'), { ...numberItem('b'), icon: { kind: 'line', key: 'nope' } }] } }])
    expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].config.items[0]')
    const picked = pickLayoutBody(row)
    expect(picked.fixes).toEqual(['2 tab or cell settings reset'])
    expect(picked.cells[0]!.tabs).toEqual([numbersTab('w', [numberItem('a'), numberItem('b')])])
    expect(checkLayoutBody(layoutRow([{ id: 'w', kind: 'numbers', config: { items: [{ ...numberItem('b'), icon: 'x' }] } }]))).toBe('cells[0].tabs[0].config.items[0].icon')
  })

  it('its Numbers count as a layout’s parts (the file size check)', () => {
    const row = layoutRow([numbersTab('w', [numberItem('a'), numberItem('b'), numberItem('c')])])
    // 1 column, 1 row, 1 cell, 1 tab, 3 Numbers.
    expect(layoutPartCount(row)).toBe(7)
  })

  it('a strip of two widgets in one cell reads as it is stored (the app folds it on its next edit)', () => {
    const body = grid([[cell('k', [numbersTab('w1', [numberItem('a')]), numbersTab('w2', [numberItem('b')])])]])
    expect(checkLayoutBody(body)).toBe(true)
  })
})
