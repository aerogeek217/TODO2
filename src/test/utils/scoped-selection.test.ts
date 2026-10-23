import { describe, it, expect } from 'vitest'
import { nextScopedSelection, orderByRows, rowKey, type ScopedRow, type ScopedSelectionState } from '../../utils/scoped-selection'

// Task 3 shows twice: in Alice's group and in Bob's.
const rows: ScopedRow[] = [
  { key: rowKey('person-1', 1), todoId: 1 },
  { key: rowKey('person-1', 3), todoId: 3 },
  { key: rowKey('person-2', 2), todoId: 2 },
  { key: rowKey('person-2', 3), todoId: 3 },
  { key: rowKey('person-2', 4), todoId: 4 },
]

const none: ScopedSelectionState = { scope: null, ids: new Set(), anchorKey: null }

describe('nextScopedSelection', () => {
  it('one: that task, anchor and cursor on that occurrence', () => {
    expect(nextScopedSelection(none, 'w', rows, 'person-2|3', 'one')).toEqual({
      ids: new Set([3]), anchorKey: 'person-2|3', cursorKey: 'person-2|3', cursorTodoId: 3,
    })
  })

  it('range: every task between the anchor occurrence and the target, across groups', () => {
    const cur: ScopedSelectionState = { scope: 'w', ids: new Set([3]), anchorKey: 'person-1|3' }
    expect(nextScopedSelection(cur, 'w', rows, 'person-2|4', 'range')).toEqual({
      ids: new Set([3, 2, 4]), anchorKey: 'person-1|3', cursorKey: 'person-2|4', cursorTodoId: 4,
    })
    // Upwards from Bob's occurrence of 3: its own position counts, not Alice's.
    const fromBob: ScopedSelectionState = { scope: 'w', ids: new Set([3]), anchorKey: 'person-2|3' }
    expect(nextScopedSelection(fromBob, 'w', rows, 'person-2|2', 'range')?.ids).toEqual(new Set([2, 3]))
  })

  it('toggle adds and removes in the same widget', () => {
    const cur: ScopedSelectionState = { scope: 'w', ids: new Set([1]), anchorKey: 'person-1|1' }
    expect(nextScopedSelection(cur, 'w', rows, 'person-2|2', 'toggle')?.ids).toEqual(new Set([1, 2]))
    expect(nextScopedSelection(cur, 'w', rows, 'person-1|1', 'toggle')?.ids).toEqual(new Set())
  })

  it('another widget starts over, whatever the mode', () => {
    const elsewhere: ScopedSelectionState = { scope: 'other', ids: new Set([1, 2]), anchorKey: 'person-1|1' }
    expect(nextScopedSelection(elsewhere, 'w', rows, 'person-2|4', 'toggle')?.ids).toEqual(new Set([4]))
    expect(nextScopedSelection(elsewhere, 'w', rows, 'person-2|4', 'range')?.ids).toEqual(new Set([4]))
  })

  it('an unknown row is no selection', () => {
    expect(nextScopedSelection(none, 'w', rows, 'nope|9', 'one')).toBeNull()
  })
})

describe('orderByRows', () => {
  it('orders by each task’s first row; tasks with no row follow in the order given', () => {
    expect(orderByRows([4, 9, 3, 1], rows)).toEqual([1, 3, 4, 9])
    expect(orderByRows([2, 3], rows)).toEqual([3, 2])
    expect(orderByRows([], rows)).toEqual([])
  })
})
