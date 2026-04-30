import type {
  ListGroupBy,
  ListItemSortBy,
  ListSortBy,
} from '../models'
import { isTodoSortBy, isTodoGroupBy } from '../models'
import type { ListGrouping, ListSort } from '../models/list-definition'

/**
 * Runtime translators between the persisted list-view shape (group / sort / itemSortBy)
 * and the `ListDefinition.{sort, grouping}` encoding the canvas + lens widgets read.
 *
 * Lives in `utils/` rather than `data/` so the layering rule holds: views import
 * from `utils/`, never from `data/`.
 *
 * Post ui-consistency-2026-04-25 P4 the `sort` / `grouping` fields are flat
 * `TodoSortBy` / `TodoGroupBy` literals (the discriminated unions were
 * collapsed in v46). The encoder is now near-trivial — kept as a function
 * carrier so callers don't reach into the model directly.
 */

/**
 * Translate a persisted saved-view sortBy value into the current `ListSortBy`.
 * Legacy tokens (`priority`, `due`, `tag`) fold to `'date'` so old rows still
 * produce a readable group.
 */
export function translateSortBy(sortBy: string): ListSortBy {
  if (sortBy === 'priority' || sortBy === 'due' || sortBy === 'tag') return 'date'
  if (isTodoSortBy(sortBy)) return sortBy
  return 'date'
}

/**
 * Resolve grouping + within-group sort from a persisted saved view, falling
 * back to the legacy single `sortBy` field for views saved before group/sort
 * were split.
 */
export function resolveSavedViewGrouping(v: { sortBy: string; groupBy?: ListGroupBy; itemSortBy?: ListItemSortBy }): {
  groupBy: ListGroupBy
  itemSortBy: ListItemSortBy
} {
  let groupBy: ListGroupBy
  if (v.groupBy != null) {
    groupBy = v.groupBy
  } else {
    const translated = translateSortBy(v.sortBy)
    // Sort-only fields ('name', 'manual', 'created') aren't valid groupings —
    // fall back to 'date'.
    groupBy = isTodoGroupBy(translated) ? translated : 'date'
  }
  const itemSortBy: ListItemSortBy = v.itemSortBy ?? 'manual'
  return { groupBy, itemSortBy }
}

/**
 * Encode runtime group/sort choice into a list-definition's `sort` + `grouping`.
 * Post-flatten the encoder is the identity: `sort = itemSortBy`,
 * `grouping = groupBy`. Kept as a one-line carrier so call sites don't reach
 * into the model directly.
 */
export function encodeGroupSort(
  groupBy: ListGroupBy,
  itemSortBy: ListItemSortBy,
): { sort: ListSort; grouping: ListGrouping } {
  return { sort: itemSortBy, grouping: groupBy }
}
