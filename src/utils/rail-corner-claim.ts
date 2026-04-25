import type { Corner, CornerOwner, EmptySideClaim, RailSide } from '../models/canvas-rails'
import { cornerForSideClaim } from '../models/canvas-rails'
import { computeEmptySideCornerClaim, type CornerAssignment } from './float-dock-announce'

export interface CornerOwnerDispatchers {
  setCornerOwner: (corner: Corner, owner: CornerOwner) => void
  clearCornerOwner: (corner: Corner) => void
}

/**
 * Compute and dispatch corner ownership implied by an empty-side drop. Two
 * roles per adjacent corner:
 *   - claimed: dropped rail extends into the corner → owner matches the
 *     dropped rail's axis (`'h'` for top/bottom, `'v'` for left/right).
 *   - pinched: dropped rail does NOT extend into the corner → owner is the
 *     opposite axis, so perpendicular rails own the corner when present (and
 *     `resolveCorner` falls back cleanly when absent).
 *
 * Claim dispatch:
 *   - `claim='start'` → start corner claimed, end corner pinched
 *   - `claim='end'`   → end corner claimed, start corner pinched
 *   - no claim        → both corners pinched (the dropped rail is pinched
 *     between its perpendicular neighbors)
 *
 * Writes via `setCornerOwner` / `clearCornerOwner`: when the target owner
 * equals the default (`'v'`), we clear the entry instead of storing it, so
 * the persisted bag stays minimal (and single-side-present layouts keep
 * `rails.corners === undefined`).
 *
 * Defers the start/end claim assignments to `computeEmptySideCornerClaim` so
 * the rail-tab drag path and the float-dock path use a single corner-axis
 * resolver. The `undefined` (no-claim) case — which is the rail-tab path's
 * "neither end claimed, just pinched between perpendicular neighbors" —
 * lives only here because the float-dock path always lands on a sub-zone.
 */
export function applyEmptySideCorners(
  side: RailSide,
  claim: EmptySideClaim | undefined,
  dispatchers: CornerOwnerDispatchers,
): void {
  const assignments: CornerAssignment[] = claim
    ? computeEmptySideCornerClaim(side, claim)
    : pinchBothCorners(side)
  for (const assignment of assignments) {
    if (assignment.owner == null) {
      dispatchers.clearCornerOwner(assignment.corner)
    } else {
      dispatchers.setCornerOwner(assignment.corner, assignment.owner)
    }
  }
}

/**
 * No-claim variant: both corners pinched to the perpendicular axis. Returns
 * assignments in the same shape as `computeEmptySideCornerClaim` so the
 * dispatcher above can treat both branches identically.
 */
function pinchBothCorners(side: RailSide): CornerAssignment[] {
  const isHorizontal = side === 'top' || side === 'bottom'
  const pinchedOwner: CornerOwner = isHorizontal ? 'v' : 'h'
  const toOwner = (o: CornerOwner): CornerOwner | null => (o === 'v' ? null : o)
  return [
    { corner: cornerForSideClaim(side, 'start'), owner: toOwner(pinchedOwner) },
    { corner: cornerForSideClaim(side, 'end'), owner: toOwner(pinchedOwner) },
  ]
}
