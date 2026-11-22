import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem } from '../../models'
import { buildListSections, listSortComparator, isUngroupedSectionKey, type ListSectionsContext } from '../../services/list-sections'
import { resolveCrossGroupMutation } from '../../utils/cross-group-drag'
import { GROUP_LABEL, LIST_GROUP_CHOICES, LIST_SORT_CHOICES, SORT_LABEL, sortOrderWords } from '../../utils/list-options'
import { makeTodo } from '../helpers'

/**
 * A list sorted and grouped by the planned date (`doDate`): sorted earliest
 * first with no plan last (held tasks have none), grouped as the due date
 * is — Delayed (a planned day before today), Today, This Week, Later — then
 * Unplanned (held in the Planner's Unplanned tray), then Not planned.
 */

// Monday 12 Jan 2026; the week runs Monday to Sunday.
const MONDAY = new Date(2026, 0, 12)
const day = (n: number) => new Date(2026, 0, 12 + n)

const ctx: ListSectionsContext = {
  today: MONDAY,
  weekStartsOn: 1,
  people: [],
  statuses: [],
  assignedPeopleMap: new Map(),
  assignedTagsMap: new Map(),
}

const titles = (todos: readonly PersistedTodoItem[]) => todos.map((t) => t.title)

const TASKS = (): PersistedTodoItem[] => [
  makeTodo({ id: 1, title: 'Not planned', sortOrder: 0, dueDate: day(1) }),
  makeTodo({ id: 2, title: 'Later', sortOrder: 1, doDate: day(10) }),
  makeTodo({ id: 3, title: 'Held', sortOrder: 2, unplanned: true, nextFollowupAt: day(2) }),
  makeTodo({ id: 4, title: 'Today', sortOrder: 3, doDate: day(0) }),
  makeTodo({ id: 5, title: 'Missed', sortOrder: 4, doDate: day(-3) }),
  makeTodo({ id: 6, title: 'Thursday', sortOrder: 5, doDate: day(3), dueDate: day(3) }),
]

describe('sort by Planned', () => {
  it('earliest first, no plan last (held tasks too), ties by sortOrder', () => {
    expect(titles([...TASKS()].sort(listSortComparator('planned')))).toEqual(['Missed', 'Today', 'Thursday', 'Later', 'Not planned', 'Held'])
  })

  it('reversed: latest first, no plan still last', () => {
    expect(titles([...TASKS()].sort(listSortComparator('planned', { direction: 'desc' })))).toEqual(['Later', 'Thursday', 'Today', 'Missed', 'Not planned', 'Held'])
  })

  it('reads the day, not the time', () => {
    const a = makeTodo({ id: 1, title: 'A', sortOrder: 1, doDate: new Date(2026, 0, 13, 18) })
    const b = makeTodo({ id: 2, title: 'B', sortOrder: 0, doDate: new Date(2026, 0, 13, 6) })
    const c = makeTodo({ id: 3, title: 'C', sortOrder: 2, doDate: new Date(2026, 0, 12, 23) })
    expect(titles([a, b, c].sort(listSortComparator('planned')))).toEqual(['C', 'B', 'A'])
  })
})

describe('group by Planned', () => {
  it('Delayed, Today, This Week, Later, then Unplanned, then Not planned', () => {
    const sections = buildListSections(TASKS(), { groupBy: 'planned', sortBy: 'manual' }, ctx)
    expect(sections.map((s) => [s.key, s.label, titles(s.todos)])).toEqual([
      ['overdue', 'Delayed', ['Missed']],
      ['today', 'Today', ['Today']],
      ['week', 'This Week', ['Thursday']],
      ['later', 'Later', ['Later']],
      ['unplanned', 'Unplanned', ['Held']],
      ['none', 'Not planned', ['Not planned']],
    ])
    expect(sections.find((s) => s.key === 'overdue')?.accentColor).toBe('var(--color-overdue)')
    expect(sections.find((s) => s.key === 'unplanned')?.accentColor).toBe('var(--color-text-muted)')
    expect(isUngroupedSectionKey('planned', 'none')).toBe(true)
    expect(isUngroupedSectionKey('planned', 'unplanned')).toBe(false)
  })

  it('an empty group is not shown', () => {
    const sections = buildListSections([makeTodo({ id: 1, title: 'Held', unplanned: true })], { groupBy: 'planned', sortBy: 'manual' }, ctx)
    expect(sections.map((s) => s.key)).toEqual(['unplanned'])
  })

  it('a drag between its groups writes nothing: the groups are derived, as the due date’s', () => {
    expect(resolveCrossGroupMutation('planned', 'today', 'week', 1)).toBeNull()
    expect(resolveCrossGroupMutation('planned', 'unplanned', '__ungrouped', 1)).toBeNull()
  })
})

describe('the pickers', () => {
  it('offer Planned after Due among the sorts and the groupings', () => {
    expect(LIST_SORT_CHOICES.slice(0, 5)).toEqual(['manual', 'priority', 'deadline', 'planned', 'followup'])
    expect(LIST_GROUP_CHOICES.slice(0, 5)).toEqual(['none', 'priority', 'deadline', 'planned', 'followup'])
    expect(SORT_LABEL.planned).toBe('Planned date')
    expect(GROUP_LABEL.planned).toBe('Planned date')
    expect(sortOrderWords('planned', 'asc')).toBe('Earliest first')
    expect(sortOrderWords('planned', 'desc')).toBe('Latest first')
  })
})
