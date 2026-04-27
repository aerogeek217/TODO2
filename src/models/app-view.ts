import type { TodoSortBy, TodoGroupBy } from './todo-sort-group'

export enum AppView {
  Canvas = 'canvas',
  Dashboard = 'dashboard',
  List = 'list',
  Calendar = 'calendar',
  Settings = 'settings',
}

/** Alias of the unified `TodoSortBy` (post ui-consistency-2026-04-25 P4). */
export type ListSortBy = TodoSortBy

/** Alias of the unified `TodoGroupBy` (post ui-consistency-2026-04-25 P4). */
export type ListGroupBy = TodoGroupBy

/** Alias of the unified `TodoSortBy` (post ui-consistency-2026-04-25 P4). */
export type ListItemSortBy = TodoSortBy

export type DateField = 'date' | 'scheduled' | 'deadline' | 'created' | 'modified'
