import { describe, expect, it } from 'vitest'
import { createTab, WIDGET_KINDS, type WidgetKind } from '../../models/workspace-layout'
import {
  cellMinHeightPx,
  cellsOnlyInRow,
  FIT_ROW_PX,
  GLANCE_ROW_MIN_PX,
  isFitCell,
  isFitHeightKind,
  isFitTrack,
  isNumberStripCell,
  isGlanceKind,
} from '../../utils/workspace-rows'
import { CELL_MIN_PX } from '../../utils/workspace-resize'
import { cell, grid } from '../helpers/layout-builders'


const notes = (id: string) => createTab('notes', id)
const number = (id: string) => createTab('number', id)

describe('the kind flags', () => {
  it('the glance kinds are the Number and the charts; only the Number fits its height', () => {
    expect(WIDGET_KINDS.filter(isGlanceKind)).toEqual(['number', 'breakdown', 'pivot', 'trend'])
    expect(WIDGET_KINDS.filter(isFitHeightKind)).toEqual(['number'])
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
})
