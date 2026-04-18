export enum AppView {
  Canvas = 'canvas',
  Dashboard = 'dashboard',
  List = 'list',
  Calendar = 'calendar',
  Settings = 'settings',
}

export type ListSortBy = 'date' | 'scheduled' | 'deadline' | 'people' | 'tag' | 'project' | 'org' | 'status'

/** What ListView / list-definition groups tasks by. `'none'` = flat list (no grouping). */
export type ListGroupBy = 'none' | 'date' | 'scheduled' | 'deadline' | 'people' | 'tag' | 'project' | 'org' | 'status'

/** Sort applied within each group (or across the whole list when groupBy='none').
 *  Kept aligned with preset `ListSort` so ListView state round-trips losslessly
 *  into a saved list-definition: 'manual' ↔ sort-order, chronological values ↔
 *  `{kind:'sortBy', by:X}`.
 */
export type ListItemSortBy = 'manual' | 'date' | 'scheduled' | 'deadline'

export type DateField = 'date' | 'scheduled' | 'deadline' | 'created' | 'modified'
