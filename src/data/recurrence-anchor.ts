import type { TodoItem } from '../models'

/**
 * Predicate: a recurrence rule has a concrete date to advance from iff the
 * row carries a `dueDate`. Mirrors `recurrenceAnchor`'s contract in
 * `services/recurrence.ts` — that function returns null in exactly the
 * shapes this returns false for, which is when `advanceRecurring`
 * short-circuits and the rule never fires.
 *
 * Shared by `todoRepository.update` / `bulkUpdate` (drops the orphaned rule
 * on write) and the audit pass (detects orphaned rules in legacy rows).
 */
export function hasRecurrenceAnchor(t: Pick<TodoItem, 'dueDate'>): boolean {
  return t.dueDate != null
}
