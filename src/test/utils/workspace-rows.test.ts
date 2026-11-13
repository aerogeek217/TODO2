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
  isGlanceKind,
} from '../../utils/workspace-rows'
import { CELL_MIN_PX } from '../../utils/workspace-resize'
import { cell, grid } from '../helpers/layout-builders'


const notes = (id: string) => createTab('notes', id)
const number = (id: string) => createTab('number', id)

describe('the kind flags', () => {
  it('the glance kinds are the Number, the charts, the sections and Project pulse; only the Number fits its height', () => {
    expect(WIDGET_KINDS.filter(isGlanceKind)).toEqual(['number', 'breakdown', 'pivot', 'trend', 'pulse'])
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

  it('a row track fits when every cell lying only in it holds one Number; a spanning cell doesn’t count', () => {
    expect(cellsOnlyInRow(body, 0).map((c) => c.id)).toEqual(['n1', 'n2'])
    expect(isFitTrack(body, 0)).toBe(true)
    expect(isFitTrack(body, 1)).toBe(false)
    expect(isFitCell(n1)).toBe(true)
    expect(isFitCell({ tabs: [number('a'), number('b')] })).toBe(false)
  })

  it('a track with no cell of its own doesn’t fit', () => {
    const tall = grid([[L, n1], [L, n2]])
    // Each row holds one Number of its own: both fit.
    expect(isFitTrack(tall, 0)).toBe(true)
    const spanning = grid([[L, L]])
    expect(isFitTrack(spanning, 0)).toBe(false)
  })

  it('a cell of one Number may shrink to its fit height (58px), any other glance cell to 64px, the rest to CELL_MIN_PX', () => {
    expect(FIT_ROW_PX).toBe(58)
    expect(cellMinHeightPx(n1)).toBe(FIT_ROW_PX)
    expect(cellMinHeightPx(cell('g', [createTab('trend', 'g1')]))).toBe(GLANCE_ROW_MIN_PX)
    // Two Numbers in one cell have a tab strip: a glance cell, not a fit one.
    expect(cellMinHeightPx(cell('nn', [number('x3'), number('x4')]))).toBe(GLANCE_ROW_MIN_PX)
    expect(cellMinHeightPx(L)).toBe(CELL_MIN_PX)
  })
})
