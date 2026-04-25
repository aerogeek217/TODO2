import type {
  ListGroupBy,
  ListItemSortBy,
  ListSortBy,
} from '../models'
import type { ListGrouping, ListSort } from '../models/list-definition'

/**
 * Runtime translators between the persisted list-view shape (group / sort / itemSortBy)
 * and the `ListDefinition.{sort, grouping}` encoding the canvas + lens widgets read.
 *
 * Lives in `utils/` rather than `data/` so the layering rule holds: views import
 * from `utils/`, never from `data/`. The legacy SavedView types still live in
 * `data/saved-view-legacy.ts` and are imported only by migration + restore.
 */

/**
 * Translate a persisted saved-view sortBy value into the current `ListSortBy`.
 * Legacy tokens (`priority`, `due`, `tag`) fold to `'date'` so old rows still
 * produce a readable group.
 */
export function translateSortBy(sortBy: string): ListSortBy {
  if (sortBy === 'priority' || sortBy === 'due' || sortBy === 'tag') return 'date'
  if (sortBy === 'date' || sortBy === 'scheduled' || sortBy === 'deadline'
      || sortBy === 'people'
      || sortBy === 'project' || sortBy === 'org' || sortBy === 'status') {
    return sortBy
  }
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
    // 'name' is sort-only — never a group; fall back to 'date'.
    groupBy = translated === 'name' ? 'date' : translated
  }
  const itemSortBy: ListItemSortBy = v.itemSortBy ?? 'manual'
  return { groupBy, itemSortBy }
}

/**
 * Encode runtime group/sort choice into a list-definition's `sort` + `grouping`.
 * One encoder shared between the ListView save path and the v39 migration.
 */
export function encodeGroupSort(
  groupBy: ListGroupBy,
  itemSortBy: ListItemSortBy,
): { sort: ListSort; grouping: ListGrouping } {
  const sort: ListSort = itemSortBy === 'manual'
    ? { kind: 'sort-order' }
    : { kind: 'sortBy', by: itemSortBy }

  let grouping: ListGrouping
  if (groupBy === 'none') {
    grouping = { kind: 'none' }
  } else if (groupBy === 'tag') {
    grouping = { kind: 'by-tag' }
  } else if (itemSortBy !== 'manual' && groupBy === itemSortBy) {
    grouping = { kind: 'by-sortBy' }
  } else {
    grouping = { kind: 'by-field', by: groupBy }
  }
  return { sort, grouping }
}
