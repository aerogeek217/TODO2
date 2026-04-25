import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem, Person, Org, Status, Tag } from '../../models'
import {
  getGroupKey,
  getGroupLabel,
  partitionByGroup,
  type GroupingContext,
} from '../../utils/task-grouping'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: 'Test',
    isCompleted: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: 0,
    ...overrides,
  }
}

function makeCtx(over: Partial<GroupingContext> = {}): GroupingContext {
  return {
    assignedPeopleMap: new Map(),
    assignedOrgsMap: new Map(),
    assignedTagsMap: new Map(),
    statuses: [],
    today: new Date(2026, 0, 15),
    ...over,
  }
}

const STATUSES: Status[] = [
  { id: 1, name: 'Active', color: '#0a0', sortOrder: 0 },
  { id: 2, name: 'Blocked', color: '#a00', sortOrder: 1 },
  { id: 3, name: 'Done', color: '#888', sortOrder: 2 },
]

describe('getGroupKey', () => {
  describe('status', () => {
    it('returns status-{id} when assigned', () => {
      const todo = makeTodo({ id: 1, statusId: 2 })
      expect(getGroupKey(todo, 'status', makeCtx())).toBe('status-2')
    })

    it('returns null when no status', () => {
      const todo = makeTodo({ id: 1 })
      expect(getGroupKey(todo, 'status', makeCtx())).toBeNull()
    })
  })

  describe('people', () => {
    it('returns array with one key per assigned person', () => {
      const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
      const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
      const todo = makeTodo({ id: 10 })
      const ctx = makeCtx({
        assignedPeopleMap: new Map([[10, [alice, bob]]]),
      })
      expect(getGroupKey(todo, 'people', ctx)).toEqual(['person-1', 'person-2'])
    })

    it('returns null when no people assigned', () => {
      const todo = makeTodo({ id: 10 })
      expect(getGroupKey(todo, 'people', makeCtx())).toBeNull()
    })

    it('dedupes repeated person entries on a single todo', () => {
      const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
      const todo = makeTodo({ id: 10 })
      const ctx = makeCtx({
        assignedPeopleMap: new Map([[10, [alice, alice]]]),
      })
      expect(getGroupKey(todo, 'people', ctx)).toEqual(['person-1'])
    })
  })

  describe('org', () => {
    it('returns array with one key per assigned org', () => {
      const acme: Org = { id: 1, name: 'Acme' }
      const initech: Org = { id: 2, name: 'Initech' }
      const todo = makeTodo({ id: 10 })
      const ctx = makeCtx({
        assignedOrgsMap: new Map([[10, [acme, initech]]]),
      })
      expect(getGroupKey(todo, 'org', ctx)).toEqual(['org-1', 'org-2'])
    })

    it('returns null when no orgs assigned', () => {
      const todo = makeTodo({ id: 10 })
      expect(getGroupKey(todo, 'org', makeCtx())).toBeNull()
    })
  })

  describe('tag', () => {
    it('returns array with one key per assigned tag', () => {
      const urgent: Tag = { id: 1, name: 'urgent', color: '#f00' }
      const followup: Tag = { id: 2, name: 'followup', color: '#0f0' }
      const todo = makeTodo({ id: 10 })
      const ctx = makeCtx({
        assignedTagsMap: new Map([[10, [urgent, followup]]]),
      })
      expect(getGroupKey(todo, 'tag', ctx)).toEqual(['tag-1', 'tag-2'])
    })

    it('returns null when no tags assigned', () => {
      const todo = makeTodo({ id: 10 })
      expect(getGroupKey(todo, 'tag', makeCtx())).toBeNull()
    })

    it('dedupes repeated tag entries on a single todo', () => {
      const urgent: Tag = { id: 1, name: 'urgent', color: '#f00' }
      const todo = makeTodo({ id: 10 })
      const ctx = makeCtx({
        assignedTagsMap: new Map([[10, [urgent, urgent]]]),
      })
      expect(getGroupKey(todo, 'tag', ctx)).toEqual(['tag-1'])
    })
  })

  describe('date / scheduled / deadline', () => {
    const today = new Date(2026, 0, 15)
    const yesterday = new Date(today.getTime() - 86400000)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inTenDays = new Date(today.getTime() + 10 * 86400000)

    it('buckets effective date into overdue / today / week / later', () => {
      const ctx = makeCtx({ today })
      expect(getGroupKey(makeTodo({ id: 1, dueDate: yesterday }), 'date', ctx)).toBe('overdue')
      expect(getGroupKey(makeTodo({ id: 2, dueDate: today }), 'date', ctx)).toBe('today')
      expect(getGroupKey(makeTodo({ id: 3, dueDate: inThreeDays }), 'date', ctx)).toBe('week')
      expect(getGroupKey(makeTodo({ id: 4, dueDate: inTenDays }), 'date', ctx)).toBe('later')
      expect(getGroupKey(makeTodo({ id: 5 }), 'date', ctx)).toBeNull()
    })

    it('buckets scheduled date independently of deadline', () => {
      const ctx = makeCtx({ today })
      const todo = makeTodo({
        id: 1,
        scheduledDate: { kind: 'date', value: inThreeDays },
      })
      expect(getGroupKey(todo, 'scheduled', ctx)).toBe('week')
      expect(getGroupKey(todo, 'deadline', ctx)).toBeNull()
    })

    it('buckets deadline independently of scheduled', () => {
      const ctx = makeCtx({ today })
      const todo = makeTodo({ id: 1, dueDate: yesterday })
      expect(getGroupKey(todo, 'deadline', ctx)).toBe('overdue')
      expect(getGroupKey(todo, 'scheduled', ctx)).toBeNull()
    })

    it('matches ListView keys (overdue / today / week / later)', () => {
      const ctx = makeCtx({ today })
      const keys = [yesterday, today, inThreeDays, inTenDays].map((d) =>
        getGroupKey(makeTodo({ id: 1, dueDate: d }), 'date', ctx),
      )
      expect(keys).toEqual(['overdue', 'today', 'week', 'later'])
    })
  })
})

describe('getGroupLabel', () => {
  it('returns the status name from ctx', () => {
    const ctx = makeCtx({ statuses: STATUSES })
    expect(getGroupLabel('status-2', 'status', ctx)).toBe('Blocked')
  })

  it('returns the person name from the assigned map', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const ctx = makeCtx({ assignedPeopleMap: new Map([[10, [alice]]]) })
    expect(getGroupLabel('person-1', 'people', ctx)).toBe('Alice')
  })

  it('returns the org name from the assigned map', () => {
    const acme: Org = { id: 1, name: 'Acme' }
    const ctx = makeCtx({ assignedOrgsMap: new Map([[10, [acme]]]) })
    expect(getGroupLabel('org-1', 'org', ctx)).toBe('Acme')
  })

  it('returns the tag name from the assigned map', () => {
    const urgent: Tag = { id: 1, name: 'urgent', color: '#f00' }
    const ctx = makeCtx({ assignedTagsMap: new Map([[10, [urgent]]]) })
    expect(getGroupLabel('tag-1', 'tag', ctx)).toBe('urgent')
  })

  it('returns the canonical date-bucket labels', () => {
    const ctx = makeCtx()
    expect(getGroupLabel('overdue', 'date', ctx)).toBe('Overdue')
    expect(getGroupLabel('today', 'scheduled', ctx)).toBe('Today')
    expect(getGroupLabel('week', 'deadline', ctx)).toBe('This Week')
    expect(getGroupLabel('later', 'date', ctx)).toBe('Later')
  })

  it('returns empty string for unknown keys', () => {
    const ctx = makeCtx({ statuses: STATUSES })
    expect(getGroupLabel('status-999', 'status', ctx)).toBe('')
    expect(getGroupLabel('garbage', 'status', ctx)).toBe('')
  })
})

describe('partitionByGroup', () => {
  it('returns empty result for empty input', () => {
    const result = partitionByGroup([], 'status', makeCtx({ statuses: STATUSES }))
    expect(result).toEqual({ ungrouped: [], groups: [] })
  })

  it('routes status-less todos into ungrouped, groups the rest by status', () => {
    const todos = [
      makeTodo({ id: 1, statusId: 1 }),
      makeTodo({ id: 2, statusId: 2 }),
      makeTodo({ id: 3 }),
      makeTodo({ id: 4, statusId: 1 }),
    ]
    const result = partitionByGroup(todos, 'status', makeCtx({ statuses: STATUSES }))
    expect(result.ungrouped.map((t) => t.id)).toEqual([3])
    expect(result.groups.map((g) => g.key)).toEqual(['status-1', 'status-2'])
    expect(result.groups[0].label).toBe('Active')
    expect(result.groups[0].todos.map((t) => t.id)).toEqual([1, 4])
    expect(result.groups[1].label).toBe('Blocked')
    expect(result.groups[1].todos.map((t) => t.id)).toEqual([2])
  })

  it('orders status groups by status sortOrder, not first-encounter', () => {
    const todos = [
      makeTodo({ id: 1, statusId: 3 }), // Done — sortOrder 2
      makeTodo({ id: 2, statusId: 1 }), // Active — sortOrder 0
      makeTodo({ id: 3, statusId: 2 }), // Blocked — sortOrder 1
    ]
    const result = partitionByGroup(todos, 'status', makeCtx({ statuses: STATUSES }))
    expect(result.groups.map((g) => g.label)).toEqual(['Active', 'Blocked', 'Done'])
  })

  it('preserves input order within a group', () => {
    const todos = [
      makeTodo({ id: 30, statusId: 1, sortOrder: 30 }),
      makeTodo({ id: 5, statusId: 1, sortOrder: 5 }),
      makeTodo({ id: 10, statusId: 1, sortOrder: 10 }),
    ]
    const result = partitionByGroup(todos, 'status', makeCtx({ statuses: STATUSES }))
    expect(result.groups[0].todos.map((t) => t.id)).toEqual([30, 5, 10])
  })

  it('groups by people with unassigned routed to ungrouped', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }), // unassigned
    ]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [alice]],
        [11, [bob]],
      ]),
    })
    const result = partitionByGroup(todos, 'people', ctx)
    expect(result.ungrouped.map((t) => t.id)).toEqual([12])
    expect(result.groups.map((g) => g.label)).toEqual(['Alice', 'Bob'])
    expect(result.groups[0].todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[1].todos.map((t) => t.id)).toEqual([11])
  })

  it('places a todo into multiple person groups when assigned to multiple people', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([[10, [alice, bob]]]),
    })
    const result = partitionByGroup(todos, 'people', ctx)
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0].todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[1].todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[0].todos[0]).toBe(result.groups[1].todos[0])
  })

  it('orders people groups alphabetically by label', () => {
    const zeta: Person = { id: 3, name: 'Zeta', initials: 'Z' }
    const alpha: Person = { id: 4, name: 'Alpha', initials: 'A' }
    const mu: Person = { id: 5, name: 'Mu', initials: 'M' }
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [zeta]],
        [11, [alpha]],
        [12, [mu]],
      ]),
    })
    const result = partitionByGroup(todos, 'people', ctx)
    expect(result.groups.map((g) => g.label)).toEqual(['Alpha', 'Mu', 'Zeta'])
  })

  it('places a todo into multiple org groups when assigned to multiple orgs', () => {
    const acme: Org = { id: 1, name: 'Acme' }
    const initech: Org = { id: 2, name: 'Initech' }
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedOrgsMap: new Map([[10, [acme, initech]]]),
    })
    const result = partitionByGroup(todos, 'org', ctx)
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0].label).toBe('Acme')
    expect(result.groups[1].label).toBe('Initech')
  })

  it('groups by tag with untagged routed to ungrouped', () => {
    const urgent: Tag = { id: 1, name: 'urgent', color: '#f00' }
    const followup: Tag = { id: 2, name: 'followup', color: '#0f0' }
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }), // untagged
    ]
    const ctx = makeCtx({
      assignedTagsMap: new Map([
        [10, [urgent]],
        [11, [followup]],
      ]),
    })
    const result = partitionByGroup(todos, 'tag', ctx)
    expect(result.ungrouped.map((t) => t.id)).toEqual([12])
    // Alphabetical: followup before urgent
    expect(result.groups.map((g) => g.label)).toEqual(['followup', 'urgent'])
    expect(result.groups[0].todos.map((t) => t.id)).toEqual([11])
    expect(result.groups[1].todos.map((t) => t.id)).toEqual([10])
  })

  it('places a todo into multiple tag groups when assigned to multiple tags', () => {
    const urgent: Tag = { id: 1, name: 'urgent', color: '#f00' }
    const followup: Tag = { id: 2, name: 'followup', color: '#0f0' }
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedTagsMap: new Map([[10, [urgent, followup]]]),
    })
    const result = partitionByGroup(todos, 'tag', ctx)
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0].todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[1].todos.map((t) => t.id)).toEqual([10])
    // Same row reference, no clone
    expect(result.groups[0].todos[0]).toBe(result.groups[1].todos[0])
  })

  it('orders tag groups alphabetically by label', () => {
    const zeta: Tag = { id: 3, name: 'zeta', color: '#fff' }
    const alpha: Tag = { id: 4, name: 'alpha', color: '#fff' }
    const mu: Tag = { id: 5, name: 'mu', color: '#fff' }
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const ctx = makeCtx({
      assignedTagsMap: new Map([
        [10, [zeta]],
        [11, [alpha]],
        [12, [mu]],
      ]),
    })
    const result = partitionByGroup(todos, 'tag', ctx)
    expect(result.groups.map((g) => g.label)).toEqual(['alpha', 'mu', 'zeta'])
  })

  it('orders date groups in canonical bucket order regardless of input order', () => {
    const today = new Date(2026, 0, 15)
    const yesterday = new Date(today.getTime() - 86400000)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const inTenDays = new Date(today.getTime() + 10 * 86400000)

    const todos = [
      makeTodo({ id: 1, dueDate: inTenDays }), // later
      makeTodo({ id: 2, dueDate: today }),     // today
      makeTodo({ id: 3, dueDate: yesterday }), // overdue
      makeTodo({ id: 4, dueDate: inThreeDays }), // week
      makeTodo({ id: 5 }),                     // ungrouped
    ]
    const result = partitionByGroup(todos, 'date', makeCtx({ today }))
    expect(result.ungrouped.map((t) => t.id)).toEqual([5])
    expect(result.groups.map((g) => g.key)).toEqual(['overdue', 'today', 'week', 'later'])
    expect(result.groups.map((g) => g.label)).toEqual([
      'Overdue',
      'Today',
      'This Week',
      'Later',
    ])
  })

  it('uses scheduledDate (not dueDate) for the scheduled dimension', () => {
    const today = new Date(2026, 0, 15)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const todos = [
      makeTodo({ id: 1, scheduledDate: { kind: 'date', value: inThreeDays } }),
    ]
    const result = partitionByGroup(todos, 'scheduled', makeCtx({ today }))
    expect(result.groups[0].key).toBe('week')
    expect(result.groups[0].todos.map((t) => t.id)).toEqual([1])
  })

  it('uses dueDate (not scheduledDate) for the deadline dimension', () => {
    const today = new Date(2026, 0, 15)
    const inThreeDays = new Date(today.getTime() + 3 * 86400000)
    const todos = [
      makeTodo({
        id: 1,
        scheduledDate: { kind: 'date', value: inThreeDays },
      }),
    ]
    const result = partitionByGroup(todos, 'deadline', makeCtx({ today }))
    expect(result.groups).toHaveLength(0)
    expect(result.ungrouped.map((t) => t.id)).toEqual([1])
  })
})
