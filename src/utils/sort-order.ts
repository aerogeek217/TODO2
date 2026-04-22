import type { TodoItem } from '../models'

/**
 * Sort comparator for sortOrder, with id as a stable tiebreaker.
 * Id fallback of 0 is safe: persisted todos always have ids, and pre-insert
 * todos sharing sortOrder keep the caller's insertion order (both sides get 0).
 */
export const bySortOrder = (a: TodoItem, b: TodoItem) =>
  (a.sortOrder - b.sortOrder) || ((a.id ?? 0) - (b.id ?? 0))
