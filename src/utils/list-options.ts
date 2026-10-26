import type { TodoGroupBy, TodoSortBy, TodoSortDirection } from '../models/todo-sort-group'
import { effectiveSortDirection, sortHasDirection } from '../models/todo-sort-group'
import type { ListDefinition, RuntimeFilterField } from '../models/list-definition'

/** Groupings a list definition offers, in menu order. */
export const LIST_GROUP_CHOICES: readonly TodoGroupBy[] = ['none', 'priority', 'deadline', 'followup', 'people', 'status', 'tag']

/** Sorts a list definition offers, in menu order. */
export const LIST_SORT_CHOICES: readonly TodoSortBy[] = ['manual', 'priority', 'deadline', 'followup', 'name', 'people', 'status', 'created', 'modified']

/** Prompt fields a list definition offers, in menu order (`none` = no prompt). */
export const LIST_PROMPT_CHOICES: readonly (RuntimeFilterField | 'none')[] = ['none', 'person', 'status', 'tag']

/** Group choice labels; `none` is the menu's way back to no groups (an unset field shows a placeholder). */
export const GROUP_LABEL: Record<TodoGroupBy, string> = {
  none: 'No grouping',
  deadline: 'Due date',
  followup: 'Follow-up date',
  people: 'People',
  status: 'Status',
  tag: 'Tag',
  priority: 'Priority',
}

export const SORT_LABEL: Record<TodoSortBy, string> = {
  manual: 'Manual',
  priority: 'Priority',
  deadline: 'Due date',
  followup: 'Follow-up date',
  name: 'Name',
  created: 'Created',
  modified: 'Modified',
  people: 'People',
  status: 'Status',
}

export const PROMPT_LABEL: Record<RuntimeFilterField | 'none', string> = {
  none: 'None',
  person: 'Person',
  status: 'Status',
  tag: 'Tag',
}

/**
 * The choices for a control: the offered `choices`, plus the stored `current`
 * value when it isn't one of them (a value no longer offered stays visible
 * until the user picks another).
 */
export function choicesWith<T extends string>(choices: readonly T[], current: T): readonly T[] {
  return choices.includes(current) ? choices : [...choices, current]
}

/** A group choice's muted note in the Group menu. */
export const GROUP_NOTE: Partial<Record<TodoGroupBy, string>> = {
  priority: 'Hot, Focus, Urgent, Important, No priority · a task shows in each of its groups',
}

/** A sort choice's muted note in the Sort menu. */
export const SORT_NOTE: Partial<Record<TodoSortBy, string>> = {
  manual: 'Your drag order (per list)',
  priority: 'Focus first, then Urgent + Important, Urgent, Important, the rest · ties by due date',
  modified: 'Longest untouched first · any edit counts, a reorder too',
  people: 'By name of the first person, A → Z · unassigned last',
  status: 'In the statuses’ order (Settings) · no status last',
}

/** What each direction of a sort puts first, in words (sorts with a direction only). */
const SORT_ORDER_WORDS: Partial<Record<TodoSortBy, Record<TodoSortDirection, string>>> = {
  priority: { asc: 'Highest priority first', desc: 'Lowest priority first' },
  deadline: { asc: 'Soonest first', desc: 'Latest first' },
  followup: { asc: 'Soonest first', desc: 'Latest first' },
  name: { asc: 'A → Z', desc: 'Z → A' },
  created: { asc: 'Oldest first', desc: 'Newest first' },
  modified: { asc: 'Longest untouched first', desc: 'Recently changed first' },
}

/** `sort` in `direction`, in words (`Latest first`); `null` for a sort without a direction. */
export function sortOrderWords(sort: TodoSortBy, direction: TodoSortDirection): string | null {
  return SORT_ORDER_WORDS[sort]?.[direction] ?? null
}

/**
 * A sort's label with its direction: `Due date ↓` when descending; the
 * natural order (and Manual) shows no arrow.
 */
export function sortSummary(sort: TodoSortBy, direction?: TodoSortDirection): string {
  const label = SORT_LABEL[sort] ?? sort
  return effectiveSortDirection(sort, direction) === 'desc' ? `${label} ↓` : label
}

/**
 * The filter line's group · sort summary, e.g. `People · Due date` (or
 * `People · Due date ↓` descending); an ungrouped list shows just its sort
 * (`Priority`, or `Manual` in drag order).
 */
export function groupSortSummary(grouping: TodoGroupBy, sort: TodoSortBy, direction?: TodoSortDirection): string {
  const sortLabel = sortSummary(sort, direction)
  if (grouping === 'none') return sortLabel
  return `${GROUP_LABEL[grouping] ?? grouping} · ${sortLabel}`
}

/**
 * `def` sorted by `sort`. The direction carries over to another sort with a
 * direction (Due ↓ → Name ↓) and is dropped for one without (Manual).
 */
export function withListSort<T extends Pick<ListDefinition, 'sort' | 'sortDirection'>>(def: T, sort: TodoSortBy): T {
  const next = { ...def, sort }
  if (!sortHasDirection(sort)) delete next.sortDirection
  return next
}

/** `def` in `direction`: `desc` is stored, the natural order (`asc`) as no field. */
export function withSortDirection<T extends Pick<ListDefinition, 'sortDirection'>>(def: T, direction: TodoSortDirection): T {
  const next = { ...def }
  if (direction === 'desc') next.sortDirection = 'desc'
  else delete next.sortDirection
  return next
}
