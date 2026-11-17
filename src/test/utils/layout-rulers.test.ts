import { describe, it, expect } from 'vitest'
import { createTab, type LayoutBody } from '../../models/workspace-layout'
import { columnShare, isSliverTrack, removeTrackMessage, rowCanCollapse, rowMark, runPlaceWords, sliverRun, trackNames } from '../../utils/layout-rulers'
import { trackRemoval } from '../../utils/workspace-layout-ops'
import { cell as spec, grid, type CellSpec } from '../helpers/layout-builders'

/** The rulers' words and tracks (layout edit mode E2): letters, shares, marks, slivers, and Remove's message. */

function cell(id: string, kind: 'notes' | 'number' = 'notes', tabIds: string[] = [`${id}-t`]): CellSpec {
  const tabs = tabIds.map((t) => createTab(kind, t))
  return spec(id, tabs, tabs[0] ? { activeTabId: tabs[0].id } : {})
}

/** A tab's title: its id, upper-cased first letter (`a-t` → `A-t`). */
const title = (tabId: string) => tabId.charAt(0).toUpperCase() + tabId.slice(1)

describe('names and marks', () => {
  it('letters columns A … Z, then AA', () => {
    const row = Array.from({ length: 28 }, (_, i) => cell(`k${i}`))
    const names = trackNames(grid([row]), 'columns', [])
    expect([0, 1, 25, 26, 27].map((i) => names[i])).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })

  it('a sliver is drawn under 24px with no cell lying only in it; the majors are named in order past it', () => {
    const x = cell('x')
    const y = cell('y')
    const z = cell('z')
    const body = grid([[x, y, y], [z, z, cell('w')]], { cols: [500, 10, 490] })
    const sizes = [600, 10, 590]
    expect(isSliverTrack(body, 'columns', 1, sizes)).toBe(true)
    expect(trackNames(body, 'columns', sizes)).toEqual(['A', null, 'B'])
    // Unmeasured: no slivers.
    expect(trackNames(body, 'columns', [])).toEqual(['A', 'B', 'C'])
    // A narrow track a cell lies only in is no sliver.
    const narrow = grid([[cell('a'), cell('b')]])
    expect(isSliverTrack(narrow, 'columns', 1, [600, 20])).toBe(false)
  })

  it('a column’s share among the weighted columns; a fixed one its px', () => {
    const body = grid([[cell('a'), cell('b'), cell('c')]], { cols: [300, 100, { px: 200 }] })
    expect([0, 1, 2].map((i) => columnShare(body, i))).toEqual(['75%', '25%', '200px'])
  })

  it('a row is marked fit or folded', () => {
    const body = grid([[cell('n', 'number')], [cell('a')], [cell('b')]], { rows: [1000, { weight: 500, collapsed: true }, 500] })
    expect([0, 1, 2].map((i) => rowMark(body, i))).toEqual(['fit', 'folded', null])
  })

  it('a row collapses only while a filled cell lies only in it', () => {
    const t = cell('t')
    const body = grid([[t, cell('a')], [t, spec('e', [])]])
    expect(rowCanCollapse(body, 0)).toBe(true)
    expect(rowCanCollapse(body, 1)).toBe(false)
  })
})

describe('a sliver and its two lines act as one line', () => {
  const x = cell('x')
  const y = cell('y')
  const z = cell('z')
  const w = cell('w')
  // Rows: 1, a sliver (part of the line between x and z moved 10px down), 2.
  const body = grid([[x, y], [x, w], [z, w]], { rows: [500, 10, 490] })
  const sizes = [500, 10, 490]

  it('the run of lines beside a sliver, from either of its lines; a plain line alone', () => {
    expect(sliverRun(body, 'rows', 1, sizes)).toEqual([1, 2])
    expect(sliverRun(body, 'rows', 2, sizes)).toEqual([1, 2])
    expect(sliverRun(body, 'rows', 0, sizes)).toEqual([0, 0])
    expect(sliverRun(body, 'rows', 3, sizes)).toEqual([3, 3])
    // Unmeasured: no slivers, no runs.
    expect(sliverRun(body, 'rows', 1, [])).toEqual([1, 1])
  })

  it('names the majors around a run, never the sliver', () => {
    const names = trackNames(body, 'rows', sizes)
    expect(names).toEqual(['1', null, '2'])
    expect(runPlaceWords(names, 1, 2, 'row')).toBe('between 1 and 2')
    expect(runPlaceWords(names, 0, 0, 'row')).toBe('before 1')
    expect(runPlaceWords(names, 3, 3, 'row')).toBe('after 2')
  })
})

describe('removeTrackMessage', () => {
  const message = (body: LayoutBody, axis: 'rows' | 'columns', index: number) => {
    const plan = trackRemoval(body, axis, index)
    if (!plan) throw new Error('no plan')
    return removeTrackMessage(body, axis, index, plan, title)
  }

  it('names what joins what, one sentence per cell that takes widgets', () => {
    const body = grid([[cell('a'), cell('b')], [cell('c', 'notes', ['c1', 'c2']), cell('d')]])
    expect(message(body, 'rows', 1)).toBe('C1 and C2 join A-t as tabs. D-t joins B-t as a tab.')
  })

  it('several cells into one: said together', () => {
    const a = cell('a')
    const body = grid([[a, a], [cell('c'), cell('d')]])
    expect(message(body, 'rows', 1)).toBe('C-t and D-t join A-t as tabs.')
  })

  it('a move into an empty place', () => {
    const e = spec('e', [])
    const body = grid([[cell('a'), cell('b')], [e, cell('d')]])
    expect(message(body, 'columns', 0)).toBe('A-t joins B-t as a tab.')
    expect(message(grid([[e, cell('b')], [cell('c'), cell('d')]]), 'rows', 1)).toBe('C-t moves into the row above. D-t joins B-t as a tab.')
  })

  it('a Numbers strip joining a cell of other widgets: its Numbers become tabs', () => {
    const s = cell('s', 'number', ['n1', 'n2'])
    const body = grid([[s, s], [cell('a'), cell('b')]])
    expect(message(body, 'rows', 0)).toBe('The Numbers strip (N1 and N2) joins A-t: its Numbers become tabs.')
  })

  it('widgets joining a Numbers strip: it becomes tabs; Numbers joining Numbers: one strip', () => {
    const s = cell('s', 'number', ['n1', 'n2'])
    expect(message(grid([[s], [cell('a')]]), 'rows', 1)).toBe('A-t joins the Numbers strip, whose Numbers become tabs.')
    expect(message(grid([[s], [cell('m', 'number', ['m1'])]]), 'rows', 1)).toBe('M1 joins the Numbers strip.')
    expect(message(grid([[cell('k', 'number', ['k1'])], [cell('m', 'number', ['m1'])]]), 'rows', 1)).toBe('M1 joins K1 in one Numbers strip.')
  })

  it('nothing lying only in the track: the cells across it get shorter', () => {
    const t = cell('t')
    const u = cell('u')
    expect(message(grid([[t, u], [t, u]]), 'rows', 1)).toBe('No widget lies only in this row: the cells across it get shorter.')
  })
})
