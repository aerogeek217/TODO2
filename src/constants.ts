/** Default color for new tags and statuses. */
export const DEFAULT_ENTITY_COLOR = '#537FE7'

/** Avatar fill for a person with no color set (neutral grey). */
export const NEUTRAL_PERSON_COLOR = '#9CA3AF'

// ─── Timing thresholds (ms) ───
/** Window during which a second key in a chord shortcut counts (e.g. `g` then `w`). */
export const CHORD_TIMEOUT_MS = 1000
/** Click-then-edit delay used by inline editors to distinguish click from double-click. */
export const INLINE_EDIT_CLICK_DELAY_MS = 250
/** How long the undo snackbar stays visible after an undoable action. */
export const UNDO_SNACKBAR_MS = 5000
/** How long a notice in the snackbar (`useUndoStore.notify`, no Undo) stays visible. */
export const NOTICE_SNACKBAR_MS = 8000
/** Search-input debounce in `TopBar` before the live filter pass runs. */
export const SEARCH_DEBOUNCE_MS = 150
/** Toast visibility window for the in-popover convert-to-task toast. */
export const TOAST_VISIBLE_MS = 1800
/** Window after which JSON-export blob URLs are revoked. Long enough for the
 *  user to click the `<a download>` and finish the save dialog. */
export const OBJECT_URL_REVOKE_MS = 60_000

// ─── Geometry thresholds (px) ───
/** Pixel distance the pointer must travel before a dnd-kit `PointerSensor`
 *  activates a drag. Sized small enough not to feel laggy, large enough that
 *  a click-and-release on a sortable handle stays a click. */
export const DRAG_ACTIVATION_DISTANCE_PX = 5

// ─── Byte sizes ───
export const BYTES_PER_KB = 1024
