import type { Corner, CornerOwner, EmptySideClaim, RailSide, RailsState } from '../models/canvas-rails'
import { cornerForSideClaim } from '../models/canvas-rails'
import type { FloatDockTarget } from './rail-dnd'

/**
 * Phase 4 float-dock helpers — extracted from `CanvasPage.tsx` so they're
 * unit-testable in isolation. Pure functions that take an explicit `rails`
 * state and return data/descriptors; dispatching (to `canvas-rails-store`,
 * `ui-store`, etc.) stays in the caller.
 */

/**
 * Find the active-tab kind of a slot by id, or `null` if the slot isn't
 * present in any rail. Used by the a11y announcer so the screen reader log
 * matches the rail-tab drag's wording (`"Dropped in lens slot"`).
 */
export function findSlotKindById(rails: RailsState, slotId: string): string | null {
  for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
    const rail = rails[side]
    if (!rail) continue
    const slot = rail.slots.find((s) => s.id === slotId)
    if (!slot) continue
    const activeTab = slot.tabs.find((t) => t.id === slot.activeTabId) ?? slot.tabs[0]
    return activeTab?.type ?? null
  }
  return null
}

/**
 * Build a short a11y announcement string for a resolved float-dock target.
 * Mirrors `RailsFrame.tsx`'s `describeDropZone` phrasing so rails-tab and
 * float-dock announcements read identically in a screen reader log.
 */
export function describeFloatDockTarget(target: FloatDockTarget, rails: RailsState): string {
  if (target.kind === 'empty-side') return `Dropped in ${target.side} rail`
  const slotKind = findSlotKindById(rails, target.slotId) ?? 'slot'
  if (target.kind === 'tab-strip') return `Dropped in ${slotKind} tab strip`
  return `Dropped in ${slotKind} slot`
}

/**
 * One corner assignment produced by a float dropping on an empty side's
 * start/end sub-zone. `owner: null` means "clear this corner" (equivalent to
 * the default `'v'` — vertical rail owns). Caller dispatches through the
 * rails store's `setCornerOwner` / `clearCornerOwner` actions.
 */
export interface CornerAssignment {
  corner: Corner
  owner: CornerOwner | null
}

/**
 * Compute corner ownership implied by a float dropping on an empty side's
 * start/end sub-zone. Mirrors `RailsFrame.tsx`'s `applyEmptySideCorners` for
 * the rail-tab drag path — a claimed corner goes to the dropping rail's
 * axis; the non-claimed sibling corner is pinched to the opposite axis so
 * perpendicular rails stay out of the way.
 *
 * Returns two `CornerAssignment`s (start corner, end corner). Owners of
 * `'v'` are emitted as `null` so callers can bias toward clearing entries
 * over writing defaults (keeps persisted corner bag minimal).
 */
export function computeEmptySideCornerClaim(side: RailSide, claim: EmptySideClaim): CornerAssignment[] {
  const isHorizontal = side === 'top' || side === 'bottom'
  const claimedOwner: CornerOwner = isHorizontal ? 'h' : 'v'
  const pinchedOwner: CornerOwner = isHorizontal ? 'v' : 'h'
  const startCorner = cornerForSideClaim(side, 'start')
  const endCorner = cornerForSideClaim(side, 'end')
  const toOwner = (o: CornerOwner): CornerOwner | null => (o === 'v' ? null : o)
  if (claim === 'start') {
    return [
      { corner: startCorner, owner: toOwner(claimedOwner) },
      { corner: endCorner, owner: toOwner(pinchedOwner) },
    ]
  }
  return [
    { corner: startCorner, owner: toOwner(pinchedOwner) },
    { corner: endCorner, owner: toOwner(claimedOwner) },
  ]
}
