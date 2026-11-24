import { describe, it, expect } from 'vitest'
import { createTab, type LayoutBody, type WorkspaceLayout } from '../../models/workspace-layout'
import { isNormalized, orphanCollapsedTracks, validateTiling } from '../../utils/workspace-grid'
import { isFitTrack } from '../../utils/workspace-rows'
import {
  evenTracks,
  insertTrack,
  insertTrackAt,
  mergeTrackInto,
  removeTrack,
  trackRemoval,
} from '../../utils/workspace-layout-ops'
import { cell as spec, emptyBody, grid, picture, type CellSpec, freshNumberTab } from '../helpers/layout-builders'

/**
 * The layout edit mode's track ops (E2): `insertTrackAt` (a ruler's "+"),
 * `removeTrack` (Remove row / column), `mergeTrackInto` (a sliver's Merge
 * into B) and `evenTracks` (Even all widths / heights).
 */

/** A cell of notes tabs (`<id>-t` unless named), its first tab active. */
function cell(id: string, tabIds: string[] = [`${id}-t`]): CellSpec {
  const tabs = tabIds.map((t) => createTab('notes', t))
  return spec(id, tabs, tabs[0] ? { activeTabId: tabs[0].id } : {})
}

/** An empty cell. */
function empty(id: string): CellSpec {
  return spec(id, [])
}

/** A cell of Number tabs: one is a fit row's cell, two or more a Numbers strip. */
function numbers(id: string, tabIds: string[]): CellSpec {
  const tabs = tabIds.map((t) => freshNumberTab(t))
  return spec(id, tabs, tabs[0] ? { activeTabId: tabs[0].id } : {})
}

function layout(body: LayoutBody): WorkspaceLayout {
  return { sortOrder: 0, name: 'L', ...body, createdAt: new Date(0), modifiedAt: new Date(0) }
}

function ids(prefix = 'n') {
  let n = 0
  return () => `${prefix}${++n}`
}

function expectValid(body: LayoutBody): void {
  expect(validateTiling(body)).toBe(true)
  expect(isNormalized(body)).toBe(true)
  const all = [
    ...body.grid.columns.map((t) => t.id),
    ...body.grid.rows.map((t) => t.id),
    ...body.cells.flatMap((c) => [c.id, ...c.tabs.map((t) => t.id)]),
  ]
  expect(new Set(all).size).toBe(all.length)
}

const allTabs = (body: LayoutBody) => body.cells.flatMap((c) => c.tabs.map((t) => t.id)).sort()
const tabsOf = (body: LayoutBody, cellId: string) => body.cells.find((c) => c.id === cellId)?.tabs.map((t) => t.id)

describe('insertTrackAt', () => {
  const a = cell('a')
  const b = cell('b')
  const c = cell('c')
  const d = cell('d')

  it('an inner column line: the cells crossing it grow across, the other places become empty cells', () => {
    const t = cell('t')
    const base = layout(grid([[a, b], [t, t]], { cols: [600, 400] }))
    const out = insertTrackAt(base, 'columns', 1, ids())
    expect(picture(out.layout)).toEqual(['a n2 b', 't t t'])
    expect(out.cellId).toBe('n2')
    // Half of the track after the line by default.
    expect(out.layout.grid.columns.map((x) => x.weight)).toEqual([600, 200, 200])
    expectValid(out.layout)
  })

  it('an inner row line between two rows: full width, one empty cell', () => {
    const base = layout(grid([[a, b], [c, d]], { rows: [500, 500] }))
    const out = insertTrackAt(base, 'rows', 1, ids())
    expect(picture(out.layout)).toEqual(['a b', 'n2 n2', 'c d'])
    expectValid(out.layout)
  })

  it('takes half of `from` when it is beside the line (Insert row below a ruler)', () => {
    const base = layout(grid([[a], [c]], { rows: [800, 200] }))
    const out = insertTrackAt(base, 'rows', 1, ids(), 0)
    expect(out.layout.grid.rows.map((x) => x.weight)).toEqual([400, 400, 200])
  })

  it('the edges are the layout’s: Row at the top, Column at the right', () => {
    const base = layout(grid([[a, b], [c, d]]))
    expect(picture(insertTrackAt(base, 'rows', 0, ids()).layout)).toEqual(picture(insertTrack(base, 'top', ids()).layout))
    expect(picture(insertTrackAt(base, 'columns', 2, ids()).layout)).toEqual(picture(insertTrack(base, 'right', ids()).layout))
  })

  it('a line that isn’t one: the same layout', () => {
    const base = layout(grid([[a, b]]))
    expect(insertTrackAt(base, 'columns', 3, ids())).toEqual({ layout: base, cellId: null })
    expect(insertTrackAt(base, 'columns', -1, ids())).toEqual({ layout: base, cellId: null })
    expect(insertTrackAt(base, 'columns', 0.5, ids())).toEqual({ layout: base, cellId: null })
  })

  it('an empty layout: its first cell', () => {
    const out = insertTrackAt(layout(emptyBody()), 'rows', 0, ids())
    expect(out.layout.cells).toHaveLength(1)
    expectValid(out.layout)
  })

  it('beside a fit row (Numbers) and a fixed row: the size comes from a weighted row', () => {
    const n = numbers('n', ['n1'])
    const base = layout(grid([[n], [a], [b]], { rows: [1000, { px: 120 }, 600] }))
    expect(isFitTrack(base, 0)).toBe(true)
    const out = insertTrackAt(base, 'rows', 1, ids('g'))
    // Neither neighbour is drawn by its weight: the nearest weighted row gives half.
    expect(out.layout.grid.rows.map((x) => x.px ?? x.weight)).toEqual([1000, 300, 120, 300])
    expectValid(out.layout)
  })

  it('a new row beside collapsed rows comes out expanded', () => {
    const base = layout(grid([[a, b], [c, d]], { rows: [{ weight: 500, collapsed: true }, { weight: 500, collapsed: true }] }))
    const out = insertTrackAt(base, 'rows', 1, ids())
    expect(out.layout.grid.rows[1]?.collapsed).toBeUndefined()
    expect(out.layout.grid.rows[0]?.collapsed).toBe(true)
    expectValid(out.layout)
  })
})

describe('insertTrackAt across a sliver (`through`)', () => {
  // Part of the line between the left cells was dragged 10px down: a sliver row (1) no cell lies only in.
  const a = cell('a')
  const b = cell('b')
  const c = cell('c')
  const d = cell('d')
  const slivered = () => layout(grid([[a, b], [a, d], [c, d]], { rows: [500, 10, 490] }))

  it('either of the sliver’s lines alone is crossed: the left or the right cell grows, a half-width cell', () => {
    expect(picture(insertTrackAt(slivered(), 'rows', 1, ids()).layout)).toEqual(['a b', 'a n2', 'a d', 'c d'])
    expect(picture(insertTrackAt(slivered(), 'rows', 2, ids()).layout)).toEqual(['a b', 'a d', 'n2 d', 'c d'])
  })

  it('the sliver and its two lines as one line: the sliver merged away, a full-width row there', () => {
    const out = insertTrackAt(slivered(), 'rows', 1, ids(), undefined, 2)
    expect(picture(out.layout)).toEqual(['a b', 'n2 n2', 'c d'])
    expect(out.cellId).toBe('n2')
    // Its size: half the major after the run (which took the sliver's 10), never half a sliver.
    expect(out.layout.grid.rows.map((t) => t.weight)).toEqual([500, 250, 250])
    expect(allTabs(out.layout)).toEqual(['a-t', 'b-t', 'c-t', 'd-t'])
    expectValid(out.layout)
  })

  it('a cell spanning the whole run still crosses it and grows; `from` names the track it halves', () => {
    const x = cell('x')
    const base = layout(grid([[a, x], [a, x], [c, x]], { rows: [400, 10, 590] }))
    const out = insertTrackAt(base, 'rows', 1, ids(), 0, 2)
    expect(picture(out.layout)).toEqual(['a x', 'n2 x', 'c x'])
    expect(out.layout.grid.rows.map((t) => t.weight)).toEqual([200, 200, 600])
    expectValid(out.layout)
  })

  it('a run at the layout’s end merges into the track before and inserts at the edge', () => {
    const base = layout(grid([[a, b], [c, b], [c, d]], { rows: [500, 490, 10] }))
    const out = insertTrackAt(base, 'rows', 2, ids(), undefined, 3)
    expect(picture(out.layout).at(-1)).toMatch(/^(n\d+) \1$/)
    expectValid(out.layout)
  })
})

describe('removeTrack', () => {
  it('a row’s cells join the cells above as tabs, after their own', () => {
    const base = layout(grid([[cell('a'), cell('b')], [cell('c'), cell('d')]]))
    const out = removeTrack(base, 'rows', 1, ids())
    expect(picture(out)).toEqual(['a b'])
    expect(tabsOf(out, 'a')).toEqual(['a-t', 'c-t'])
    expect(tabsOf(out, 'b')).toEqual(['b-t', 'd-t'])
    // The joined cell keeps its active tab.
    expect(out.cells.find((x) => x.id === 'a')?.activeTabId).toBe('a-t')
    expectValid(out)
  })

  it('the first row goes toward the row after it', () => {
    const base = layout(grid([[cell('a'), cell('b')], [cell('c'), cell('d')]]))
    const out = removeTrack(base, 'rows', 0, ids())
    expect(picture(out)).toEqual(['c d'])
    expect(tabsOf(out, 'c')).toEqual(['c-t', 'a-t'])
  })

  it('a cell spanning the track (through it, or starting or ending in it) shrinks', () => {
    const t = cell('t')
    const u = cell('u')
    const base = layout(grid([[t, cell('a')], [t, u], [cell('b'), u]]))
    const out = removeTrack(base, 'rows', 1, ids())
    // t loses row 2, u loses it too; nothing lay only in it.
    expect(picture(out)).toEqual(['t a', 'b u'])
    expect(trackRemoval(base, 'rows', 1)?.moves).toEqual([])
    expectValid(out)
  })

  it('a column: its cells go into the column to the left', () => {
    const base = layout(grid([[cell('a'), cell('b'), cell('c')]], { cols: [300, 300, 400] }))
    const out = removeTrack(base, 'columns', 1, ids())
    expect(picture(out)).toEqual(['a c'])
    expect(tabsOf(out, 'a')).toEqual(['a-t', 'b-t'])
    // Its size goes to that column: the other line stays.
    expect(out.grid.columns.map((x) => x.weight)).toEqual([600, 400])
  })

  it('a place of empty cells: the cell moves there instead', () => {
    const e = empty('e')
    const base = layout(grid([[e, e], [cell('c'), cell('d')]]))
    const out = removeTrack(base, 'rows', 1, ids())
    expect(picture(out)).toEqual(['c d'])
    expect(tabsOf(out, 'c')).toEqual(['c-t'])
    expect(trackRemoval(base, 'rows', 1)?.moves).toEqual([
      { cellId: 'c', tabIds: ['c-t'], into: null },
      { cellId: 'd', tabIds: ['d-t'], into: null },
    ])
    expectValid(out)
  })

  it('an empty cell the move carves is cut into rectangles; what is left stays empty', () => {
    const e = empty('e')
    const base = layout(grid([[e, e], [e, e], [cell('c'), empty('g')]]))
    const out = removeTrack(base, 'rows', 2, ids())
    expect(picture(out)).toEqual(['e e', 'c n1'])
    expect(out.cells.find((x) => x.id === 'n1')?.tabs).toEqual([])
    expectValid(out)
  })

  it('a place of several cells: the one sharing the most of its edge takes the tabs', () => {
    const q = cell('q')
    const v = cell('v')
    const base = layout(grid([[cell('p'), q, q], [v, v, v]]))
    const out = removeTrack(base, 'rows', 1, ids())
    expect(tabsOf(out, 'q')).toEqual(['q-t', 'v-t'])
    expect(tabsOf(out, 'p')).toEqual(['p-t'])
  })

  it('on a tie, the first along the edge; a cell sticking out past the place counts only its part beside it', () => {
    const q = cell('q')
    const v = cell('v')
    const base = layout(grid([[cell('p'), q, q], [v, v, cell('w')]]))
    // v (columns 1–2): p shares 1, q shares 1 of its 2 — the first, p.
    expect(trackRemoval(base, 'rows', 1)?.moves).toEqual([
      { cellId: 'v', tabIds: ['v-t'], into: 'p' },
      { cellId: 'w', tabIds: ['w-t'], into: 'q' },
    ])
    expectValid(removeTrack(base, 'rows', 1, ids()))
  })

  it('a place with a filled cell beside empty ones: the tabs join the filled one', () => {
    const v = cell('v')
    const base = layout(grid([[empty('e'), cell('p')], [v, v]]))
    expect(trackRemoval(base, 'rows', 1)?.moves).toEqual([{ cellId: 'v', tabIds: ['v-t'], into: 'p' }])
    const out = removeTrack(base, 'rows', 1, ids())
    expect(picture(out)).toEqual(['e p'])
    expect(tabsOf(out, 'p')).toEqual(['p-t', 'v-t'])
  })

  it('an empty cell lying only in the track just goes', () => {
    const base = layout(grid([[cell('a')], [empty('e')]]))
    const out = removeTrack(base, 'rows', 1, ids())
    expect(picture(out)).toEqual(['a'])
    expect(trackRemoval(base, 'rows', 1)?.moves).toEqual([])
  })

  it('a Numbers strip’s Numbers become tabs of the cell beside it', () => {
    const s = numbers('s', ['n1', 'n2'])
    const base = layout(grid([[s, s], [cell('a'), cell('b')]]))
    const out = removeTrack(base, 'rows', 0, ids())
    expect(tabsOf(out, 'a')).toEqual(['a-t', 'n1-w', 'n2-w'])
    expectValid(out)
  })

  it('a Numbers strip moving into an empty place stays a strip', () => {
    const s = numbers('s', ['n1', 'n2'])
    const e = empty('e')
    const base = layout(grid([[e, e], [s, s]]))
    const out = removeTrack(base, 'rows', 1, ids())
    expect(tabsOf(out, 's')).toEqual(['n1-w', 'n2-w'])
    expect(isFitTrack(out, 0)).toBe(true)
  })

  it('a fixed row next to another: the px added; beside a weighted row, nothing moves over', () => {
    const base = layout(grid([[cell('a')], [cell('b')], [cell('c')]], { rows: [{ px: 100 }, { px: 60 }, 800] }))
    expect(removeTrack(base, 'rows', 1, ids()).grid.rows.map((x) => x.px ?? x.weight)).toEqual([160, 800])
    expect(removeTrack(base, 'rows', 2, ids()).grid.rows.map((x) => x.px ?? x.weight)).toEqual([100, 60])
  })

  it('a collapsed row keeps its collapse; one left with nothing to expand it expands', () => {
    const t = cell('t')
    const base = layout(grid([[cell('a'), t], [cell('b'), t]], { rows: [{ weight: 500, collapsed: true }, 500] }))
    // Row 1 collapsed is held by a (lying only in it).
    expect(orphanCollapsedTracks(base, 'rows')).toEqual([])
    const kept = removeTrack(base, 'rows', 1, ids())
    expect(kept.grid.rows[0]?.collapsed).toBe(true)
    // Column 1 goes: a and b join t, which reaches into the expanded row — row 1 expands.
    const out = removeTrack(base, 'columns', 0, ids())
    expect(orphanCollapsedTracks(out, 'rows')).toEqual([])
    expect(out.grid.rows.every((x) => x.collapsed !== true)).toBe(true)
    expect(tabsOf(out, 't')).toEqual(['t-t', 'a-t', 'b-t'])
    expectValid(out)
  })

  it('the last track is refused: the same layout', () => {
    const base = layout(grid([[cell('a'), cell('b')]]))
    expect(removeTrack(base, 'rows', 0, ids())).toBe(base)
    expect(removeTrack(base, 'columns', 5, ids())).toBe(base)
    expect(trackRemoval(base, 'rows', 0)).toBeNull()
  })

  it('never deletes a widget', () => {
    const t = cell('t', ['t1', 't2'])
    const base = layout(grid([[t, t, cell('a')], [cell('b'), cell('c'), cell('d')], [cell('e'), cell('e'), cell('d')]]))
    for (const axis of ['rows', 'columns'] as const) {
      for (let i = 0; i < 3; i++) {
        const out = removeTrack(base, axis, i, ids())
        expect(allTabs(out)).toEqual(allTabs(base))
        expectValid(out)
      }
    }
  })
})

describe('mergeTrackInto (a sliver’s Merge into B)', () => {
  // Columns A | s | B: a part line moved a few px off left the sliver s.
  const x = cell('x')
  const y = cell('y')
  const z = cell('z')
  const w = cell('w')
  const sliver = layout(grid([[x, y, y], [z, z, w]], { cols: [500, 10, 490] }))

  it('the line between them goes: every edge on it moves to the far line, the space joins B', () => {
    const out = mergeTrackInto(sliver, 'columns', 1, 2, ids())
    expect(picture(out)).toEqual(['x y', 'z w'])
    expect(out.grid.columns.map((t) => [t.id, t.weight])).toEqual([['c1', 500], ['c3', 500]])
    expectValid(out)
  })

  it('into A: the same cells, the space joins A', () => {
    const out = mergeTrackInto(sliver, 'columns', 1, 0, ids())
    expect(picture(out)).toEqual(['x y', 'z w'])
    expect(out.grid.columns.map((t) => [t.id, t.weight])).toEqual([['c1', 510], ['c3', 490]])
  })

  it('a cell lying only in the track moves toward the track it merges into', () => {
    const base = layout(grid([[cell('a'), cell('b'), cell('c')]]))
    expect(tabsOf(mergeTrackInto(base, 'columns', 1, 2, ids()), 'c')).toEqual(['c-t', 'b-t'])
    expect(tabsOf(mergeTrackInto(base, 'columns', 1, 0, ids()), 'a')).toEqual(['a-t', 'b-t'])
  })

  it('a track that isn’t beside it: the same layout', () => {
    expect(mergeTrackInto(sliver, 'columns', 0, 2, ids())).toBe(sliver)
  })
})

describe('evenTracks', () => {
  it('the weighted tracks share their weights evenly; fixed, fit and collapsed tracks keep theirs', () => {
    const n = numbers('n', ['n1'])
    const base = layout(grid([[n], [cell('a')], [cell('b')], [cell('c')], [cell('d')]], {
      rows: [700, { px: 120 }, 200, 600, { weight: 300, collapsed: true }],
    }))
    const out = evenTracks(base, 'rows')
    expect(out.grid.rows.map((t) => t.px ?? t.weight)).toEqual([700, 120, 400, 400, 300])
    expect(out.grid.rows[4]?.collapsed).toBe(true)
  })

  it('already even, or one weighted track: the same layout', () => {
    const even = layout(grid([[cell('a'), cell('b')]], { cols: [500, 500] }))
    expect(evenTracks(even, 'columns')).toBe(even)
    expect(evenTracks(even, 'rows')).toBe(even)
  })
})
