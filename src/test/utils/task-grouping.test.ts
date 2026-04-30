import { describe, it, expect } from 'vitest'
import type { Person, Org, Status, Tag } from '../../models'
import {
  getGroupKey,
  getGroupLabel,
  getGroupColor,
  partitionByGroup,
  type GroupingContext,
} from '../../utils/task-grouping'
import { UNAFFILIATED_PERSON_COLOR } from '../../constants'
import { makeTodo } from '../helpers'

function makeCtx(over: Partial<GroupingContext> = {}): GroupingContext {
  return {
    assignedPeopleMap: new Map(),
    assignedOrgsMap: new Map(),
    assignedTagsMap: new Map(),
    statuses: [],
    orgs: [],
    personOrgMap: new Map(),
    today: new Date(2026, 0, 15),
    weekStartsOn: 1,
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

describe('getGroupColor', () => {
  it('returns the status color from ctx.statuses', () => {
    const ctx = makeCtx({ statuses: STATUSES })
    expect(getGroupColor('status-2', 'status', ctx)).toBe('#a00')
  })

  it('returns the org color from the assigned map', () => {
    const acme: Org = { id: 1, name: 'Acme', color: '#abc' }
    const ctx = makeCtx({ assignedOrgsMap: new Map([[10, [acme]]]) })
    expect(getGroupColor('org-1', 'org', ctx)).toBe('#abc')
  })

  it('returns the tag color from the assigned map', () => {
    const urgent: Tag = { id: 1, name: 'urgent', color: '#f00' }
    const ctx = makeCtx({ assignedTagsMap: new Map([[10, [urgent]]]) })
    expect(getGroupColor('tag-1', 'tag', ctx)).toBe('#f00')
  })

  it('resolves the person color through their first assigned org', () => {
    const acme: Org = { id: 1, name: 'Acme', color: '#abc' }
    const ctx = makeCtx({
      orgs: [acme],
      personOrgMap: new Map([[7, [1]]]),
    })
    expect(getGroupColor('person-7', 'people', ctx)).toBe('#abc')
  })

  it('falls back to UNAFFILIATED_PERSON_COLOR for a person with no org', () => {
    const ctx = makeCtx({ orgs: [], personOrgMap: new Map() })
    expect(getGroupColor('person-7', 'people', ctx)).toBe(UNAFFILIATED_PERSON_COLOR)
  })

  it('returns undefined for date-bucket dimensions', () => {
    const ctx = makeCtx()
    expect(getGroupColor('overdue', 'date', ctx)).toBeUndefined()
    expect(getGroupColor('today', 'scheduled', ctx)).toBeUndefined()
    expect(getGroupColor('week', 'deadline', ctx)).toBeUndefined()
  })

  it('returns undefined for unknown / malformed keys', () => {
    const ctx = makeCtx({ statuses: STATUSES })
    expect(getGroupColor('status-999', 'status', ctx)).toBeUndefined()
    expect(getGroupColor('garbage', 'status', ctx)).toBeUndefined()
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
    expect(result.groups[0]!.label).toBe('Active')
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([1, 4])
    expect(result.groups[1]!.label).toBe('Blocked')
    expect(result.groups[1]!.todos.map((t) => t.id)).toEqual([2])
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
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([30, 5, 10])
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
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[1]!.todos.map((t) => t.id)).toEqual([11])
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
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[1]!.todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[0]!.todos[0]).toBe(result.groups[1]!.todos[0])
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
    expect(result.groups[0]!.label).toBe('Acme')
    expect(result.groups[1]!.label).toBe('Initech')
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
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([11])
    expect(result.groups[1]!.todos.map((t) => t.id)).toEqual([10])
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
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([10])
    expect(result.groups[1]!.todos.map((t) => t.id)).toEqual([10])
    // Same row reference, no clone
    expect(result.groups[0]!.todos[0]).toBe(result.groups[1]!.todos[0])
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
    expect(result.groups[0]!.key).toBe('week')
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([1])
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

describe('partitionByGroup — prioritizeGroupKeys (filter-aware ordering, P5)', () => {
  it('pulls prioritized people keys to the front in caller order', () => {
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
    // Filter narrows to Zeta + Mu; both should lead, then Alpha by alphabetical fallback.
    const result = partitionByGroup(todos, 'people', ctx, ['person-3', 'person-5'])
    expect(result.groups.map((g) => g.label)).toEqual(['Zeta', 'Mu', 'Alpha'])
  })

  it('respects caller order when prioritizing multiple people keys', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const carol: Person = { id: 3, name: 'Carol', initials: 'C' }
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [alice]],
        [11, [bob]],
        [12, [carol]],
      ]),
    })
    // Caller order: Carol, Alice. Bob falls through alphabetically.
    const result = partitionByGroup(todos, 'people', ctx, ['person-3', 'person-1'])
    expect(result.groups.map((g) => g.label)).toEqual(['Carol', 'Alice', 'Bob'])
  })

  it('ignores prioritized keys that have no group present', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([[10, [alice]]]),
    })
    // person-99 has no group; should be silently dropped, Alice remains.
    const result = partitionByGroup(todos, 'people', ctx, ['person-99', 'person-1'])
    expect(result.groups.map((g) => g.label)).toEqual(['Alice'])
  })

  it('prioritizes org keys when grouping by org', () => {
    const acme: Org = { id: 1, name: 'Acme' }
    const beta: Org = { id: 2, name: 'Beta' }
    const charlie: Org = { id: 3, name: 'Charlie' }
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
      makeTodo({ id: 12 }),
    ]
    const ctx = makeCtx({
      assignedOrgsMap: new Map([
        [10, [acme]],
        [11, [beta]],
        [12, [charlie]],
      ]),
    })
    const result = partitionByGroup(todos, 'org', ctx, ['org-3'])
    expect(result.groups.map((g) => g.label)).toEqual(['Charlie', 'Acme', 'Beta'])
  })

  it('prioritizes tag keys when grouping by tag', () => {
    const zeta: Tag = { id: 3, name: 'zeta', color: '#fff' }
    const alpha: Tag = { id: 4, name: 'alpha', color: '#fff' }
    const todos = [
      makeTodo({ id: 10 }),
      makeTodo({ id: 11 }),
    ]
    const ctx = makeCtx({
      assignedTagsMap: new Map([
        [10, [zeta]],
        [11, [alpha]],
      ]),
    })
    // alpha would lead alphabetically; pulling zeta forward inverts the order.
    const result = partitionByGroup(todos, 'tag', ctx, ['tag-3'])
    expect(result.groups.map((g) => g.label)).toEqual(['zeta', 'alpha'])
  })

  it('falls through to default order when prioritize list is empty or omitted', () => {
    const zeta: Person = { id: 3, name: 'Zeta', initials: 'Z' }
    const alpha: Person = { id: 4, name: 'Alpha', initials: 'A' }
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [zeta]],
        [11, [alpha]],
      ]),
    })
    const noParam = partitionByGroup(todos, 'people', ctx)
    const emptyParam = partitionByGroup(todos, 'people', ctx, [])
    expect(noParam.groups.map((g) => g.label)).toEqual(['Alpha', 'Zeta'])
    expect(emptyParam.groups.map((g) => g.label)).toEqual(['Alpha', 'Zeta'])
  })

  it('dedupes repeated prioritize ids', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [alice]],
        [11, [bob]],
      ]),
    })
    const result = partitionByGroup(todos, 'people', ctx, ['person-1', 'person-1', 'person-1'])
    // Alice once at the front; Bob falls through alphabetically after.
    expect(result.groups.map((g) => g.label)).toEqual(['Alice', 'Bob'])
  })

  it('does not reorder status / date dimensions when called (no-op for fixed-order dims)', () => {
    const todos = [
      makeTodo({ id: 30, statusId: 1 }),
      makeTodo({ id: 5, statusId: 3 }),
      makeTodo({ id: 10, statusId: 2 }),
    ]
    // Even with prioritize hint, status sort by sortOrder dominates.
    const result = partitionByGroup(
      todos,
      'status',
      makeCtx({ statuses: STATUSES }),
      ['status-3', 'status-2'],
    )
    // Expected: status-3 first (prioritized), status-2 second (prioritized), status-1 last.
    expect(result.groups.map((g) => g.key)).toEqual(['status-3', 'status-2', 'status-1'])
  })
})

describe('partitionByGroup — restrictToFilterSet (visible-groups intersection, P6)', () => {
  const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
  const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
  const carol: Person = { id: 3, name: 'Carol', initials: 'C' }
  const dave: Person = { id: 4, name: 'Dave', initials: 'D' }

  it('emits under direct keys ∩ filter set; non-filter direct keys disappear', () => {
    // Filter [Alice], group by people, task direct {Alice, Bob, Carol}.
    // Task emits only under Alice; Bob/Carol sections never appear.
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([[10, [alice, bob, carol]]]),
    })
    const result = partitionByGroup(todos, 'people', ctx, undefined, ['person-1'])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]!.key).toBe('person-1')
    expect(result.groups[0]!.tier).toBe('direct')
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([10])
  })

  it('emits under each filter-set key the task has directly', () => {
    // Filter [Alice, Bob], task direct {Alice, Bob, Carol}.
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([[10, [alice, bob, carol]]]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1', 'person-2'],
    )
    expect(result.groups.map((g) => g.key)).toEqual(['person-1', 'person-2'])
    expect(result.groups.every((g) => g.tier === 'direct')).toBe(true)
    expect(result.groups[0]!.todos[0]).toBe(result.groups[1]!.todos[0])
  })

  it('emits via implicit callback when direct keys miss the filter set', () => {
    // Filter [Alice], task direct {Carol, Dave}, implicit returns {Alice}.
    // Task emits under Alice as implicit; Carol/Dave sections never appear.
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([[10, [carol, dave]]]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1'],
      () => ['person-1'],
    )
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]!.key).toBe('person-1')
    expect(result.groups[0]!.tier).toBe('implicit')
  })

  it('skips a task entirely when neither direct nor implicit intersects the filter set', () => {
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([[10, [carol, dave]]]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1'],
    )
    expect(result.groups).toEqual([])
    // Task had direct people (carol, dave) — not unassigned — so it doesn't
    // route to ungrouped either; it's dropped from the partition entirely.
    expect(result.ungrouped).toEqual([])
  })

  it('promotes a group to direct tier when any task emits under it directly', () => {
    // T1 direct Alice, T2 implicit-only Alice. Group Alice ends up direct.
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [alice]],
        [11, [carol]],
      ]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1'],
      (t) => (t.id === 11 ? ['person-1'] : []),
    )
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]!.tier).toBe('direct')
    expect(result.groups[0]!.todos.map((t) => t.id).sort()).toEqual([10, 11])
  })

  it('orders [direct, implicit] tiers — direct first then implicit, preserving filter-set order', () => {
    // Filter [Alice, Bob]. Alice is implicit-only; Bob is direct. Output:
    // [Bob, Alice] (direct tier first, implicit at bottom).
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [bob]],
        [11, [carol]],
      ]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1', 'person-2'],
      (t) => (t.id === 11 ? ['person-1'] : []),
    )
    expect(result.groups.map((g) => g.key)).toEqual(['person-2', 'person-1'])
    expect(result.groups.map((g) => g.tier)).toEqual(['direct', 'implicit'])
  })

  it('keeps filter-set order when both keys are direct', () => {
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [alice]],
        [11, [bob]],
      ]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1', 'person-2'],
    )
    expect(result.groups.map((g) => g.key)).toEqual(['person-1', 'person-2'])
    expect(result.groups.map((g) => g.tier)).toEqual(['direct', 'direct'])
  })

  it('keeps filter-set order within the implicit tier when both keys are implicit-only', () => {
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [carol]],
        [11, [dave]],
      ]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1', 'person-2'],
      (t) => (t.id === 10 ? ['person-1'] : ['person-2']),
    )
    expect(result.groups.map((g) => g.key)).toEqual(['person-1', 'person-2'])
    expect(result.groups.map((g) => g.tier)).toEqual(['implicit', 'implicit'])
  })

  it('reports tier="direct" for every group when restrict mode is unset (regression guard)', () => {
    const todos = [
      makeTodo({ id: 10, statusId: 1 }),
      makeTodo({ id: 11, statusId: 2 }),
    ]
    const result = partitionByGroup(todos, 'status', makeCtx({ statuses: STATUSES }))
    expect(result.groups.map((g) => g.tier)).toEqual(['direct', 'direct'])
  })

  it('tag analog — filter narrows visible tag sections, drops other tags', () => {
    const x: Tag = { id: 1, name: 'x' }
    const y: Tag = { id: 2, name: 'y' }
    const z: Tag = { id: 3, name: 'z' }
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({ assignedTagsMap: new Map([[10, [x, y, z]]]) })
    const result = partitionByGroup(todos, 'tag', ctx, undefined, ['tag-1'])
    expect(result.groups.map((g) => g.key)).toEqual(['tag-1'])
    expect(result.groups[0]!.tier).toBe('direct')
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([10])
  })

  it('routes ungrouped tasks (no axis value) through the ungrouped block even in restrict mode', () => {
    // Task with no people assigned — directKeys is empty. Still routes to
    // ungrouped (preserves the unassigned-sentinel filter case).
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({ assignedPeopleMap: new Map() })
    const result = partitionByGroup(todos, 'people', ctx, undefined, ['person-1'])
    expect(result.groups).toEqual([])
    expect(result.ungrouped.map((t) => t.id)).toEqual([10])
  })

  it('emits via implicitKeysFor in restrict mode even when directKeys is empty', () => {
    // Task with no direct people but implicitKeysFor returns a filter-matched
    // key (e.g., task assigned only to an org whose member is in the people
    // filter, surfaced via personFilterMode='include-orgs' upstream). Emits
    // as implicit-tier; mirrors ListView legacy `buildPeopleSections` — the
    // migration in P3 of grouping-bucketers-consolidation depends on this.
    const todos = [makeTodo({ id: 10 })]
    const ctx = makeCtx({ assignedPeopleMap: new Map() })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1'],
      () => ['person-1'],
    )
    expect(result.ungrouped).toEqual([])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]!.key).toBe('person-1')
    expect(result.groups[0]!.tier).toBe('implicit')
    expect(result.groups[0]!.todos.map((t) => t.id)).toEqual([10])
  })

  it('ignores prioritizeGroupKeys when restrictToFilterSet drives the order', () => {
    // Both params passed: restrict wins, prioritize is ignored.
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [alice]],
        [11, [bob]],
      ]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      ['person-2', 'person-1'], // prioritize would yield [Bob, Alice]
      ['person-1', 'person-2'], // restrict says caller order = [Alice, Bob]
    )
    expect(result.groups.map((g) => g.key)).toEqual(['person-1', 'person-2'])
  })

  it('dedupes repeated keys in restrictToFilterSet to first appearance', () => {
    const todos = [makeTodo({ id: 10 }), makeTodo({ id: 11 })]
    const ctx = makeCtx({
      assignedPeopleMap: new Map([
        [10, [alice]],
        [11, [bob]],
      ]),
    })
    const result = partitionByGroup(
      todos,
      'people',
      ctx,
      undefined,
      ['person-1', 'person-1', 'person-2'],
    )
    expect(result.groups.map((g) => g.key)).toEqual(['person-1', 'person-2'])
  })
})

