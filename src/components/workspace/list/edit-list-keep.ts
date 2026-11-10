/**
 * Marks a control that acts on Edit list's list itself — its filter line's
 * words and group · sort summary, which toggle it (value: the list's id): a
 * press on it isn't a press elsewhere, so it doesn't close Edit list.
 */
export const EDIT_LIST_KEEP_ATTR = 'data-edit-list-keep'

/** The open Edit list's close request (`requestEditListClose`), while one is open. */
let closeRequest: (() => boolean) | null = null

/** Edit list registers its close request while it is open (`null` when it closes). */
export function setEditListCloseRequest(request: (() => boolean) | null): void {
  closeRequest = request
}

/**
 * Asks the open Edit list to close, as Esc or × would: at once while it has
 * no changes, else it asks Save / Discard / Keep editing. Returns whether
 * it held the close (it asked) — the caller then does nothing more (what it
 * was about to do waits for the user, who can do it again). No Edit list
 * open: false.
 */
export function requestEditListClose(): boolean {
  return closeRequest?.() ?? false
}
