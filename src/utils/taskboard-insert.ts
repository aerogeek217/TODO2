/**
 * Compute the insertion index for a task dropped onto a taskboard panel.
 *
 * Pointer Y (viewport coords) is compared against each rendered entry's
 * vertical midpoint. Returns 0..N where N is the entry count (append).
 *
 * Works for any TaskboardPanel on screen by looking up the panel by its
 * droppable id and scanning its `[data-tbp-entry]` children — keeps the
 * visual insertion indicator and the drop handler in sync without
 * plumbing pointer state through dnd-kit.
 */
export function computeTaskboardInsertIndex(
  panelDroppableId: string,
  pointerY: number,
): number {
  const panel = document.querySelector<HTMLElement>(
    `[data-taskboard-panel-id="${panelDroppableId}"]`,
  )
  if (!panel) return 0
  const rows = panel.querySelectorAll<HTMLElement>('[data-tbp-entry]')
  if (rows.length === 0) return 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect()
    if (pointerY < r.top + r.height / 2) return i
  }
  return rows.length
}
