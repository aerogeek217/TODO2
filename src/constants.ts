/** Default color for new people, tags, and orgs. */
export const DEFAULT_ENTITY_COLOR = '#537FE7'

/** Color used for a person with no org assigned (neutral grey). */
export const UNAFFILIATED_PERSON_COLOR = '#9CA3AF'

// ─── Timing thresholds (ms) ───
/** Window during which a second key in a chord shortcut counts (e.g. `g` then `c`). */
export const CHORD_TIMEOUT_MS = 1000
/** Click-then-edit delay used by inline editors to distinguish click from double-click. */
export const INLINE_EDIT_BLUR_MS = 250
/** dnd-kit re-measure frequency while a task drag is in flight. */
export const DRAG_MEASURE_FREQUENCY_MS = 200
/** Outer + inner cleanup delay for the FLIP drop-phantom safety net. */
export const PHANTOM_CLEANUP_MS = 300
/** How long the undo snackbar stays visible after an undoable action. */
export const UNDO_SNACKBAR_MS = 5000

// ─── Geometry thresholds (px) ───
/** Snap-back radius around the original drag start: drops within this radius
 *  fall back to the source project rather than counting as an empty-canvas drop. */
export const SNAP_BACK_RADIUS_PX = 150
/** Minimum hit-target size for a `DockOverlay` corner sub-zone when its
 *  perpendicular rail is absent (matches the `max(var(--…-size), 80px)` floor
 *  in `DockOverlay.module.css`). */
export const CORNER_HIT_MIN_PX = 80
/** Default width for a floating widget popped out of a rail tab via pointer drag. */
export const DEFAULT_FLOAT_WIDTH = 320
/** Default height for a floating widget popped out of a rail tab via pointer drag. */
export const DEFAULT_FLOAT_HEIGHT = 280
