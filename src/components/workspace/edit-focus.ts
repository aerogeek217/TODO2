/**
 * The layout edit mode's focus (E3): every card and slot is a Tab stop
 * marked with its cell id (`EDIT_FOCUS_ATTR`). After a move remounts what
 * moved (a card dropped onto a slot lands in the slot's cell, a removed
 * widget leaves a slot) the focus follows it there.
 */

/** On a card's surface and a slot's button: its cell's id. */
export const EDIT_FOCUS_ATTR = 'data-edit-focus'

/** The card or slot of cell `cellId`, if drawn. */
function editItem(cellId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${EDIT_FOCUS_ATTR}="${CSS.escape(cellId)}"]`)
}

/**
 * Moves the focus to cell `cellId`'s card or slot once the edit that moved
 * it has drawn (the next frame; at once when it is drawn already and the
 * focus is still there).
 */
export function focusEditItem(cellId: string): void {
  const now = editItem(cellId)
  if (now && now === document.activeElement) return
  requestAnimationFrame(() => {
    editItem(cellId)?.focus({ preventScroll: false })
  })
}
