import { describe, it, expect } from 'vitest'
import { createTab } from '../../models/workspace-layout'
import { validateTiling } from '../../utils/workspace-grid'
import { placeIncomingTabs, removeTabsKeepCell } from '../../utils/workspace-layout-ops'
import { cell, grid, single } from '../helpers/layout-builders'

/** Placing widgets brought from another layout (Move / Copy to layout) and removing the moved ones from the source. */

const gen = () => {
  let n = 0
  return () => `g${++n}`
}
const notes = (id: string) => createTab('notes', id)
const ids = (c: { tabs: { id: string }[] } | undefined) => c?.tabs.map((t) => t.id)

describe('placeIncomingTabs', () => {
  it('fills an empty cell, the first tab active by default', () => {
    const body = grid([[cell('a', [notes('x')]), cell('e')]])
    const r = placeIncomingTabs(body, [notes('p'), notes('q')], { kind: 'cell', cellId: 'e' }, gen())
    expect(r.cellId).toBe('e')
    const filled = r.layout.cells.find((c) => c.id === 'e')
    expect(ids(filled)).toEqual(['p', 'q'])
    expect(filled?.activeTabId).toBe('p')
    expect(validateTiling(r.layout)).toBe(true)
  })

  it('fills an empty cell with the given active tab', () => {
    const body = single(cell('e'))
    const r = placeIncomingTabs(body, [notes('p'), notes('q')], { kind: 'cell', cellId: 'e' }, gen(), 'q')
    expect(r.layout.cells[0]?.activeTabId).toBe('q')
  })

  it('joins a card as its last tabs, the first of them active', () => {
    const body = single(cell('a', [notes('x')], { activeTabId: 'x' }))
    const r = placeIncomingTabs(body, [notes('p'), notes('q')], { kind: 'cell', cellId: 'a' }, gen(), 'q')
    expect(r.cellId).toBe('a')
    expect(ids(r.layout.cells[0])).toEqual(['x', 'p', 'q'])
    expect(r.layout.cells[0]?.activeTabId).toBe('p')
  })

  it('bottom adds a full-width row holding them', () => {
    const body = grid([[cell('a', [notes('x')]), cell('b', [notes('y')])]])
    const r = placeIncomingTabs(body, [notes('p')], { kind: 'bottom' }, gen())
    expect(r.layout.grid.rows).toHaveLength(2)
    const added = r.layout.cells.find((c) => c.id === r.cellId)
    expect(ids(added)).toEqual(['p'])
    expect(added?.area).toMatchObject({ row: 1, col: 0, colSpan: 2, rowSpan: 1 })
    expect(validateTiling(r.layout)).toBe(true)
  })

  it('line inserts a full track on that ruler line and fills its first new cell', () => {
    const body = grid([[cell('a', [notes('x')])], [cell('b', [notes('y')])]])
    const r = placeIncomingTabs(body, [notes('p')], { kind: 'line', axis: 'rows', index: 1 }, gen())
    expect(r.layout.grid.rows).toHaveLength(3)
    const added = r.layout.cells.find((c) => c.id === r.cellId)
    expect(ids(added)).toEqual(['p'])
    expect(added?.area.row).toBe(1)
    expect(validateTiling(r.layout)).toBe(true)
  })

  it('line at a column index inserts a column', () => {
    const body = grid([[cell('a', [notes('x')]), cell('b', [notes('y')])]])
    const r = placeIncomingTabs(body, [notes('p')], { kind: 'line', axis: 'columns', index: 2 }, gen())
    expect(r.layout.grid.columns).toHaveLength(3)
    expect(r.cellId).not.toBeNull()
  })

  it('refuses a missing cell: the same layout, no cell', () => {
    const body = single(cell('a', [notes('x')]))
    const r = placeIncomingTabs(body, [notes('p')], { kind: 'cell', cellId: 'nope' }, gen())
    expect(r.cellId).toBeNull()
    expect(r.layout).toBe(body)
  })

  it('refuses a line outside the table', () => {
    const body = single(cell('a', [notes('x')]))
    const r = placeIncomingTabs(body, [notes('p')], { kind: 'line', axis: 'rows', index: 9 }, gen())
    expect(r.cellId).toBeNull()
    expect(r.layout).toBe(body)
  })

  it('refuses a tab whose id the layout already uses, for every target', () => {
    const body = single(cell('a', [notes('x')]))
    for (const target of [{ kind: 'cell', cellId: 'a' }, { kind: 'bottom' }, { kind: 'line', axis: 'rows', index: 0 }] as const) {
      const r = placeIncomingTabs(body, [notes('x')], target, gen())
      expect(r.cellId).toBeNull()
      expect(r.layout).toBe(body)
    }
  })

  it('refuses no tabs', () => {
    const body = single(cell('e'))
    expect(placeIncomingTabs(body, [], { kind: 'cell', cellId: 'e' }, gen()).cellId).toBeNull()
  })
})

describe('removeTabsKeepCell', () => {
  it('keeps a lone widget cell, empty', () => {
    const body = grid([[cell('a', [notes('x')]), cell('b', [notes('y')])]])
    const r = removeTabsKeepCell(body, ['x'])
    expect(r.cells.map((c) => [c.id, ids(c)])).toEqual([['a', []], ['b', ['y']]])
  })

  it('removes several tabs of one cell', () => {
    const body = single(cell('a', [notes('x'), notes('y'), notes('z')], { activeTabId: 'x' }))
    const r = removeTabsKeepCell(body, ['x', 'z'])
    expect(ids(r.cells[0])).toEqual(['y'])
    expect(r.cells[0]?.activeTabId).toBe('y')
  })

  it('ignores a tab that is not there', () => {
    const body = single(cell('a', [notes('x')]))
    expect(ids(removeTabsKeepCell(body, ['nope']).cells[0])).toEqual(['x'])
  })
})
