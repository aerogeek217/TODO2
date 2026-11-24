import { describe, expect, it } from 'vitest'
import { createTab, WIDGET_KINDS, type WidgetKind } from '../../models/workspace-layout'
import {
  cellMinHeightPx,
  cellNumberCount,
  cellsOnlyInRow,
  FIT_ROW_PX,
  GLANCE_ROW_MIN_PX,
  isFitCell,
  isFitHeightKind,
  isFitTrack,
  isNumberStripCell,
  isGlanceKind,
  LIST_BOARD_MIN_HEIGHT_PX,
} from '../../utils/workspace-rows'
import { CELL_MIN_PX } from '../../utils/workspace-resize'
import { cell, grid, freshNumberTab, numberItem, numbersTab } from '../helpers/layout-builders'


const notes = (id: string) => createTab('notes', id)
const number = (id: string) => freshNumberTab(id)

describe('the kind flags', () => {
  it('the glance kinds are the Numbers and the charts; only the Numbers fit their height', () => {
    expect(WIDGET_KINDS.filter(isGlanceKind)).toEqual(['numbers', 'breakdown', 'pivot', 'trend'])
    expect(WIDGET_KINDS.filter(isFitHeightKind)).toEqual(['numbers'])
  })

  it('an unknown kind is neither', () => {
    expect(isGlanceKind('nope' as WidgetKind)).toBe(false)
    expect(isFitHeightKind('nope' as WidgetKind)).toBe(false)
  })
})

describe('fit tracks', () => {
  // n1 n2 L
  // a  a  L — L spans both rows
  const n1 = cell('n1', [number('x1')])
  const n2 = cell('n2', [number('x2')])
  const L = cell('L', [notes('l')])
  const a = cell('a', [notes('t')])
  const body = grid([[n1, n2, L], [a, a, L]])

  it('a row track fits when every cell lying only in it holds only Numbers; a spanning cell doesn’t count', () => {
    expect(cellsOnlyInRow(body, 0).map((c) => c.id)).toEqual(['n1', 'n2'])
    expect(isFitTrack(body, 0)).toBe(true)
    expect(isFitTrack(body, 1)).toBe(false)
    expect(isFitCell(n1)).toBe(true)
    // A strip of Numbers (flair P10) fits too; a Number beside another kind doesn't, nor an empty cell.
    expect(isFitCell({ tabs: [number('a'), number('b')] })).toBe(true)
    expect(isFitCell({ tabs: [number('a'), notes('b')] })).toBe(false)
    expect(isFitCell({ tabs: [] })).toBe(false)
    expect(isNumberStripCell({ tabs: [number('a'), number('b')] })).toBe(true)
    expect(isNumberStripCell({ tabs: [number('a')] })).toBe(false)
    expect(isNumberStripCell({ tabs: [number('a'), notes('b')] })).toBe(false)
    expect(isFitTrack(grid([[cell('s', [number('s1'), number('s2')]), n1]]), 0)).toBe(true)
    // One Numbers widget of several Numbers (v90) is a strip; of one, not.
    const widget = numbersTab('w', [numberItem('a'), numberItem('b'), numberItem('c')])
    expect(isNumberStripCell({ tabs: [widget] })).toBe(true)
    expect(cellNumberCount({ tabs: [widget, number('d')] })).toBe(4)
    expect(isNumberStripCell({ tabs: [numbersTab('w', [numberItem('a')])] })).toBe(false)
    expect(cellMinHeightPx({ tabs: [widget] })).toBe(FIT_ROW_PX)
  })

  it('a track with no cell of its own doesn’t fit', () => {
    const tall = grid([[L, n1], [L, n2]])
    // Each row holds one Number of its own: both fit.
    expect(isFitTrack(tall, 0)).toBe(true)
    const spanning = grid([[L, L]])
    expect(isFitTrack(spanning, 0)).toBe(false)
  })

  it('a cell of Numbers may shrink to its fit height (58px), any other glance cell to 64px, the rest to CELL_MIN_PX', () => {
    expect(FIT_ROW_PX).toBe(58)
    expect(cellMinHeightPx(n1)).toBe(FIT_ROW_PX)
    expect(cellMinHeightPx(cell('g', [createTab('trend', 'g1')]))).toBe(GLANCE_ROW_MIN_PX)
    // Two Numbers in one cell are a strip (flair P10): a fit cell.
    expect(cellMinHeightPx(cell('nn', [number('x3'), number('x4')]))).toBe(FIT_ROW_PX)
    expect(cellMinHeightPx(L)).toBe(CELL_MIN_PX)
  })

  it('a cell of one List board may shrink to its line of tiles’ heads (63px); with a tab strip over it, not', () => {
    expect(cellMinHeightPx(cell('b', [createTab('shortcuts', 'b1')]))).toBe(LIST_BOARD_MIN_HEIGHT_PX)
    expect(LIST_BOARD_MIN_HEIGHT_PX).toBe(63)
    expect(cellMinHeightPx(cell('bb', [createTab('shortcuts', 'b2'), notes('b3')]))).toBe(CELL_MIN_PX)
  })
})
