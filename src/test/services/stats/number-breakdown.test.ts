import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, Person, Status, Tag } from '../../../models'
import { numberBreakdown } from '../../../services/stats/number-breakdown'
import type { StatsContext } from '../../../services/stats/stats-context'
import { makeTodo } from '../../helpers'

const ana: Person = { id: 1, name: 'Ana', initials: 'AN', color: '#a00' }
const ben: Person = { id: 2, name: 'Ben', initials: 'BE' }
const q4: Tag = { id: 7, name: 'q4', color: '#0a0' }
const home: Tag = { id: 8, name: 'home', color: '#00a' }
const todo: Status = { id: 10, name: 'Todo', color: '#888', sortOrder: 0, icon: 'circle' }
const waiting: Status = { id: 11, name: 'Waiting', color: '#c80', sortOrder: 1 }

const today = new Date(2026, 9, 10)
const day = (n: number) => new Date(2026, 9, 10 + n, 9)

const ctx: StatsContext = {
  today,
  weekStartsOn: 1,
  urgentRange: 3,
  assignedPeopleMap: new Map<number, readonly Person[]>([[1, [ana]], [2, [ana, ben]], [3, [ben]], [4, []]]),
  assignedTagsMap: new Map<number, readonly Tag[]>([[1, [q4, home]], [3, [q4]]]),
  // Settings' order: Todo, then Waiting.
  statuses: [waiting, todo].sort((a, b) => a.sortOrder - b.sortOrder),
}

const TASKS: PersistedTodoItem[] = [
  makeTodo({ id: 1, focus: true, important: true, statusId: 11 }),
  makeTodo({ id: 2, urgent: true, important: true, statusId: 10 }),
  // Urgent by its due date (within the 3-day range).
  makeTodo({ id: 3, dueDate: day(1), statusId: 11 }),
  makeTodo({ id: 4, important: true }),
  makeTodo({ id: 5 }),
  makeTodo({ id: 6, urgent: true, statusId: 999 }),
]
const byId = new Map(TASKS.map((t) => [t.id, t]))
const none = new Map<number, PersistedTodoItem>()

describe('numberBreakdown', () => {
  it('none: nothing', () => {
    expect(numberBreakdown([1, 2, 3], 'none', ctx, byId)).toEqual([])
  })

  it('by person: most first, ties by name, a task with two people in both; Unassigned last', () => {
    expect(numberBreakdown([1, 2, 3, 4, 5], 'people', ctx, none)).toEqual([
      { key: '1', label: 'Ana', color: '#a00', ids: [1, 2] },
      { key: '2', label: 'Ben', ids: [2, 3] },
      { key: 'none', label: 'Unassigned', ids: [4, 5] },
    ])
  })

  it('by tag: `#name` in the tag’s colour; No tag last, only when there is one', () => {
    expect(numberBreakdown([1, 2, 3], 'tags', ctx, none)).toEqual([
      { key: '7', label: '#q4', color: '#0a0', ids: [1, 3] },
      { key: '8', label: '#home', color: '#00a', ids: [1] },
      { key: 'none', label: 'No tag', ids: [2] },
    ])
    expect(numberBreakdown([1, 3], 'tags', ctx, none).map((e) => e.key)).toEqual(['7', '8'])
  })

  it('no tasks: nothing', () => {
    expect(numberBreakdown([], 'people', ctx, none)).toEqual([])
    expect(numberBreakdown([], 'status', ctx, byId)).toEqual([])
    expect(numberBreakdown([], 'priority', ctx, byId)).toEqual([])
  })

  it('by status: each status in Settings’ order with its colour and glyph; No status last (an unknown status counts as none)', () => {
    expect(numberBreakdown([6, 5, 4, 3, 2, 1], 'status', ctx, byId)).toEqual([
      { key: 'status-10', label: 'Todo', color: '#888', ids: [2], mark: { kind: 'status', icon: 'circle' } },
      { key: 'status-11', label: 'Waiting', color: '#c80', ids: [3, 1], mark: { kind: 'status' } },
      { key: 'none', label: 'No status', ids: [6, 5, 4] },
    ])
  })

  it('by priority: the Priority sort’s groups in order, effective Urgent counted; No priority last; ids in the count’s order', () => {
    expect(numberBreakdown([6, 5, 4, 3, 2, 1], 'priority', ctx, byId)).toEqual([
      { key: 'priority-focus', label: 'Focus', ids: [1], mark: { kind: 'priority', group: 'focus' } },
      { key: 'priority-urgentImportant', label: 'Urgent + Important', ids: [2], mark: { kind: 'priority', group: 'urgentImportant' } },
      { key: 'priority-urgent', label: 'Urgent', ids: [6, 3], mark: { kind: 'priority', group: 'urgent' } },
      { key: 'priority-important', label: 'Important', ids: [4], mark: { kind: 'priority', group: 'important' } },
      { key: 'none', label: 'No priority', ids: [5] },
    ])
    // Only the groups that hold a task; no none line without one.
    expect(numberBreakdown([2, 4], 'priority', ctx, byId).map((e) => e.key)).toEqual(['priority-urgentImportant', 'priority-important'])
  })

  it('a counted id with no task (gone since) is left out', () => {
    expect(numberBreakdown([5, 42], 'priority', ctx, byId)).toEqual([{ key: 'none', label: 'No priority', ids: [5] }])
  })
})
