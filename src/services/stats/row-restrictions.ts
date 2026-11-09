/**
 * How the top bar's `@` / `#` picks narrow a split by people or tags (a
 * Breakdown's rows, D26 P8), as they narrow a list grouped by People or Tag
 * (`build-list.groupRestrictions`, `list-sections`).
 */

/**
 * The person (or tag) "is" picks that narrow the People (Tags) rows, one
 * list per filter — the top bar's chips and its lens
 * (`build-list.groupRestrictions`) —, as they narrow a list grouped by
 * People or Tag. Id `0` is the Unassigned (No tags) pick.
 */
export type RowRestrictions = ReadonlyArray<ReadonlyArray<number>>

/**
 * The rows a task with `ids` (its people or tags, each once) counts under,
 * as `list-sections` groups it: with no restriction, each of its own; else
 * only the picked ones — those every restriction picks when it has any,
 * else those any one picks —, so `@Alice` counts a task of Alice and Bob
 * under Alice alone. Empty: the task has only ids nothing picks.
 */
export function restrictedRows(ids: readonly number[], restrictions: RowRestrictions): number[] {
  const picks = restrictions.filter((r) => r.length > 0)
  if (picks.length === 0) return [...ids]
  const anyPicks = ids.filter((id) => picks.some((r) => r.includes(id)))
  const everyPicks = anyPicks.filter((id) => picks.every((r) => r.includes(id)))
  return everyPicks.length > 0 ? everyPicks : anyPicks
}

/** Whether a task with no person (tag) keeps its Unassigned (No tag) row under `restrictions`. */
export function keepsNoneRow(restrictions: RowRestrictions): boolean {
  return restrictions.filter((r) => r.length > 0).every((r) => r.includes(0))
}
