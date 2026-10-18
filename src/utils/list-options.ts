import type { TodoGroupBy, TodoSortBy } from '../models/todo-sort-group'
import type { RuntimeFilterField } from '../models/list-definition'

/** Groupings a list definition offers, in menu order. */
export const LIST_GROUP_CHOICES: readonly TodoGroupBy[] = ['none', 'deadline', 'followup', 'people', 'status', 'tag']

/** Sorts a list definition offers, in menu order. */
export const LIST_SORT_CHOICES: readonly TodoSortBy[] = ['manual', 'priority', 'deadline', 'followup', 'name', 'created']

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
}

export const SORT_LABEL: Record<TodoSortBy, string> = {
  manual: 'Manual',
  priority: 'Priority',
  deadline: 'Due date',
  followup: 'Follow-up date',
  name: 'Name',
  created: 'Created',
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

/** A sort choice's muted note in the Sort menu. */
export const SORT_NOTE: Partial<Record<TodoSortBy, string>> = {
  manual: 'Your drag order (per list)',
  priority: 'Focus first, then Urgent + Important, Urgent, Important, the rest · ties by due date',
}

/**
 * The filter line's group · sort summary, e.g. `People · Due date`; an
 * ungrouped list shows just its sort (`Priority`, or `Manual` in drag order).
 */
export function groupSortSummary(grouping: TodoGroupBy, sort: TodoSortBy): string {
  const sortLabel = SORT_LABEL[sort] ?? sort
  if (grouping === 'none') return sortLabel
  return `${GROUP_LABEL[grouping] ?? grouping} · ${sortLabel}`
}
