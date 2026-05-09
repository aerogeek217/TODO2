import type { TodoItem } from '../models'

/**
 * Predicate: a recurrence rule has a concrete date to advance from iff the
 * row carries a `dueDate` or a precise (`kind: 'date'`) `scheduledDate`.
 * Mirrors `recurrenceAnchor`'s contract in `services/recurrence.ts` — that
 * function returns null in exactly the same shapes this returns false for,
 * which is when `advanceRecurring` short-circuits and the rule never fires.
 *
 * Shared by `todoRepository.update` / `bulkUpdate` (drops the orphaned rule
 * on write) and the audit pass (detects orphaned rules in legacy rows).
 */
export function hasPreciseRecurrenceAnchor(
  t: Pick<TodoItem, 'dueDate' | 'scheduledDate'>,
): boolean {
  if (t.dueDate) return true
  if (t.scheduledDate?.kind === 'date') return true
  return false
}
