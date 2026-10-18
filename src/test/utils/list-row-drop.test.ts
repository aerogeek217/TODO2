import { describe, it, expect } from 'vitest'
import { listRowDropTarget, type ListGeometry, type ListRowDragSource } from '../../utils/list-row-drop'

// Two groups of three 30px rows under a 28px header, 4px apart.
const geom: ListGeometry = {
  sections: [
    { key: 'person-1', top: 0, bottom: 122, rows: [
      { key: 'person-1|1', todoId: 1, mid: 43 },
      { key: 'person-1|3', todoId: 3, mid: 73 },
      { key: 'person-1|5', todoId: 5, mid: 103 },
    ] },
    { key: 'person-2', top: 126, bottom: 248, rows: [
      { key: 'person-2|2', todoId: 2, mid: 169 },
      { key: 'person-2|3', todoId: 3, mid: 199 },
      { key: 'person-2|6', todoId: 6, mid: 229 },
    ] },
  ],
}

const source: ListRowDragSource = { key: 'person-1|5', todoId: 5, sectionKey: 'person-1', index: 2 }

describe('listRowDropTarget', () => {
  it('counts the rows above the pointer, without the dragged one', () => {
    expect(listRowDropTarget(geom, 30, source, true)).toEqual({ sectionKey: 'person-1', index: 0, cross: false })
    expect(listRowDropTarget(geom, 60, source, true)).toEqual({ sectionKey: 'person-1', index: 1, cross: false })
    // Below the dragged row itself: still index 2 (its own place).
    expect(listRowDropTarget(geom, 115, source, true)).toEqual({ sectionKey: 'person-1', index: 2, cross: false })
  })

  it('another group is a cross-group target only when groups take rows', () => {
    expect(listRowDropTarget(geom, 180, source, true)).toEqual({ sectionKey: 'person-2', index: 1, cross: true })
    expect(listRowDropTarget(geom, 180, source, false)).toBeNull()
  })

  it('another occurrence of the same task counts as a row (it is a different row)', () => {
    const fromBob: ListRowDragSource = { key: 'person-2|3', todoId: 3, sectionKey: 'person-2', index: 1 }
    expect(listRowDropTarget(geom, 240, fromBob, true)).toEqual({ sectionKey: 'person-2', index: 2, cross: false })
    expect(listRowDropTarget(geom, 80, fromBob, true)).toEqual({ sectionKey: 'person-1', index: 2, cross: true })
  })

  it('a gap between groups goes to the next group; past the end, the last', () => {
    expect(listRowDropTarget(geom, 124, source, true)?.sectionKey).toBe('person-2')
    expect(listRowDropTarget(geom, 400, source, true)).toEqual({ sectionKey: 'person-2', index: 3, cross: true })
    expect(listRowDropTarget({ sections: [] }, 10, source, true)).toBeNull()
  })
})
