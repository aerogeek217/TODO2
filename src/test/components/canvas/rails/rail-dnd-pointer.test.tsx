import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { RailsState, Slot, SlotKind } from '../../../../models/canvas-rails'

function s(id: string, kind: SlotKind): Slot {
  return { id, tabs: [{ id: `${id}-t0`, type: kind }], activeTabId: `${id}-t0` }
}
import { setupRailsHarness, resetRailsStore } from '../../../utils/rail-dnd-harness'
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
    h.cleanup()
  })
})

describe('rails dragSlot — edge dock', () => {
  it('drops onto head of a populated right rail → source inserted at index 0', async () => {
    const h = await setupRailsHarness(leftLensRightNotes())
    await h.dragSlot('slot-A', { kind: 'edge', side: 'right', edge: 'head' })
    const rails = h.getRails()
    expect(rails.left).toBeNull()
    expect(rails.right?.slots.map((s) => s.id)).toEqual(['slot-A', 'slot-B'])
    h.cleanup()
  })

  it('drops onto tail of a populated right rail → source inserted at end', async () => {
    const h = await setupRailsHarness(leftLensRightNotes())
    await h.dragSlot('slot-A', { kind: 'edge', side: 'right', edge: 'tail' })
    expect(h.getRails().right?.slots.map((s) => s.id)).toEqual(['slot-B', 'slot-A'])
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
  // Phase 7: verify a populated horizontal Top rail accepts drops on every
  // zone. The DockOverlay's empty-side 'top' zone is intentionally gone when
  // top is populated; edge + split drops route through the rail's own
  // droppables, which sit in document flow below the TopBar + FileSyncBanner
  // (canvasHost is position:relative and the overlay is inset:0 inside it —
  // no fixed 48px offset anywhere in production rails code).

  it('drop on top-edge head inserts the source at index 0', async () => {
    const h = await setupRailsHarness(leftLensTopTwo())
    await h.dragSlot('slot-A', { kind: 'edge', side: 'top', edge: 'head' })
    const rails = h.getRails()
    expect(rails.left).toBeNull()
    expect(rails.top?.slots.map((s) => s.id)).toEqual(['slot-A', 'slot-T1', 'slot-T2'])
    h.cleanup()
  })

  it('drop on top-edge tail appends the source', async () => {
    const h = await setupRailsHarness(leftLensTopTwo())
    await h.dragSlot('slot-A', { kind: 'edge', side: 'top', edge: 'tail' })
    expect(h.getRails().top?.slots.map((s) => s.id)).toEqual(['slot-T1', 'slot-T2', 'slot-A'])
    h.cleanup()
  })

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
