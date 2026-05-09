/**
 * Sort comparator for `sortOrder`, with `id` as a stable tiebreaker.
 *
 * Generic over any type with `sortOrder: number` and an optional `id?: number`,
 * so the same comparator works for `TodoItem` / `Status` / `Project` /
 * `ListDefinition` / etc. Id fallback of 0 is safe: persisted rows always
 * carry ids, and pre-insert rows sharing a `sortOrder` keep the caller's
 * insertion order (both sides get 0).
 */
export const bySortOrder = <T extends { sortOrder: number; id?: number }>(
  a: T,
  b: T,
): number => (a.sortOrder - b.sortOrder) || ((a.id ?? 0) - (b.id ?? 0))
