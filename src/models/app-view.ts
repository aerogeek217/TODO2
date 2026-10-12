import type { TodoSortBy, TodoGroupBy } from './todo-sort-group'

/** Alias of the unified `TodoSortBy`. */
export type ListSortBy = TodoSortBy

/** Alias of the unified `TodoGroupBy`. */
export type ListGroupBy = TodoGroupBy

/** Alias of the unified `TodoSortBy`. */
export type ListItemSortBy = TodoSortBy

export type DateField = 'deadline' | 'followup' | 'created' | 'modified'

export const DATE_FIELD_VALUES: readonly DateField[] = ['deadline', 'followup', 'created', 'modified']
