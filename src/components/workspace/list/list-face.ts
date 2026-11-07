import type { PersistedTodoItem } from '../../../models'
import type { TabBadgeCounts } from '../../../utils/tab-badges'

/** A list tab's faces (D25 R, `ListFace`): what their lines read. */

/** A quick row's height (px): the medium face fits as many as its room takes. */
export const LIST_FACE_ROW_PX = 24

/** The earliest due date among the open tasks, or null. */
export function oldestDue(todos: readonly Pick<PersistedTodoItem, 'isCompleted' | 'dueDate'>[]): Date | null {
  let oldest: Date | null = null
  for (const t of todos) {
    if (t.isCompleted || !t.dueDate) continue
    const d = new Date(t.dueDate)
    if (!oldest || d.getTime() < oldest.getTime()) oldest = d
  }
  return oldest
}

/** The count's colour: the tab badge's (due first, then follow-up) while it counts anything, else the text colour. */
export function faceCountColor(counts: TabBadgeCounts | undefined): string | undefined {
  if (!counts) return undefined
  if (counts.due > 0) return 'var(--color-overdue)'
  if (counts.followup > 0) return 'var(--color-followup)'
  return undefined
}

/** How many quick rows a medium face shows in `room` px (its rows' box; `+N more` sits under it) of `total`. */
export function quickRowsShown(room: number, total: number): number {
  return Math.min(total, Math.max(0, Math.floor(room / LIST_FACE_ROW_PX)))
}
