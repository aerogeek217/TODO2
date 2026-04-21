import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { RailsState, Slot, SlotKind } from '../../../../models/canvas-rails'

function s(id: string, kind: SlotKind): Slot {
  return { id, tabs: [{ id: `${id}-t0`, type: kind }], activeTabId: `${id}-t0` }
}
import { setupRailsHarness, resetRailsStore } from '../../../utils/rail-dnd-harness'
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

afterEach(cleanup)

function initialWithLeftLens(): RailsState {
  return {
    left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
    right: null,
    top: null,
    bottom: null,
  }
}

describe('rails harness — empty-side dock', () => {
  it('drops slot-A from left rail to empty top rail → top populated, left cleared', async () => {
    const h = await setupRailsHarness(initialWithLeftLens())
    expect(h.getRenderedSlotIds()).toEqual(['slot-A'])
    h.simulateDrop('slot-A', { kind: 'empty-side', side: 'top' })
    const rails = h.getRails()
    expect(rails.left).toBeNull()
    expect(rails.top?.slots.map((s) => s.id)).toEqual(['slot-A'])
    expect(rails.top?.orientation).toBe('horizontal')
    h.cleanup()
  })

  it('no-op if dropping slot to its own exclusive side', async () => {
    const h = await setupRailsHarness(initialWithLeftLens())
    h.simulateDrop('slot-A', { kind: 'empty-side', side: 'left' })
    expect(h.getRails().left?.slots.map((s) => s.id)).toEqual(['slot-A'])
    h.cleanup()
  })
})

describe('rails harness — edge dock', () => {
  it('drops onto head of a populated right rail → source inserted at index 0', async () => {
    const initial: RailsState = {
      left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
      right: { orientation: 'vertical', slots: [s('slot-B', 'notes')] },
      top: null,
      bottom: null,
    }
    const h = await setupRailsHarness(initial)
    h.simulateDrop('slot-A', { kind: 'edge', side: 'right', edge: 'head' })
    const rails = h.getRails()
    expect(rails.left).toBeNull()
    expect(rails.right?.slots.map((s) => s.id)).toEqual(['slot-A', 'slot-B'])
    h.cleanup()
  })

  it('drops onto tail of a populated right rail → source inserted at end', async () => {
    const initial: RailsState = {
      left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
      right: { orientation: 'vertical', slots: [s('slot-B', 'notes')] },
      top: null,
      bottom: null,
    }
    const h = await setupRailsHarness(initial)
    h.simulateDrop('slot-A', { kind: 'edge', side: 'right', edge: 'tail' })
    expect(h.getRails().right?.slots.map((s) => s.id)).toEqual(['slot-B', 'slot-A'])
    h.cleanup()
  })
})

describe('rails harness — split quadrant', () => {
  it('drags onto upper half of a slot in a vertical rail → splits above target', async () => {
    const initial: RailsState = {
      left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
      right: { orientation: 'vertical', slots: [s('slot-B', 'notes')] },
      top: null,
      bottom: null,
    }
    const h = await setupRailsHarness(initial)
    // Upper half (y well above the midpoint) → zone 'above' → inserted before target.
    h.simulateDrop(
      'slot-A',
      { kind: 'slot', slotId: 'slot-B' },
      {
        pointer: { x: 50, y: 10 },
        rect: { left: 0, top: 0, width: 100, height: 200 },
        orientation: 'vertical',
      },
    )
    expect(h.getRails().right?.slots.map((s) => s.id)).toEqual(['slot-A', 'slot-B'])
    h.cleanup()
  })

  it('drags onto lower half of a slot in a vertical rail → splits below target', async () => {
    const initial: RailsState = {
      left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
      right: { orientation: 'vertical', slots: [s('slot-B', 'notes')] },
      top: null,
      bottom: null,
    }
    const h = await setupRailsHarness(initial)
    // Lower half → 'below' → inserted after target.
    h.simulateDrop(
      'slot-A',
      { kind: 'slot', slotId: 'slot-B' },
      {
        pointer: { x: 50, y: 190 },
        rect: { left: 0, top: 0, width: 100, height: 200 },
        orientation: 'vertical',
      },
    )
    expect(h.getRails().right?.slots.map((s) => s.id)).toEqual(['slot-B', 'slot-A'])
    h.cleanup()
  })
})

describe('rails harness — structural wiring', () => {
  it('renders one [data-slot-id] element per slot in the rails state', async () => {
    const initial: RailsState = {
      left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
      right: { orientation: 'vertical', slots: [s('slot-B', 'notes'), s('slot-C', 'calendar')] },
      top: null,
      bottom: null,
    }
    const h = await setupRailsHarness(initial)
    expect(h.getRenderedSlotIds().sort()).toEqual(['slot-A', 'slot-B', 'slot-C'])
    h.cleanup()
  })

  it('every registered drop zone encodes/decodes round-trip', async () => {
    const initial: RailsState = {
      left: { orientation: 'vertical', slots: [s('slot-A', 'lens')] },
      right: null,
      top: null,
      bottom: null,
    }
    const h = await setupRailsHarness(initial)
    const zones = h.getDroppableZones()
    // Left has 1 slot (+2 edges). Right/top/bottom empty (3 × empty-side).
    const kinds = zones.map((z) => z.kind).sort()
    expect(kinds).toEqual(['edge', 'edge', 'empty-side', 'empty-side', 'empty-side', 'slot'])
    h.cleanup()
  })
})
