import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { RailsFrame } from '../../../../components/canvas/rails/RailsFrame'
import { useCanvasRailsStore } from '../../../../stores/canvas-rails-store'
import { useListDefinitionStore } from '../../../../stores/list-definition-store'
import { useSettingsStore } from '../../../../stores/settings-store'
import { useUIStore } from '../../../../stores/ui-store'
import { resetRailsStore } from '../../../helpers'
import {
  COLLAPSED_RAIL_PX,
  DEFAULT_VERTICAL_RAIL_WIDTH,
  EMPTY_RAILS,
  type Rail,
  type RailsState,
} from '../../../../models/canvas-rails'

/**
 * Pin Phase 6.5.2 (real-browser-testing plan): `RailsFrame` only emits the
 * `--{side}-size` CSS var when the rail exists. `DockOverlay`'s corner
 * sub-zones size on `var(--{side}-size, 80px)`, so the var-unset case fires
 * the 80 px fallback (corner-claim hit-target preserved when the
 * perpendicular rail is absent), while a present rail (collapsed at
 * `COLLAPSED_RAIL_PX` or expanded at any width) sizes the corner sub-zone to
 * exactly the rail's width — preventing the pre-fix 80 px overshoot that
 * occluded collapsed-rail slot stubs from `document.elementsFromPoint` and
 * routed collapsed-stub float drops to corner-claim instead of slot-merge.
 */

const lensRail: Rail = {
  orientation: 'vertical',
  slots: [{ id: 'slot-a', tabs: [{ id: 'slot-a-t0', type: 'lens' }], activeTabId: 'slot-a-t0' }],
}

function setRails(rails: RailsState): void {
  useCanvasRailsStore.setState({ rails, hydrated: true, pendingFocusSlotId: null })
}

function frameStyleVar(name: string): string | undefined {
  const frame = document.querySelector<HTMLElement>('.react-flow__viewport, [class*="frame"]')
    ?? document.querySelector<HTMLElement>('div[style*="--"]')
  if (!frame) return undefined
  const raw = frame.getAttribute('style') ?? ''
  const match = raw.match(new RegExp(`${name}:\\s*([^;]+)`))
  return match?.[1]?.trim()
}

beforeEach(() => {
  resetRailsStore({ hydrated: true })
  useSettingsStore.setState({ canvasRails: null, horizonSlots: [] })
  useListDefinitionStore.setState({ listDefinitions: [] })
  useUIStore.setState({ floatDrag: null, floatAnnouncement: '' })
})

afterEach(cleanup)

describe('RailsFrame frame-style CSS vars (DockOverlay corner sizing contract)', () => {
  it('omits every --{side}-size when no rail exists (so corner sub-zones use the 80px fallback)', () => {
    setRails(EMPTY_RAILS)
    render(
      <DndContext>
        <RailsFrame>
          <div />
        </RailsFrame>
      </DndContext>,
    )
    expect(frameStyleVar('--left-size')).toBeUndefined()
    expect(frameStyleVar('--right-size')).toBeUndefined()
    expect(frameStyleVar('--top-size')).toBeUndefined()
    expect(frameStyleVar('--bottom-size')).toBeUndefined()
  })

  it('emits --left-size with the expanded rail width when the rail exists', () => {
    setRails({ ...EMPTY_RAILS, left: lensRail })
    render(
      <DndContext>
        <RailsFrame>
          <div />
        </RailsFrame>
      </DndContext>,
    )
    expect(frameStyleVar('--left-size')).toBe(`${DEFAULT_VERTICAL_RAIL_WIDTH}px`)
    expect(frameStyleVar('--right-size')).toBeUndefined()
  })

  it('emits --left-size as COLLAPSED_RAIL_PX when the rail is collapsed (no overshoot)', () => {
    setRails({ ...EMPTY_RAILS, left: lensRail, collapsed: { left: true } })
    render(
      <DndContext>
        <RailsFrame>
          <div />
        </RailsFrame>
      </DndContext>,
    )
    // Pre-6.5.2 the corner sub-zone clamped to 80px and overshot the 28px
    // collapsed rail by 52px, occluding the rail's slot stub. Post-fix the
    // var carries 28 and the corner sub-zone matches the rail exactly.
    expect(frameStyleVar('--left-size')).toBe(`${COLLAPSED_RAIL_PX}px`)
  })

  it('emits each --{side}-size independently (a present top + absent left does not leak --left-size)', () => {
    setRails({
      ...EMPTY_RAILS,
      top: { orientation: 'horizontal', slots: [{ id: 'top-a', tabs: [{ id: 'top-a-t0', type: 'notes' }], activeTabId: 'top-a-t0' }] },
    })
    render(
      <DndContext>
        <RailsFrame>
          <div />
        </RailsFrame>
      </DndContext>,
    )
    expect(frameStyleVar('--top-size')).toBeDefined()
    expect(frameStyleVar('--left-size')).toBeUndefined()
    expect(frameStyleVar('--right-size')).toBeUndefined()
    expect(frameStyleVar('--bottom-size')).toBeUndefined()
  })
})
