/**
 * A task's place in a list's manual order. One row per (list, task) pair
 * that has been placed; a task without a row is unranked and shows after
 * the ranked ones, oldest first.
 *
 * Ranks are fractional: moving a task writes only its own row (the midpoint
 * of its new neighbours' ranks). They are only read while the list's sort
 * is manual.
 */
export interface ListOrder {
  id?: number
  listDefinitionId: number
  todoId: number
  rank: number
}

export type PersistedListOrder = ListOrder & { id: number }
