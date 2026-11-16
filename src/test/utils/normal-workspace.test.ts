import { describe, it, expect } from 'vitest'
import { createTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { dividerBreaksOff, dividerMoveStretch, dividerTooltip } from '../../utils/divider-moves'
import { ownStripHit } from '../../utils/workspace-drop'
import { edgeStretches, isWholeLine, validateTiling, wholeLine } from '../../utils/workspace-grid'
import { closeTab, moveEdge, removeTabKeepCell } from '../../utils/workspace-layout-ops'
import { cell, grid, picture } from '../helpers/layout-builders'

/**
 * The normal workspace's pure parts (layout edit mode E4 — edit mode
 * changes the grid; what's inside a cell changes in place): a divider moves
 * its whole line unless Alt breaks its piece off (decision B), a drag
 * outside the mode only reorders a tab in its own strip, and Remove widget
 * keeps its cell.
 */

const tab = (id: string) => createTab('notes', id)
const filled = (id: string) => cell(id, [tab(`${id}-t`)])

/** a | c | x over b | c | y: the level line has two pieces, c spanning between them. */
function staggered() {
  return grid([[filled('a'), filled('c'), filled('x')], [filled('b'), filled('c'), filled('y')]], { colIds: ['C1', 'C2', 'C3'], rowIds: ['R1', 'R2'] })
}

/** A 2×2 of four cells: both inner lines cross at a "+", each in two pieces. */
function quad() {
  return grid([[filled('p'), filled('q')], [filled('r'), filled('s')]], { colIds: ['C1', 'C2'], rowIds: ['R1', 'R2'] })
}

const ids = () => {
  let n = 0
  return () => `n-${++n}`
}

describe('dividerMoveStretch (decision B)', () => {
  it('a plain move takes the whole line, across the crossing; Alt only the piece', () => {
    const body = quad()
    const piece = edgeStretches(body).find((s) => s.axis === 'rows')!
    expect(isWholeLine(body, piece)).toBe(false)
    expect(dividerMoveStretch(body, piece, { breakOff: false, fit: false })).toEqual(wholeLine(body, 'rows', 1))
    expect(dividerMoveStretch(body, piece, { breakOff: true, fit: false })).toEqual(piece)
  })

  it('beside a Numbers-only row: always the whole line, Alt or not', () => {
    const body = quad()
    const piece = edgeStretches(body).find((s) => s.axis === 'columns')!
    expect(dividerMoveStretch(body, piece, { breakOff: true, fit: true })).toEqual(wholeLine(body, 'columns', 1))
  })

  it('a plain drag in a 2×2 resizes both rows under the whole line — no new line; an Alt-drag breaks the piece off into one', () => {
    const body = quad()
    const piece = edgeStretches(body).find((s) => s.axis === 'rows')!
    const opts = { sizes: [400, 400], minPx: () => 40 }
    const whole = moveEdge(body, dividerMoveStretch(body, piece, { breakOff: false, fit: false }), 100, opts, ids())
    expect(picture(whole)).toEqual(picture(body))
    expect(whole.grid.rows.map((t) => t.id)).toEqual(['R1', 'R2'])
    expect((whole.grid.rows[0]?.weight ?? 0) / (whole.grid.rows[1]?.weight ?? 1)).toBeCloseTo(500 / 300)
    const broken = moveEdge(body, dividerMoveStretch(body, piece, { breakOff: true, fit: false }), 100, opts, ids())
    expect(broken.grid.rows).toHaveLength(3)
    expect(validateTiling(broken)).toBe(true)
  })

  it('dividerBreaksOff: only Alt on part of a line, never beside a fit row', () => {
    const body = staggered()
    const piece = edgeStretches(body).find((s) => s.axis === 'rows')!
    expect(dividerBreaksOff(body, piece, { breakOff: true, fit: false })).toBe(true)
    expect(dividerBreaksOff(body, piece, { breakOff: false, fit: false })).toBe(false)
    expect(dividerBreaksOff(body, piece, { breakOff: true, fit: true })).toBe(false)
    const upright = edgeStretches(body).find((s) => s.axis === 'columns' && s.line === 1)!
    expect(isWholeLine(body, upright)).toBe(true)
    expect(dividerBreaksOff(body, upright, { breakOff: true, fit: false })).toBe(false)
  })

  it('dividerTooltip names Alt-drag only where there is a piece to break off', () => {
    expect(dividerTooltip(true, false)).toBe('Drag to resize · Alt-drag to split the line')
    expect(dividerTooltip(false, false)).toBe('Drag to resize')
    expect(dividerTooltip(true, true)).toBe('Drag to resize · Double-click to fit')
  })
})

describe('ownStripHit (outside the mode, a tab only reorders in its own strip)', () => {
  const layout = (): WorkspaceLayout => ({
    id: 1, sortOrder: 0, name: 'L', createdAt: new Date(0), modifiedAt: new Date(0),
    ...grid([[cell('k', [tab('k1'), tab('k2')]), cell('m', [tab('m1'), tab('m2')])]], { colIds: ['C1', 'C2'], rowIds: ['R1'] }),
  })

  it('its own strip stands', () => {
    const hit = { kind: 'tab-strip', cellId: 'k', index: 2, lineX: 90 } as const
    expect(ownStripHit(layout(), hit, { type: 'tab', tabId: 'k1' })).toBe(hit)
  })

  it('another cell’s strip, a split or join zone, an edge, an empty cell: none', () => {
    const source = { type: 'tab', tabId: 'k1' } as const
    expect(ownStripHit(layout(), { kind: 'tab-strip', cellId: 'm', index: 0, lineX: 300 }, source)).toBeNull()
    expect(ownStripHit(layout(), { kind: 'cell-body', cellId: 'k', zone: 'middle' }, source)).toBeNull()
    expect(ownStripHit(layout(), { kind: 'cell-body', cellId: 'm', zone: 'left' }, source)).toBeNull()
    expect(ownStripHit(layout(), { kind: 'insert', edge: 'top' }, source)).toBeNull()
    expect(ownStripHit(layout(), { kind: 'empty-cell', cellId: 'm' }, source)).toBeNull()
    expect(ownStripHit(layout(), null, source)).toBeNull()
  })

  it('a whole cell: none, wherever it is', () => {
    expect(ownStripHit(layout(), { kind: 'tab-strip', cellId: 'k', index: 0, lineX: 10 }, { type: 'panel', panelId: 'k' })).toBeNull()
  })
})

describe('removeTabKeepCell', () => {
  it('a lone widget: the cell stays, empty, where it was — no neighbour takes its space', () => {
    const body = staggered()
    const next = removeTabKeepCell(body, 'x-t')
    expect(picture(next)).toEqual(picture(body))
    expect(next.cells.find((c) => c.id === 'x')?.tabs).toEqual([])
    expect(next.cells.find((c) => c.id === 'x')?.activeTabId).toBeUndefined()
    // closeTab gives the space away (the absorb rule): the mode's Close cell.
    expect(picture(closeTab(body, 'x-t'))).not.toEqual(picture(body))
  })

  it('one of several tabs: as closeTab', () => {
    const body = grid([[cell('k', [tab('k1'), tab('k2')], { activeTabId: 'k1' })]], { colIds: ['C1'], rowIds: ['R1'] })
    expect(removeTabKeepCell(body, 'k1')).toEqual(closeTab(body, 'k1'))
  })

  it('a collapsed row left with no filled cell lying only in it expands', () => {
    const body = grid([[filled('a')], [filled('b')]], { colIds: ['C1'], rowIds: ['R1', 'R2'], rows: [{ weight: 1000, collapsed: true }, 1000] })
    const next = removeTabKeepCell(body, 'a-t')
    expect(next.grid.rows[0]?.collapsed).not.toBe(true)
  })

  it('an unknown tab: the same layout', () => {
    const body = quad()
    expect(removeTabKeepCell(body, 'nope')).toBe(body)
  })
})
