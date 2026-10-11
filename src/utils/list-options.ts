import type { TodoGroupBy, TodoSortBy } from '../models/todo-sort-group'
import type { RuntimeFilterField } from '../models/list-definition'

/** Groupings a list definition offers, in menu order. */
export const LIST_GROUP_CHOICES: readonly TodoGroupBy[] = ['none', 'deadline', 'followup', 'people', 'status', 'tag']

/** Sorts a list definition offers, in menu order. */
export const LIST_SORT_CHOICES: readonly TodoSortBy[] = ['manual', 'deadline', 'followup', 'name', 'created']

/** Prompt fields a list definition offers, in menu order (`none` = no prompt). */
export const LIST_PROMPT_CHOICES: readonly (RuntimeFilterField | 'none')[] = ['none', 'person', 'status', 'tag']

export const GROUP_LABEL: Record<TodoGroupBy, string> = {
  none: 'None',
  deadline: 'Due date',
  followup: 'Follow-up date',
  people: 'People',
  status: 'Status',
  tag: 'Tag',
  project: 'Project',
}

export const SORT_LABEL: Record<TodoSortBy, string> = {
  manual: 'Manual',
  deadline: 'Due date',
  followup: 'Follow-up date',
  name: 'Name',
  created: 'Created',
  people: 'People',
  project: 'Project',
  status: 'Status',
}

export const PROMPT_LABEL: Record<RuntimeFilterField | 'none', string> = {
  none: 'None',
  person: 'Person',
  status: 'Status',
  tag: 'Tag',
  project: 'Project',
}

/**
 * The choices for a control: the offered `choices`, plus the stored `current`
 * value when it isn't one of them (a value no longer offered stays visible
 * until the user picks another).
 */
export function choicesWith<T extends string>(choices: readonly T[], current: T): readonly T[] {
  return choices.includes(current) ? choices : [...choices, current]
}

/** The list options summary, e.g. `People · Due date`. */
export function listOptionsSummary(grouping: TodoGroupBy, sort: TodoSortBy): string {
  const group = grouping === 'none' ? 'No groups' : (GROUP_LABEL[grouping] ?? grouping)
  return `${group} · ${SORT_LABEL[sort] ?? sort}`
}
