export enum AppView {
  Canvas = 'canvas',
  Dashboard = 'dashboard',
  List = 'list',
  Calendar = 'calendar',
  Settings = 'settings',
}

export type ListSortBy = 'date' | 'scheduled' | 'deadline' | 'people' | 'project' | 'org' | 'status'

/** What ListView / list-definition groups tasks by. `'none'` = flat list (no grouping).
 *  `'tag'` is not a `ListSortBy` — a tag-as-sort is meaningless for a many-per-task
 *  field — so list-definitions serialize it via `ListGrouping.kind = 'by-tag'`. */
export type ListGroupBy = 'none' | 'date' | 'scheduled' | 'deadline' | 'people' | 'project' | 'org' | 'status' | 'tag'

/** Sort applied within each group (or across the whole list when groupBy='none').
 *  Kept aligned with preset `ListSort` so ListView state round-trips losslessly
 *  into a saved list-definition: 'manual' ↔ sort-order, chronological values ↔
 *  `{kind:'sortBy', by:X}`.
 */
export type ListItemSortBy = 'manual' | 'date' | 'scheduled' | 'deadline'

export type DateField = 'date' | 'scheduled' | 'deadline' | 'created' | 'modified'
