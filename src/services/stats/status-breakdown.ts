import { type PersistedTodoItem, type Status, type StatusIconKey, DEFAULT_STATUS_ICON } from '../../models'

export interface StatusBreakdownEntry {
  /** `null` represents the synthetic "No status" bucket. */
  id: number | null
  label: string
  icon: StatusIconKey
  count: number
  color: string
}

const NO_STATUS_LABEL = 'No status'
const NO_STATUS_COLOR = 'var(--color-text-muted)'

/**
 * Group open todos by `statusId`. "Open" = `!isCompleted`. Returns one entry
 * per status in `statuses` order (matches the user-defined sort), followed by
 * the synthetic "No status" bucket if any todos lack a `statusId`. Entries
 * with zero count are still emitted so the legend lists every configured
 * status.
 *
 * Note: D4 also calls for filtering by status `kind !== 'done'`, but the
 * Status model has no `kind` field today — this clause is a no-op until that
 * lands. The `!isCompleted` check covers the dominant case.
 */
export function selectStatusBreakdown(
  todos: readonly PersistedTodoItem[],
  statuses: readonly Status[],
): StatusBreakdownEntry[] {
  const counts = new Map<number, number>()
  let noStatusCount = 0

  for (const todo of todos) {
    if (todo.isCompleted) continue
    if (todo.statusId == null) {
      noStatusCount += 1
      continue
    }
    counts.set(todo.statusId, (counts.get(todo.statusId) ?? 0) + 1)
  }

  const entries: StatusBreakdownEntry[] = statuses
    .filter((s) => s.id != null)
    .map((s) => ({
      id: s.id!,
      label: s.name,
      icon: s.icon ?? DEFAULT_STATUS_ICON,
      count: counts.get(s.id!) ?? 0,
      color: s.color,
    }))

  if (noStatusCount > 0) {
    entries.push({
      id: null,
      label: NO_STATUS_LABEL,
      icon: DEFAULT_STATUS_ICON,
      count: noStatusCount,
      color: NO_STATUS_COLOR,
    })
  }

  return entries
}
