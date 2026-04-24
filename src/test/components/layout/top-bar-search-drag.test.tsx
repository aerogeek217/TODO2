import { describe, it, expect } from 'vitest'
import { computeSearchDropIndex } from '../../../components/layout/TopBar'

/**
 * P3 (features-batch-2026-04) — search-result drag to taskboard.
 *
 * The only non-trivial logic in TopBar's drag-end handler is the pointer-Y
 * bisection that picks an insertion index in the visible taskboard entry
 * list. Unit-test it here.
 *
 * The wider drag flow — pointer sensor → DndContext → DOM hit-test against
 * `[data-taskboard-panel-id]` → `useTaskboardStore.addAt` — is exercised by
 * hand (and by the plan's exit criteria). Simulating real pointer events in
 * JSDOM through dnd-kit + `document.elementFromPoint` is fragile and wouldn't
 * add confidence over what the surface-id contract (see
 * `task-dnd/ids.test.ts` and `TaskDraggable.test.tsx`) plus this helper
 * already cover.
 *
 * P1 of `search-and-notes-bugs`: the drag-end handler *must* read the dragged
 * todo from a component ref, not from `event.active.data.current`. The
 * dropdown unmounts on drag start, which deletes the `SearchResultRow`'s
 * entry from dnd-kit's `draggableNodes`; once that happens, dnd-kit falls
 * `active.data` back to its internal `defaultData` (`{ current: {} }`), so at
 * drag end `event.active.data.current?.todo` is undefined and the handler
 * previously early-returned before `addAt` ran. The fix captures the todo in
 * `searchDragTodoRef` at drag start. If you change the data source, re-verify
 * the manual exit criteria.
 */
describe('computeSearchDropIndex — bisection by pointer Y', () => {
  it('returns 0 for an empty taskboard', () => {
    expect(computeSearchDropIndex(500, [])).toBe(0)
  })

  it('inserts before the first entry when pointer is above its midline', () => {
    const rects = [
      { top: 100, height: 40 }, // midline = 120
      { top: 140, height: 40 },
    ]
    expect(computeSearchDropIndex(110, rects)).toBe(0)
  })

  it('inserts between entries when pointer is between midlines', () => {
    const rects = [
      { top: 100, height: 40 }, // midline = 120
      { top: 140, height: 40 }, // midline = 160
      { top: 180, height: 40 }, // midline = 200
    ]
    expect(computeSearchDropIndex(150, rects)).toBe(1)
    expect(computeSearchDropIndex(190, rects)).toBe(2)
  })

  it('appends when pointer is past the last midline', () => {
    const rects = [
      { top: 100, height: 40 },
      { top: 140, height: 40 },
    ]
    expect(computeSearchDropIndex(500, rects)).toBe(2)
  })
})
