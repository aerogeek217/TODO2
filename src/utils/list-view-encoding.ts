import type { ListGroupBy, ListItemSortBy } from '../models'
import type { ListGrouping, ListSort } from '../models/list-definition'

/**
 * Encode ListView's runtime group/sort choice into a list-definition's
 * `sort` + `grouping`. The stored fields are flat `TodoSortBy` / `TodoGroupBy`
 * literals, so the encoder is the identity (`sort = itemSortBy`,
 * `grouping = groupBy`); it stays a one-line carrier so call sites don't reach
 * into the model directly.
 *
 * Lives in `utils/` rather than `data/` so the layering rule holds: views
 * import from `utils/`, never from `data/`.
 */
export function encodeGroupSort(
  groupBy: ListGroupBy,
  itemSortBy: ListItemSortBy,
): { sort: ListSort; grouping: ListGrouping } {
  return { sort: itemSortBy, grouping: groupBy }
}
