/**
 * A task row's `onMouseDown`: the second press of a double-click (or a
 * triple-click) doesn't select the row's text — the double-click opens the
 * task, and a word selection would bring up the browser's text menu. Presses
 * in a text field (the inline title edit) keep their word selection.
 */
export function keepRowTextUnselected(e: React.MouseEvent): void {
  if (e.detail < 2) return
  const target = e.target
  if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
}
