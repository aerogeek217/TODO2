import { MARKER_KEYS, type MarkerKey, type PersistedTodoItem } from '../../../models'
import { MARKER_LABELS } from '../../../utils/markers'
import { idsByDate } from '../../../services/stats/stats-context'
import { bySortOrder } from '../../../utils/sort-order'

/** The task lookup every row-listing section reads. */
export interface TodoLookup {
  todoById: ReadonlyMap<number, PersistedTodoItem>
}

/** The open tasks of `tasks` matching `pick`, in dialog order. */
export function openIds(tasks: readonly PersistedTodoItem[], pick: (t: PersistedTodoItem) => boolean): number[] {
  return idsByDate(tasks.filter((t) => !t.isCompleted && pick(t)), 'deadline')
}

/** Task ids in `sortOrder`. */
export function inSortOrder(ids: readonly number[], data: TodoLookup): number[] {
  return ids.flatMap((id) => {
    const t = data.todoById.get(id)
    return t ? [t] : []
  }).sort(bySortOrder).map((t) => t.id)
}

/** The priority badges in words, for a row's name: `2 Focus, 1 Urgent, `. */
export function priorityWords(counts: Record<MarkerKey, number>): string {
  return MARKER_KEYS.filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${MARKER_LABELS[k]}, `).join('')
}
