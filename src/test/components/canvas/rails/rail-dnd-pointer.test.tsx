import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { RailsState, Slot, SlotKind } from '../../../../models/canvas-rails'

function s(id: string, kind: SlotKind): Slot {
  return { id, tabs: [{ id: `${id}-t0`, type: kind }], activeTabId: `${id}-t0` }
}
import { setupRailsHarness } from '../../../utils/rail-dnd-harness'
import { resetRailsStore } from '../../../helpers'
import * as railDnd from '../../../../utils/rail-dnd'
import { db } from '../../../../data/database'
import { useCanvasStore } from '../../../../stores/canvas-store'
import { useNoteStore } from '../../../../stores/note-store'
import { useTodoStore } from '../../../../stores/todo-store'
import { useSettingsStore } from '../../../../stores/settings-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  resetRailsStore()
  useCanvasStore.setState({ selectedCanvasId: null })
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
  useTodoStore.setState({ todos: [], loading: false, error: null })
  useSettingsStore.setState({ defaultProjectId: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function leftLens(): RailsState {
  return {
    left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
    right: null,
    top: null,
    bottom: null,
  }
}

function leftLensRightNotes(): RailsState {
  return {
    left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
    right: { orientation: 'vertical', slots: [s('slot-B', 'notes')] },
    top: null,
    bottom: null,
  }
}

function leftLensTopTwo(): RailsState {
  return {
    left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
    right: null,
    top: {
      orientation: 'horizontal',
      slots: [
        s('slot-T1', 'lens'),
        s('slot-T2', 'notes'),
      ],
    },
    bottom: null,
  }
}

describe('rails dragSlot — empty-side dock', () => {
  it('drags slot-A from left rail onto empty top rail', async () => {
    const h = await setupRailsHarness(leftLens())
    await h.dragSlot('slot-A', { kind: 'empty-side', side: 'top' })
    const rails = h.getRails()
    expect(rails.left).toBeNull()
    expect(rails.top?.slots.map((s) => s.id)).toEqual(['slot-A'])
    expect(rails.top?.orientation).toBe('horizontal')
    // Center drop leaves corners untouched (legacy behavior).
    expect(rails.corners).toBeUndefined()
    h.cleanup()
  })

  it('claim=start on top strip docks the slot and sets corners.nw = "h"', async () => {
    const h = await setupRailsHarness(leftLensRightNotes())
    await h.dragSlot('slot-A', { kind: 'empty-side', side: 'top', claim: 'start' })
    const rails = h.getRails()
    expect(rails.top?.slots.map((s) => s.id)).toEqual(['slot-A'])
    expect(rails.corners).toEqual({ nw: 'h' })
    h.cleanup()
  })

  it('claim=end on top strip sets corners.ne = "h"', async () => {
    const h = await setupRailsHarness(leftLensRightNotes())
    await h.dragSlot('slot-A', { kind: 'empty-side', side: 'top', claim: 'end' })
    const rails = h.getRails()
    expect(rails.top?.slots.map((s) => s.id)).toEqual(['slot-A'])
    expect(rails.corners).toEqual({ ne: 'h' })
    h.cleanup()
  })

  it('center drop on top wipes stale horizontal claims (pinched = default)', async () => {
    // Prior 'h' claims from a since-closed top rail must not resurrect into
    // the new rail and make it full-width. For top/bottom drops pinched='v'
    // is the default, so the bag stays empty.
    const h = await setupRailsHarness({ ...leftLensRightNotes(), corners: { nw: 'h', ne: 'h' } })
    await h.dragSlot('slot-A', { kind: 'empty-side', side: 'top' })
    const rails = h.getRails()
    expect(rails.top?.slots.map((s) => s.id)).toEqual(['slot-A'])
    expect(rails.corners).toBeUndefined()
    h.cleanup()
  })

  it('center drop on left pinches against perpendicular rails (sets h on adjacent corners)', async () => {
    // User scenario: top + bottom rails exist; user drags bottom to dock left
    // via the center sub-zone. Left must NOT extend into NW (top owns) or
    // SW (bottom doesn't exist after the move, so `resolveCorner` falls back
    // to 'v' → left owns SW anyway). Stored corners: `{ nw: 'h', sw: 'h' }`.
    const h = await setupRailsHarness({
      left: null,
      right: null,
      top: { orientation: 'horizontal', slots: [s('slot-T', 'lens')] },
      bottom: { orientation: 'horizontal', slots: [s('slot-B', 'notes')] },
    })
    await h.dragSlot('slot-B', { kind: 'empty-side', side: 'left' })
    const rails = h.getRails()
    expect(rails.bottom).toBeNull()
    expect(rails.left?.slots.map((s) => s.id)).toEqual(['slot-B'])
    expect(rails.corners).toEqual({ nw: 'h', sw: 'h' })
    h.cleanup()
  })

  it('claim=start on top pinches the non-claimed (east) corner', async () => {
    // Prior ne='h' claim should be cleared when the user explicitly picks start.
    const h = await setupRailsHarness({ ...leftLensRightNotes(), corners: { ne: 'h' } })
    await h.dragSlot('slot-A', { kind: 'empty-side', side: 'top', claim: 'start' })
    // start → nw='h' (claimed); end → ne pinched='v' (default, cleared).
    expect(h.getRails().corners).toEqual({ nw: 'h' })
    h.cleanup()
  })

  // Corner-hit cases — pinning that the empty-side strip's corner sub-zone
  // retains a non-zero hit target when the perpendicular rail is absent —
  // were migrated to `e2e/canvas-rail-dock.spec.ts` in P13 of
  // `code-review-2026-04-30`. The CSS contract `var(--{perp}-size, 80px)`
  // is what JSDOM cannot authoritatively model.

  it('claim=start on left rail pinches SW (stores sw=h; clears default nw=v)', async () => {
    // Left claim=start means left extends into NW only. Pre-existing nw='h'
    // (a stale top claim) is overwritten with the dropped rail's axis 'v',
    // which for verticals is default — so the entry is cleared, not stored.
    const h = await setupRailsHarness({
      left: null,
      right: { orientation: 'vertical', slots: [s('slot-B', 'notes')] },
      top: { orientation: 'horizontal', slots: [s('slot-T', 'lens')] },
      bottom: null,
      corners: { nw: 'h' },
    })
    await h.dragSlot('slot-T', { kind: 'empty-side', side: 'left', claim: 'start' })
    // start claimed → nw='v' (default → cleared). end pinched → sw='h' stored.
    expect(h.getRails().corners).toEqual({ sw: 'h' })
    h.cleanup()
  })
})

describe('rails dragSlot — split quadrant', () => {
  it('upper half of a vertical slot → splits above target', async () => {
    const h = await setupRailsHarness(leftLensRightNotes())
    await h.dragSlot('slot-A', { kind: 'slot', slotId: 'slot-B', quadrant: 'upper' })
    expect(h.getRails().right?.slots.map((s) => s.id)).toEqual(['slot-A', 'slot-B'])
    h.cleanup()
  })

  it('lower half of a vertical slot → splits below target', async () => {
    const h = await setupRailsHarness(leftLensRightNotes())
    await h.dragSlot('slot-A', { kind: 'slot', slotId: 'slot-B', quadrant: 'lower' })
    expect(h.getRails().right?.slots.map((s) => s.id)).toEqual(['slot-B', 'slot-A'])
    h.cleanup()
  })

  it('center of a target slot on another rail → swaps the two slots in place', async () => {
    const h = await setupRailsHarness(leftLensRightNotes())
    await h.dragSlot('slot-A', { kind: 'slot', slotId: 'slot-B', quadrant: 'center' })
    const rails = h.getRails()
    expect(rails.left?.slots.map((s) => s.id)).toEqual(['slot-B'])
    expect(rails.right?.slots.map((s) => s.id)).toEqual(['slot-A'])
    h.cleanup()
  })
})

describe('rails dragSlot — cancel path', () => {
  it('pointerup outside any droppable is a no-op; announcement reads "Drop cancelled"', async () => {
    const h = await setupRailsHarness(leftLens())
    await h.dragSlot('slot-A', { kind: 'cancel' })
    const rails = h.getRails()
    expect(rails.left?.slots.map((s) => s.id)).toEqual(['slot-A'])
    expect(rails.top).toBeNull()
    const status = document.querySelector('[role="status"]')?.textContent
    expect(status).toBe('Drop cancelled')
    h.cleanup()
  })
})

describe('rails dragSlot — populated Top rail + TopBar coexistence', () => {
  // Phase 7: verify a populated horizontal Top rail accepts split drops.
  // The DockOverlay's empty-side 'top' zone is intentionally gone when top
  // is populated; split drops route through the rail's own slot droppables,
  // which sit in document flow below the TopBar + FileSyncBanner (canvasHost
  // is position:relative and the overlay is inset:0 inside it — no fixed
  // 48px offset anywhere in production rails code).

  it('split-left of a top slot inserts before target', async () => {
    const h = await setupRailsHarness(leftLensTopTwo())
    await h.dragSlot('slot-A', { kind: 'slot', slotId: 'slot-T1', quadrant: 'left' })
    expect(h.getRails().top?.slots.map((s) => s.id)).toEqual(['slot-A', 'slot-T1', 'slot-T2'])
    h.cleanup()
  })

  it('split-right of the last top slot inserts after target', async () => {
    const h = await setupRailsHarness(leftLensTopTwo())
    await h.dragSlot('slot-A', { kind: 'slot', slotId: 'slot-T2', quadrant: 'right' })
    expect(h.getRails().top?.slots.map((s) => s.id)).toEqual(['slot-T1', 'slot-T2', 'slot-A'])
    h.cleanup()
  })
})

describe('rails dragSlot — droppable id wiring smoke', () => {
  it('breaking encodeRailsDropId neutralises the drag (nothing collides)', async () => {
    vi.spyOn(railDnd, 'encodeRailsDropId').mockImplementation(() => 'rails:bogus:xyz')
    const h = await setupRailsHarness(leftLens())
    await h.dragSlot('slot-A', { kind: 'empty-side', side: 'top' })
    const rails = h.getRails()
    expect(rails.left?.slots.map((s) => s.id)).toEqual(['slot-A'])
    expect(rails.top).toBeNull()
    h.cleanup()
  })
})
