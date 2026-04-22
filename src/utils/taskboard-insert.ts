/**
 * Compute the insertion index *within the rendered (visible) entries* for a
 * task dropped onto a taskboard panel.
 *
 * Pointer Y (viewport coords) is compared against each rendered entry's
 * vertical midpoint. Returns 0..N where N is the visible row count (append).
 *
 * Works for any TaskboardPanel on screen by looking up the panel by its
 * droppable id and scanning its `[data-tbp-entry]` children — keeps the
 * visual insertion indicator and the drop handler in sync without plumbing
 * pointer state through dnd-kit.
 *
 * NOTE: this returns a *visible* index, suitable for rendering the indicator
 * inline with `visibleEntries.map((_, i) => ...)`. Drop handlers that call
 * `useTaskboardStore.addAt` need the *full-array* index — use
 * {@link computeTaskboardFullInsertIndex} instead, otherwise hidden /
 * completed entries above the drop will shift the result several rows up.
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

/**
 * Insertion index into the *full* taskboard entries array (the one
 * `useTaskboardStore.addAt` / `addMultipleAt` operate on). Same DOM scan as
 * {@link computeTaskboardInsertIndex}, but the visible row at the chosen
 * position is mapped back to its full-array slot via its `data-todo-id`
 * attribute. Required when visibility filters (`showCompleted`,
 * `showHiddenStatuses`) hide some entries — visible index N can correspond
 * to a much larger full-array index, and inserting at the visible index
 * would land the new entry rows above the indicator.
 */
export function computeTaskboardFullInsertIndex(
  panelDroppableId: string,
  pointerY: number,
  fullEntries: readonly { todoId: number }[],
): number {
  const panel = document.querySelector<HTMLElement>(
    `[data-taskboard-panel-id="${panelDroppableId}"]`,
  )
  if (!panel) return fullEntries.length
  const rows = panel.querySelectorAll<HTMLElement>('[data-tbp-entry]')
  if (rows.length === 0) return fullEntries.length
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect()
    if (pointerY < r.top + r.height / 2) {
      const todoId = Number(rows[i].dataset.todoId)
      if (!Number.isFinite(todoId)) return fullEntries.length
      const idx = fullEntries.findIndex((e) => e.todoId === todoId)
      return idx === -1 ? fullEntries.length : idx
    }
  }
  return fullEntries.length
}
