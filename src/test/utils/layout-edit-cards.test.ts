import { describe, it, expect } from 'vitest'
import { createTab, type LayoutBody } from '../../models/workspace-layout'
import {
  altMove,
  areaRulerName,
  cardName,
  cellRulerName,
  cornerArea,
  emptySlots,
  mergeButtonWords,
  mergeChoices,
  mergeMenuWords,
  otherCards,
  spatialNeighbour,
  stretchedArea,
  tapOutcome,
  trackReached,
} from '../../utils/layout-edit-cards'
import { cell as spec, grid, type CellSpec } from '../helpers/layout-builders'

/** The layout edit mode's card helpers (E3), pure. */

function cell(id: string): CellSpec {
  const tab = createTab('notes', `${id}-t`)
  return spec(id, [tab], { activeTabId: tab.id })
}
const slot = (id: string) => spec(id, [])

const area = (body: LayoutBody, id: string) => body.cells.find((c) => c.id === id)?.area

describe('ruler names', () => {
  const names = { columns: ['A', null, 'B'], rows: ['1', '2'] }

  it('a cell’s first column’s letter and first row’s number; a sliver skipped for the next major track', () => {
    expect(cellRulerName({ area: { col: 0, row: 1, colSpan: 1, rowSpan: 1 } }, names)).toBe('A2')
    expect(cellRulerName({ area: { col: 1, row: 0, colSpan: 2, rowSpan: 1 } }, names)).toBe('B1')
    // A cell over the sliver alone: the nearest name before it.
    expect(cellRulerName({ area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } }, names)).toBe('A1')
  })

  it('unmeasured: counted from A1', () => {
    expect(cellRulerName({ area: { col: 27, row: 3, colSpan: 1, rowSpan: 1 } }, { columns: [], rows: [] })).toBe('AB4')
  })

  it('an area: its first and last places', () => {
    expect(areaRulerName({ col: 0, row: 0, colSpan: 3, rowSpan: 2 }, names)).toBe('A1–B2')
    expect(areaRulerName({ col: 0, row: 0, colSpan: 1, rowSpan: 1 }, names)).toBe('A1')
  })
})

describe('cardName (a card named in the mode)', () => {
  const tabs = (kind: 'notes' | 'number', n: number) => Array.from({ length: n }, (_, i) => createTab(kind, `t${i}`))

  it('a lone widget its title; a card of tabs its first two and how many more; a Numbers strip its count; a slot nothing', () => {
    expect(cardName({ tabs: tabs('notes', 1) }, ['Tasks'])).toBe('Tasks')
    expect(cardName({ tabs: tabs('notes', 2) }, ['Tasks', 'Notes'])).toBe('Tasks, Notes')
    expect(cardName({ tabs: tabs('notes', 4) }, ['Tasks', 'Notes', 'Calendar', 'Trend'])).toBe('Tasks, Notes + 2')
    expect(cardName({ tabs: tabs('number', 3) }, ['Open', 'Late', 'Due'])).toBe('3 Numbers')
    expect(cardName({ tabs: [] }, [])).toBe('')
  })
})

describe('slots and cards', () => {
  const body = grid([[cell('a'), slot('e')], [slot('f'), cell('b')]])
  it('lists the empty cells and the other filled cells in reading order', () => {
    expect(emptySlots(body).map((c) => c.id)).toEqual(['e', 'f'])
    expect(otherCards(body, 'a').map((c) => c.id)).toEqual(['b'])
  })
})

describe('spatialNeighbour (the arrow keys)', () => {
  //  a a b
  //  c d d
  //  e e e
  const a = cell('a')
  const b = cell('b')
  const c = cell('c')
  const d = cell('d')
  const e = cell('e')
  const body = grid([[a, a, b], [c, d, d], [e, e, e]])

  it('the neighbour sharing the most of the edge', () => {
    expect(spatialNeighbour(body, 'a', 'right')?.id).toBe('b')
    expect(spatialNeighbour(body, 'e', 'top')?.id).toBe('d')
    // a's bottom edge: c shares one track, d one — the one whose middle is nearer a's (c: 0.5, d: 1.5 vs a's 1): a tie, the first.
    expect(spatialNeighbour(body, 'a', 'bottom')?.id).toBe('c')
    expect(spatialNeighbour(body, 'b', 'bottom')?.id).toBe('d')
  })

  it('none at the layout’s edge or for an unknown cell', () => {
    expect(spatialNeighbour(body, 'a', 'left')).toBeUndefined()
    expect(spatialNeighbour(body, 'a', 'top')).toBeUndefined()
    expect(spatialNeighbour(body, 'zz', 'top')).toBeUndefined()
  })

  it('a nearer middle wins a tie on the shared length', () => {
    //  x x x
    //  p q r
    const tall = grid([[cell('x'), cell('x'), cell('x')], [cell('p'), cell('q'), cell('r')]])
    expect(spatialNeighbour(tall, 'x', 'bottom')?.id).toBe('q')
  })
})

describe('stretchedArea and cornerArea', () => {
  const body = grid([[cell('a'), slot('e')], [cell('b'), slot('f')]])

  it('right / down grow over empty cells only; left / up give a track back, never the last', () => {
    expect(stretchedArea(body, 'a', 'right')).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 1 })
    expect(stretchedArea(body, 'a', 'down')).toBeNull()
    expect(stretchedArea(body, 'a', 'left')).toBeNull()
    expect(stretchedArea(body, 'a', 'up')).toBeNull()
    expect(stretchedArea(body, 'b', 'right')).toEqual({ col: 0, row: 1, colSpan: 2, rowSpan: 1 })
    expect(stretchedArea(body, 'zz', 'right')).toBeNull()
  })

  it('the corner dragged: from the top-left to the end, or null over a filled cell', () => {
    expect(cornerArea(body, 'a', { col: 1, row: 0 })).toEqual({ col: 0, row: 0, colSpan: 2, rowSpan: 1 })
    expect(cornerArea(body, 'a', { col: 1, row: 1 })).toBeNull()
    expect(cornerArea(body, 'a', { col: -3, row: -3 })).toEqual(area(body, 'a'))
  })

  it('trackReached: the last track whose middle the point has passed, never before the first allowed', () => {
    const axis = { starts: [0, 106, 212], sizes: [100, 100, 100] }
    expect(trackReached(axis, 90, 0)).toBe(0)
    expect(trackReached(axis, 160, 0)).toBe(1)
    expect(trackReached(axis, 155, 0)).toBe(0)
    expect(trackReached(axis, 999, 0)).toBe(2)
    expect(trackReached(axis, 10, 1)).toBe(1)
  })
})

describe('altMove (Alt+arrow)', () => {
  const body = grid([[cell('a'), slot('e')], [cell('b'), cell('c')]])
  it('onto a neighbouring slot, a swap with a neighbouring card, nothing at the edge', () => {
    expect(altMove(body, 'a', 'right')).toEqual({ kind: 'move', cellId: 'e' })
    expect(altMove(body, 'a', 'bottom')).toEqual({ kind: 'swap', cellId: 'b' })
    expect(altMove(body, 'a', 'left')).toBeNull()
  })
})

describe('tapOutcome', () => {
  const idle = { selectedCellId: null, moveArmed: false }
  const armedA = { selectedCellId: 'a', moveArmed: true }

  it('with nothing armed: a card selects, wherever it is tapped; a slot opens its kinds', () => {
    expect(tapOutcome(idle, { kind: 'card', cellId: 'a', zone: 'middle' })).toEqual({ kind: 'select', cellId: 'a' })
    // A card selected but not armed: a tap on another's tab area or middle selects it, never joins or swaps.
    expect(tapOutcome({ selectedCellId: 'a', moveArmed: false }, { kind: 'card', cellId: 'b', zone: 'tabs' })).toEqual({ kind: 'select', cellId: 'b' })
    expect(tapOutcome({ selectedCellId: 'a', moveArmed: false }, { kind: 'card', cellId: 'b', zone: 'middle' })).toEqual({ kind: 'select', cellId: 'b' })
    expect(tapOutcome(idle, { kind: 'slot', cellId: 'e' })).toEqual({ kind: 'menu', cellId: 'e' })
    // Selected by the keys (not armed): a slot still opens its kinds.
    expect(tapOutcome({ selectedCellId: 'a', moveArmed: false }, { kind: 'slot', cellId: 'e' })).toEqual({ kind: 'menu', cellId: 'e' })
  })

  it('with a card armed: a slot moves it, another card’s middle swaps, its tab area joins, its edge reselects, the card itself disarms', () => {
    expect(tapOutcome(armedA, { kind: 'slot', cellId: 'e' })).toEqual({ kind: 'move', from: 'a', to: 'e' })
    expect(tapOutcome(armedA, { kind: 'card', cellId: 'b', zone: 'middle' })).toEqual({ kind: 'swap', from: 'a', with: 'b' })
    expect(tapOutcome(armedA, { kind: 'card', cellId: 'b', zone: 'tabs' })).toEqual({ kind: 'join', from: 'a', into: 'b' })
    expect(tapOutcome(armedA, { kind: 'card', cellId: 'b', zone: 'edge' })).toEqual({ kind: 'select', cellId: 'b' })
    expect(tapOutcome(armedA, { kind: 'card', cellId: 'a', zone: 'edge' })).toEqual({ kind: 'disarm' })
  })
})

describe('mergeChoices and their words (the merge buttons, Merge ▾)', () => {
  const number = (id: string) => spec(id, [createTab('number', `${id}-t`)])
  // a  | b
  // c  | b
  // n1 | n2 | e   — under three columns
  const body = grid([
    [cell('a'), cell('b'), cell('b')],
    [cell('c'), cell('b'), cell('b')],
    [number('n1'), number('n2'), slot('e')],
  ])

  it('lists the neighbours sharing a whole edge, left, above, right, below — with what the merge makes', () => {
    // c: a above (a whole edge), n1 below; b (two rows high, two columns wide) is no rectangle.
    expect(mergeChoices(body, 'c').map((m) => [m.side, m.cell.id, m.kind])).toEqual([['top', 'a', 'tabs'], ['bottom', 'n1', 'tabs']])
    // n1: c above; n2 on its right — both only Numbers: one strip.
    expect(mergeChoices(body, 'n1').map((m) => [m.side, m.cell.id, m.kind])).toEqual([['top', 'c', 'tabs'], ['right', 'n2', 'strip']])
    // n2: the slot on its right.
    expect(mergeChoices(body, 'n2').find((m) => m.cell.id === 'e')?.kind).toBe('slot')
  })

  it('offers none for a slot (a slot selected has no merge buttons) or an unknown cell', () => {
    expect(mergeChoices(body, 'e')).toEqual([])
    expect(mergeChoices(body, 'nope')).toEqual([])
  })

  it('words a button from the selection’s side, short in a narrow neighbour; a Merge ▾ entry with its place', () => {
    expect(mergeButtonWords('tabs', 'Tasks')).toBe('Merge as tabs with Tasks')
    expect(mergeButtonWords('strip', 'Overdue')).toBe('Merge with Overdue')
    expect(mergeButtonWords('slot', '')).toBe('Stretch over this slot')
    expect(['tabs', 'strip', 'slot'].map((k) => mergeButtonWords(k as 'tabs', 'X', true))).toEqual(['Merge as tabs', 'Merge', 'Stretch here'])
    expect(mergeMenuWords({ kind: 'tabs', side: 'top' }, 'Tasks')).toBe('As tabs with Tasks (above)')
    expect(mergeMenuWords({ kind: 'strip', side: 'left' }, 'Open')).toBe('With Open (left)')
    expect(mergeMenuWords({ kind: 'slot', side: 'right' }, '')).toBe('Over the empty slot (right)')
  })
})
