import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem, Person, Project, Status, Tag, TodoGroupBy, TodoSortBy } from '../../models'
import {
  buildListSections,
  listSortComparator,
  truncateSections,
  type ListSectionsContext,
  type ListSectionsSpec,
  type Section,
} from '../../services/list-sections'
import { makeTodo } from '../helpers'

function ctxWith(over: Partial<ListSectionsContext> = {}): ListSectionsContext {
  return {
    today: new Date(2026, 0, 12),
    weekStartsOn: 1,
    people: [],
    statuses: [],
    projects: [],
    assignedPeopleMap: new Map(),
    assignedTagsMap: new Map(),
    ...over,
  }
}

function build(
  todos: PersistedTodoItem[],
  groupBy: TodoGroupBy,
  over: Partial<ListSectionsContext> = {},
  spec: Partial<ListSectionsSpec> & { sortBy?: TodoSortBy } = {},
): Section[] {
  return buildListSections(todos, { groupBy, sortBy: 'manual', ...spec }, ctxWith(over))
}

const buildDeadlineSections = (todos: PersistedTodoItem[], weekStartsOn: 0 | 1, today: Date) =>
  build(todos, 'deadline', { weekStartsOn, today })
const buildFollowupSections = (todos: PersistedTodoItem[], weekStartsOn: 0 | 1, today: Date) =>
  build(todos, 'followup', { weekStartsOn, today })
const buildPeopleSections = (
  todos: PersistedTodoItem[],
  people: Person[],
  assignedPeopleMap: Map<number, Person[]>,
  restrictToPersonIds?: number[] | null,
) => build(todos, 'people', { people, assignedPeopleMap }, { restrictToPersonIds })
const buildTagSections = (
  todos: PersistedTodoItem[],
  assignedTagsMap: Map<number, Tag[]>,
  restrictToTagIds?: number[] | null,
) => build(todos, 'tag', { assignedTagsMap }, { restrictToTagIds })
const buildProjectSections = (todos: PersistedTodoItem[], projects: Project[]) =>
  build(todos, 'project', { projects })
const buildFlatSection = (todos: PersistedTodoItem[]) => build(todos, 'none')

describe('buildListSections — due and follow-up grouping', () => {
  // Fixed Monday so `+3 days` (Thursday) and `+4 days` (Friday) stay inside
  // the calendar week (weekStartsOn=1 → Mon-Sun); the post-P9 bucketer keys
  // "this week" off the calendar boundary, not a rolling-7-day window.
  const MONDAY = new Date(2026, 0, 12)

  it('groups due dates into overdue, today, this week, later, no due date', () => {
    const today = MONDAY
    const yesterday = new Date(today.getTime() - 86400000)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inTenDays = new Date(today.getTime() + 10 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: yesterday }),
      makeTodo({ id: 2, dueDate: today }),
      makeTodo({ id: 3, dueDate: inThreeDays }),
      makeTodo({ id: 4, dueDate: inTenDays }),
      makeTodo({ id: 5 }), // no dates
    ]
    const sections = buildDeadlineSections(todos, 1, today)
    expect(sections.map((s) => s.key)).toEqual(['overdue', 'today', 'week', 'later', 'none'])
    expect(sections.at(-1)!.label).toBe('No Due Date')
    expect(sections[0]!.todos).toHaveLength(1) // overdue
    expect(sections[1]!.todos).toHaveLength(1) // today
    expect(sections[2]!.todos).toHaveLength(1) // this week
    expect(sections[3]!.todos).toHaveLength(1) // later
    expect(sections[4]!.todos).toHaveLength(1) // no date
  })

  it('keeps manual (sortOrder) order within a bucket', () => {
    const today = MONDAY
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inFourDays = new Date(today.getTime() + 4 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: inThreeDays, sortOrder: 30 }),
      makeTodo({ id: 2, dueDate: inFourDays, sortOrder: 5 }),
      makeTodo({ id: 3, dueDate: inThreeDays, sortOrder: 10 }),
      makeTodo({ id: 4, dueDate: inFourDays, sortOrder: 20 }),
    ]
    const sections = buildDeadlineSections(todos, 1, today)
    const week = sections.find((s) => s.key === 'week')!
    expect(week.todos.map((t) => t.id)).toEqual([2, 3, 4, 1])
  })

  it('the due-date sections ignore the follow-up and vice versa', () => {
    const today = MONDAY
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)

    const todos = [
      makeTodo({ id: 1, nextFollowupAt: inThreeDays }),
    ]
    expect(buildDeadlineSections(todos, 1, today).map((s) => s.key)).toEqual(['none'])
    const followup = buildFollowupSections(todos, 1, today)
    expect(followup.find((s) => s.key === 'week')!.todos.map((t) => t.id)).toEqual([1])
  })

})

describe('buildListSections — people grouping', () => {
  it('groups by assigned person with unassigned fallback', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0]!]],
      [11, [people[1]!]],
      // 12 is unassigned
    ])

    const sections = buildPeopleSections(todos, people, assignedPeopleMap)
    expect(sections).toHaveLength(3)
    expect(sections[0]!.label).toBe('Alice')
    expect(sections[0]!.todos).toHaveLength(1)
    expect(sections[1]!.label).toBe('Bob')
    expect(sections[2]!.label).toBe('Unassigned')
    expect(sections[2]!.todos).toHaveLength(1)
  })

  it('shows todo in multiple sections when assigned to multiple people', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [makeTodo({ id: 10 })]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0]!, people[1]!]],
    ])

    const sections = buildPeopleSections(todos, people, assignedPeopleMap)
    expect(sections).toHaveLength(2)
    expect(sections[0]!.todos).toHaveLength(1)
    expect(sections[1]!.todos).toHaveLength(1)
  })

  // Visible-groups intersection rule. When the active filter
  // narrows to specific people AND grouping is by people, ONLY those
  // people's sections appear. Carol+Alice are restricted-to; Bob is filtered
  // out of the visible groups entirely, even though his task survived the
  // upstream filter pass (in production he wouldn't reach this helper, but
  // this asserts the helper's restriction is independent of the matcher).
  it('restricts visible person sections to restrictToPersonIds in caller order', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
      { id: 3, name: 'Carol', initials: 'C' },
    ]
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[0]!]],
      [11, [people[1]!]],
      [12, [people[2]!]],
    ])
    const sections = buildPeopleSections(
      todos,
      people,
      assignedPeopleMap,
      [3, 1], // restrict to Carol then Alice; Bob's task drops out of the visible groups.
    )
    expect(sections.map((s) => s.label)).toEqual(['Carol', 'Alice'])
  })

  it('leaves person section order untouched when restrict list is null', () => {
    const people: Person[] = [
      { id: 1, name: 'Alice', initials: 'A' },
      { id: 2, name: 'Bob', initials: 'B' },
    ]
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [people[1]!]],
      [11, [people[0]!]],
    ])
    const sections = buildPeopleSections(
      todos,
      people,
      assignedPeopleMap,
      null,
    )
    // Sections are alphabetical by person name.
    expect(sections.map((s) => s.label)).toEqual(['Alice', 'Bob'])
  })

  it('drops tasks whose keys fail to intersect restrict set', () => {
    // Filter [Alice]; task assigned to Bob only →
    // dropped from the visible groups entirely (not routed to Unassigned).
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const todos = [makeTodo({ id: 10 })]
    const assignedPeopleMap = new Map<number, Person[]>([[10, [bob]]])
    const sections = buildPeopleSections(
      todos,
      [alice, bob],
      assignedPeopleMap,
      [alice.id!],
    )
    expect(sections).toEqual([])
  })

  it('surfaces person.color as the section accentColor (undefined when unset)', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A', color: '#abc' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const assignedPeopleMap = new Map<number, Person[]>([
      [10, [alice]],
      [11, [bob]],
    ])
    const sections = buildPeopleSections(todos, [alice, bob], assignedPeopleMap)
    expect(sections.map((s) => s.label)).toEqual(['Alice', 'Bob'])
    expect(sections[0]!.accentColor).toBe('#abc')
    expect(sections[1]!.accentColor).toBeUndefined()
  })
})

describe('buildListSections — tag grouping, visible-groups intersection', () => {
  const ALPHA: Tag = { id: 3, name: 'alpha', color: '#00f' }
  const MU: Tag = { id: 4, name: 'mu', color: '#ff0' }
  const ZETA: Tag = { id: 5, name: 'zeta', color: '#0ff' }

  it('restricts visible tag sections to restrictToTagIds in caller order', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [ALPHA]],
      [11, [MU]],
      [12, [ZETA]],
    ])
    // Restrict to {zeta, alpha} → mu drops; output in caller order.
    const sections = buildTagSections(todos, assigned, [5, 3])
    expect(sections.map((s) => s.label)).toEqual(['#zeta', '#alpha'])
  })

  it('suppresses the untagged trailing bucket when restricting by tag', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }), // untagged
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [ALPHA]],
      [11, [ZETA]],
    ])
    // Restrict to {zeta} → alpha bucket drops; untagged is suppressed
    // (the user narrowed to specific tags, so "untagged" is incoherent).
    const sections = buildTagSections(todos, assigned, [5])
    expect(sections.map((s) => s.key)).toEqual(['tag-5'])
  })

  it('emits a task under each filter-set tag it has, dropping non-filter tags', () => {
    // T has tags {zeta, mu, alpha}; filter is {zeta, alpha} → T appears in
    // zeta and alpha sections only, never mu.
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [ZETA, MU, ALPHA]]])
    const sections = buildTagSections(todos, assigned, [5, 3])
    expect(sections.map((s) => s.label)).toEqual(['#zeta', '#alpha'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(sections[1]!.todos.map((t) => t.id)).toEqual([10])
  })
})

describe('buildListSections — tag grouping', () => {
  const URGENT: Tag = { id: 1, name: 'urgent', color: '#f00' }
  const WORK: Tag = { id: 2, name: 'work', color: '#0f0' }
  const ALPHA: Tag = { id: 3, name: 'alpha', color: '#00f' }
  const MU: Tag = { id: 4, name: 'mu', color: '#ff0' }
  const ZETA: Tag = { id: 5, name: 'zeta', color: '#0ff' }

  it('explodes a two-tag todo into both buckets via the assigned map', () => {
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([
      [10, [URGENT, WORK]],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-1', 'tag-2'])
    expect(sections[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(sections[1]!.todos.map((t) => t.id)).toEqual([10])
  })

  it('sorts tag buckets alphabetically by registry name', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [ZETA]],
      [11, [ALPHA]],
      [12, [MU]],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-3', 'tag-4', 'tag-5'])
    expect(sections.map((s) => s.label)).toEqual(['#alpha', '#mu', '#zeta'])
  })

  it('surfaces the registry color as the section accentColor', () => {
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [URGENT]]])
    const sections = buildTagSections(todos, assigned)
    expect(sections[0]!.accentColor).toBe('#f00')
  })

  it('uses the canonical casing from the registry, not whatever was typed first', () => {
    const pascal: Tag = { id: 7, name: 'Urgent', color: '#f00' }
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [pascal]]])
    const sections = buildTagSections(todos, assigned)
    expect(sections[0]!.label).toBe('#Urgent')
  })

  it('routes untagged todos into a trailing "No Tag" bucket', () => {
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const assigned = new Map<number, Tag[]>([
      [10, [URGENT]],
      // 11 unassigned; 12 has an empty array
      [12, []],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-1', 'no-tag'])
    const noTag = sections[1]!
    expect(noTag.label).toBe('No Tag')
    expect(noTag.todos.map((t) => t.id).sort()).toEqual([11, 12])
  })

  it('dedupes repeated tag entries on a single todo', () => {
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([
      [10, [URGENT, URGENT, URGENT]],
    ])
    const sections = buildTagSections(todos, assigned)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.key).toBe('tag-1')
    expect(sections[0]!.todos).toHaveLength(1)
  })

  it('emits no bucket for tags with no assignments (discover-on-fly)', () => {
    // Post-L8 the helper discovers tags from `assignedTagsMap` rather than the
    // registry list, so a registry tag that has no assignments simply never
    // appears in the result. Same observable shape as the pre-L8 explicit
    // prune-empty-buckets pass.
    const todos = [makeTodo({ id: 10 })]
    const assigned = new Map<number, Tag[]>([[10, [URGENT]]])
    const sections = buildTagSections(todos, assigned)
    expect(sections.map((s) => s.key)).toEqual(['tag-1'])
  })

  it('renders an empty result when the input is empty', () => {
    expect(buildTagSections([], new Map())).toEqual([])
  })
})

describe('buildListSections — project grouping', () => {
  it('groups by project with no-project fallback', () => {
    const projects: Project[] = [
      { id: 1, name: 'Alpha', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
      { id: 2, name: 'Beta', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
    ]
    const todos = [
      makeTodo({ id: 10, projectId: 1 }),
      makeTodo({ id: 11, projectId: 2 }),
      makeTodo({ id: 12 }), // no project
    ]

    const sections = buildProjectSections(todos, projects)
    expect(sections).toHaveLength(3)
    expect(sections[0]!.label).toBe('Alpha')
    expect(sections[1]!.label).toBe('Beta')
    expect(sections[2]!.label).toBe('No Project')
  })
})

describe('buildListSections — ungrouped', () => {
  it('returns single "all" section with every todo', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const sections = buildFlatSection(todos)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.key).toBe('all')
    expect(sections[0]!.todos).toHaveLength(3)
  })

  it('returns empty when no todos so the "empty state" message shows', () => {
    expect(buildFlatSection([])).toEqual([])
  })
})

describe('listSortComparator', () => {
  it('manual sorts by sortOrder, then id', () => {
    const a = makeTodo({ id: 1, sortOrder: 10 })
    const b = makeTodo({ id: 2, sortOrder: 5 })
    const c = makeTodo({ id: 3, sortOrder: 5 })
    expect([a, c, b].sort(listSortComparator('manual')).map((t) => t.id)).toEqual([2, 3, 1])
  })

  it('categorical sorts with no order of their own fall back to manual', () => {
    const a = makeTodo({ id: 1, title: 'b', sortOrder: 2 })
    const b = makeTodo({ id: 2, title: 'a', sortOrder: 1 })
    for (const sortBy of ['created', 'people', 'project', 'status'] as const) {
      expect([a, b].sort(listSortComparator(sortBy)).map((t) => t.id)).toEqual([2, 1])
    }
  })

  it('sorts deadline ascending, nulls last', () => {
    const a = makeTodo({ id: 1, dueDate: new Date(2026, 0, 20), sortOrder: 10 })
    const b = makeTodo({ id: 2, dueDate: new Date(2026, 0, 18), sortOrder: 1 })
    const c = makeTodo({ id: 3, sortOrder: 5 }) // no deadline
    const sorted = [a, b, c].sort(listSortComparator('deadline'))
    expect(sorted.map((t) => t.id)).toEqual([2, 1, 3])
  })

  it('breaks ties with sortOrder', () => {
    const d = new Date(2026, 0, 20)
    const a = makeTodo({ id: 1, dueDate: d, sortOrder: 10 })
    const b = makeTodo({ id: 2, dueDate: d, sortOrder: 5 })
    expect([a, b].sort(listSortComparator('deadline')).map((t) => t.id)).toEqual([2, 1])
  })

  it('sorts name ascending via localeCompare, case-insensitive', () => {
    const a = makeTodo({ id: 1, title: 'banana', sortOrder: 0 })
    const b = makeTodo({ id: 2, title: 'Apple', sortOrder: 0 })
    const c = makeTodo({ id: 3, title: 'cherry', sortOrder: 0 })
    const sorted = [a, b, c].sort(listSortComparator('name'))
    expect(sorted.map((t) => t.id)).toEqual([2, 1, 3])
  })

  it('breaks name ties with sortOrder, then id', () => {
    const a = makeTodo({ id: 1, title: 'Same', sortOrder: 10 })
    const b = makeTodo({ id: 2, title: 'Same', sortOrder: 5 })
    const c = makeTodo({ id: 3, title: 'Same', sortOrder: 5 })
    expect([a, b, c].sort(listSortComparator('name')).map((t) => t.id)).toEqual([2, 3, 1])
  })
})

describe('buildListSections — unknown stored values', () => {
  it('an unknown grouping reads as ungrouped and an unknown sort as manual', () => {
    const todos = [makeTodo({ id: 1, sortOrder: 2 }), makeTodo({ id: 2, sortOrder: 1 })]
    const sections = buildListSections(
      todos,
      { groupBy: { kind: 'none' } as unknown as TodoGroupBy, sortBy: 'date' as unknown as TodoSortBy },
      ctxWith(),
    )
    expect(sections.map((s) => [s.key, s.todos.map((t) => t.id)])).toEqual([['all', [2, 1]]])
  })
})

describe('buildListSections — sort within groups', () => {
  it('sorts inside each section, not across them', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const todos = [
      makeTodo({ id: 1, title: 'zeta', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'alpha', sortOrder: 2 }),
      makeTodo({ id: 3, title: 'mid', sortOrder: 3 }),
      makeTodo({ id: 4, title: 'beta', sortOrder: 4 }),
    ]
    const assignedPeopleMap = new Map<number, Person[]>([[1, [bob]], [2, [bob]], [3, [alice]], [4, [alice]]])
    const sections = build(todos, 'people', { people: [alice, bob], assignedPeopleMap }, { sortBy: 'name' })
    expect(sections.map((s) => [s.label, s.todos.map((t) => t.title)])).toEqual([
      ['Alice', ['beta', 'mid']],
      ['Bob', ['alpha', 'zeta']],
    ])
  })

  it('ungrouped lists come back as one sorted "all" section', () => {
    const todos = [
      makeTodo({ id: 1, dueDate: new Date(2026, 0, 20) }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3, dueDate: new Date(2026, 0, 13) }),
    ]
    const sections = build(todos, 'none', {}, { sortBy: 'deadline' })
    expect(sections.map((s) => [s.key, s.todos.map((t) => t.id)])).toEqual([['all', [3, 1, 2]]])
  })
})

describe('buildListSections — accents and sentinels', () => {
  it('date sections: overdue, accent for today, secondary for this week, muted for later', () => {
    const today = new Date(2026, 0, 12)
    const todos = [
      makeTodo({ id: 1, dueDate: new Date(2026, 0, 11) }),
      makeTodo({ id: 2, dueDate: today }),
      makeTodo({ id: 3, dueDate: new Date(2026, 0, 14) }),
      makeTodo({ id: 4, dueDate: new Date(2026, 1, 1) }),
    ]
    expect(buildDeadlineSections(todos, 1, today).map((s) => s.accentColor)).toEqual([
      'var(--color-overdue)', 'var(--color-accent)', 'var(--color-text-secondary)', 'var(--color-text-muted)',
    ])
  })

  it('status sections follow the registry sortOrder with status colors, then No Status', () => {
    const statuses: Status[] = [
      { id: 1, name: 'Doing', color: '#0a0', sortOrder: 1 },
      { id: 2, name: 'Waiting', color: '#aa0', sortOrder: 0 },
    ]
    const todos = [makeTodo({ id: 1, statusId: 1 }), makeTodo({ id: 2, statusId: 2 }), makeTodo({ id: 3 })]
    const sections = build(todos, 'status', { statuses })
    expect(sections.map((s) => [s.key, s.label, s.accentColor])).toEqual([
      ['status-2', 'Waiting', '#aa0'],
      ['status-1', 'Doing', '#0a0'],
      ['no-status', 'No Status', 'var(--color-text-muted)'],
    ])
  })

  it('a person filter that includes Unassigned keeps the Unassigned section', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 })]
    const assignedPeopleMap = new Map<number, Person[]>([[1, [alice]]])
    expect(buildPeopleSections(todos, [alice], assignedPeopleMap, [0]).map((s) => s.key)).toEqual(['unassigned'])
    expect(buildPeopleSections(todos, [alice], assignedPeopleMap, [1, 0]).map((s) => s.key)).toEqual(['person-1', 'unassigned'])
  })
})


describe('truncateSections', () => {
  const mkSection = (key: string, ids: number[]): Section => ({
    key,
    label: key,
    todos: ids.map((id) => makeTodo({ id })),
  })

  it('returns all sections when the limit exceeds total count', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3])]
    const { displaySections, truncatedCount } = truncateSections(sections, 10)
    expect(truncatedCount).toBe(0)
    expect(displaySections).toHaveLength(2)
    expect(displaySections[0]!.todos).toHaveLength(2)
    expect(displaySections[1]!.todos).toHaveLength(1)
  })

  it('slices the section that straddles the cap', () => {
    const sections = [mkSection('a', [1, 2, 3]), mkSection('b', [4, 5, 6])]
    const { displaySections, truncatedCount } = truncateSections(sections, 4)
    expect(truncatedCount).toBe(2)
    expect(displaySections).toHaveLength(2)
    expect(displaySections[0]!.todos.map((t) => t.id)).toEqual([1, 2, 3])
    expect(displaySections[1]!.todos.map((t) => t.id)).toEqual([4])
  })

  it('drops entire tail sections after the cap', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3, 4]), mkSection('c', [5, 6])]
    const { displaySections, truncatedCount } = truncateSections(sections, 2)
    expect(truncatedCount).toBe(4)
    expect(displaySections).toHaveLength(1)
    expect(displaySections[0]!.todos.map((t) => t.id)).toEqual([1, 2])
  })

  it('preserves label, key, and accentColor on the sliced section', () => {
    const sections: Section[] = [{
      key: 'a',
      label: 'Alpha',
      accentColor: '#abc',
      todos: [makeTodo({ id: 1 }), makeTodo({ id: 2 })],
    }]
    const { displaySections } = truncateSections(sections, 1)
    expect(displaySections[0]!.key).toBe('a')
    expect(displaySections[0]!.label).toBe('Alpha')
    expect(displaySections[0]!.accentColor).toBe('#abc')
    expect(displaySections[0]!.todos).toHaveLength(1)
  })

  it('cap of 0 drops everything', () => {
    const sections = [mkSection('a', [1, 2]), mkSection('b', [3])]
    const { displaySections, truncatedCount } = truncateSections(sections, 0)
    expect(displaySections).toHaveLength(0)
    expect(truncatedCount).toBe(3)
  })
})
