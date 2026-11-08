import { describe, it, expect } from 'vitest'
import { createTab } from '../../models/workspace-layout'
import { cellMinPx, solveTracks, tableTrackSizes, TABLE_HEADER_PX, trackMinimums, trackTemplate } from '../../utils/workspace-table'
import { CELL_MIN_PX, CELL_MIN_WIDTH_PX } from '../../utils/workspace-resize'
import { GLANCE_ROW_MIN_PX } from '../../utils/workspace-rows'
import { cell, grid } from '../helpers/layout-builders'

/**
 * How the table sizes its tracks (D26 P2): the CSS template, the cells'
 * minimums per track, and the solve the drop ghost uses to predict them.
 */

const notes = (id: string) => cell(id, [createTab('notes', `${id}-t`)])
const number = (id: string) => cell(id, [createTab('number', `${id}-t`)])

describe('trackTemplate', () => {
  it('weights as fr (summing to 100) never under the cells’ minimums; px tracks as px', () => {
    const body = grid([[notes('a'), notes('b')], [notes('c'), notes('c')]], { cols: [1, 3], rows: [{ px: 160 }, 1] })
    expect(trackTemplate(body, 'columns', 6)).toBe(`minmax(${CELL_MIN_WIDTH_PX}px, 25fr) minmax(${CELL_MIN_WIDTH_PX}px, 75fr)`)
    expect(trackTemplate(body, 'rows', 6)).toBe(`160px minmax(${CELL_MIN_PX}px, 100fr)`)
  })

  it('a fit row is auto; a collapsed row a header high', () => {
    const body = grid([[number('n1'), number('n2')], [notes('a'), notes('b')], [notes('c'), notes('c')]], { rows: [1000, { weight: 1000, collapsed: true }, 1000] })
    const rows = trackTemplate(body, 'rows', 6).split(' ')
    expect(rows[0]).toBe('auto')
    expect(rows[1]).toBe(`${TABLE_HEADER_PX}px`)
  })
})

describe('trackMinimums', () => {
  it('a glance cell may go to 64px high; a cell over two tracks shares its shortfall by weight', () => {
    const body = grid([[cell('g', [createTab('trend', 't')]), notes('tall')], [notes('x'), notes('tall')]], { rows: [1, 3] })
    // g's 64px and x's 112px each set their own track; tall (both tracks + a gap) already has 64 + 6 + 112.
    expect(trackMinimums(body, 'rows', 6)).toEqual([GLANCE_ROW_MIN_PX, CELL_MIN_PX])
    const spanned = grid([[cell('n', [createTab('notes', 'n1')])], [cell('n', [createTab('notes', 'n1')])]], { rows: [1, 3] })
    // One cell over both: 112 − 6 shared 1 : 3.
    const mins = trackMinimums(spanned, 'rows', 6)
    expect(mins[0]).toBeCloseTo((CELL_MIN_PX - 6) / 4)
    expect(mins[1]).toBeCloseTo(((CELL_MIN_PX - 6) * 3) / 4)
  })

  it('a collapsed cell needs only its header', () => {
    const body = grid([[notes('a')], [notes('b')]], { rows: [{ weight: 1, collapsed: true }, 1] })
    expect(cellMinPx(body, body.cells[0]!, 'rows')).toBe(TABLE_HEADER_PX)
    expect(cellMinPx(body, body.cells[1]!, 'rows')).toBe(CELL_MIN_PX)
  })
})

describe('solveTracks', () => {
  it('shares the free space by weight, after the gaps and the fixed tracks', () => {
    expect(solveTracks([{ weight: 1, min: 0 }, { px: 100 }, { weight: 3, min: 0 }], 512, 6)).toEqual([100, 100, 300])
  })

  it('a share under its minimum takes the minimum and the others share what is left', () => {
    const sizes = solveTracks([{ weight: 1, min: 200 }, { weight: 9, min: 0 }], 1006, 6)
    expect(sizes).toEqual([200, 800])
  })

  it('when the minimums don’t fit, each takes its minimum (the table scrolls)', () => {
    expect(solveTracks([{ weight: 1, min: 300 }, { weight: 1, min: 300 }], 400, 6)).toEqual([300, 300])
  })

  it('the table’s sizes: a fit row as measured', () => {
    const body = grid([[number('n1')], [notes('a')]])
    expect(tableTrackSizes(body, 'rows', 600, 6, new Map([['r1', 70]]))).toEqual([70, 524])
  })
})
