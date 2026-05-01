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
/** Outer-frame fallback for the FLIP drop-phantom + animating-row cleanup
 *  paths in `SortableTaskList`. Fires after the CSS transition's expected end
 *  to clear stale state if `transitionend` never lands. */
export const PHANTOM_CLEANUP_OUTER_MS = 600
/** How long the undo snackbar stays visible after an undoable action. */
export const UNDO_SNACKBAR_MS = 5000
/** Search-input debounce in `TopBar` before the live filter pass runs. */
export const SEARCH_DEBOUNCE_MS = 150
/** Toast visibility window for the in-popover convert-to-task toast. */
export const TOAST_VISIBLE_MS = 1800
/** Trailing setTimeout used by InsertTrigger / SortableTaskList to land focus
 *  after a re-render race during the enter-chain handshake. */
export const FLIP_FOCUS_RETRY_MS = 50
/** Window after which JSON-export blob URLs are revoked. Long enough for the
 *  user to click the `<a download>` and finish the save dialog. */
export const OBJECT_URL_REVOKE_MS = 60_000

// ─── Geometry thresholds (px) ───
/** Pixel distance the pointer must travel before a dnd-kit `PointerSensor`
 *  activates a drag. Sized small enough not to feel laggy, large enough that
 *  a click-and-release on a sortable handle stays a click. */
export const DRAG_ACTIVATION_DISTANCE_PX = 5
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

// ─── Byte sizes ───
export const BYTES_PER_KB = 1024
/** Hard cap on the serialized `canvasRails` setting value. Mirrored by
 *  `import-validation.ts`'s `SETTING_VALUE_MAX_LEN_BY_KEY` entry. */
export const MAX_CANVAS_RAILS_SETTING_BYTES = 8000
