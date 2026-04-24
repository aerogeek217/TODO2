/**
 * Compute the drop index for a pointer release over a taskboard panel, by
 * bisecting visible `[data-tbp-entry]` children by Y. Returns
 * `entryRects.length` (append) when the pointer is past the last entry, or
 * when the panel is empty.
 *
 * Used by `TopBar`'s search-result drag-end handler — the only non-trivial
 * piece of that handler is this bisection. Lives here (not in TopBar) so the
 * helper sits next to the rest of the task-DnD vocabulary and tests don't
 * have to import from a layout component to exercise pure DOM math.
 */
export function computeSearchDropIndex(
  pointerY: number,
  entryRects: readonly { top: number; height: number }[],
): number {
  for (let i = 0; i < entryRects.length; i++) {
    const r = entryRects[i]
    if (pointerY < r.top + r.height / 2) return i
  }
  return entryRects.length
}
