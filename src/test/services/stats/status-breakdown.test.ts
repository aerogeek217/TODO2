import { describe, it, expect } from 'vitest'
import type { Status } from '../../../models'
import { selectStatusBreakdown } from '../../../services/stats/status-breakdown'
import { makeTodo } from '../../helpers'

function makeStatus(overrides: Partial<Status> & { id: number; name: string }): Status & { id: number } {
  return {
    color: '#888',
    sortOrder: overrides.id,
    icon: 'circle',
    ...overrides,
  }
}

describe('selectStatusBreakdown', () => {
  it('returns one entry per configured status in statuses order, including zero-count entries', () => {
    const statuses = [
      makeStatus({ id: 10, name: 'Todo', color: '#aaa', icon: 'circle' }),
      makeStatus({ id: 11, name: 'Doing', color: '#bbb', icon: 'arrow' }),
      makeStatus({ id: 12, name: 'Blocked', color: '#ccc', icon: 'stop-sign' }),
    ]
    const todos = [
      makeTodo({ id: 1, statusId: 10 }),
      makeTodo({ id: 2, statusId: 10 }),
      makeTodo({ id: 3, statusId: 11 }),
    ]

    const out = selectStatusBreakdown(todos, statuses)
    expect(out.map((e) => e.id)).toEqual([10, 11, 12])
    expect(out.map((e) => e.count)).toEqual([2, 1, 0])
    expect(out[0]).toMatchObject({ label: 'Todo', icon: 'circle', color: '#aaa' })
    expect(out[1]).toMatchObject({ label: 'Doing', icon: 'arrow', color: '#bbb' })
  })

  it('drops completed todos (open-definition: !isCompleted)', () => {
    const statuses = [makeStatus({ id: 10, name: 'Todo', color: '#aaa' })]
    const todos = [
      makeTodo({ id: 1, statusId: 10, isCompleted: false }),
      makeTodo({ id: 2, statusId: 10, isCompleted: true }),
      makeTodo({ id: 3, statusId: 10, isCompleted: true }),
    ]
    const out = selectStatusBreakdown(todos, statuses)
    expect(out[0]?.count).toBe(1)
  })

  it("appends a synthetic 'No status' bucket when statusId-null open todos exist", () => {
    const statuses = [makeStatus({ id: 10, name: 'Todo', color: '#aaa' })]
    const todos = [
      makeTodo({ id: 1, statusId: 10 }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3 }),
    ]
    const out = selectStatusBreakdown(todos, statuses)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ id: null, label: 'No status', count: 2 })
  })

  it("does NOT append the 'No status' bucket when no statusId-null open todos exist", () => {
    const statuses = [makeStatus({ id: 10, name: 'Todo', color: '#aaa' })]
    const todos = [
      makeTodo({ id: 1, statusId: 10 }),
      // statusId null but completed → should NOT trigger the synthetic bucket.
      makeTodo({ id: 2, isCompleted: true }),
    ]
    const out = selectStatusBreakdown(todos, statuses)
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe(10)
  })

  it('returns empty array when statuses is empty and no statusId-null open rows', () => {
    expect(selectStatusBreakdown([], [])).toEqual([])
  })

  it('falls back to default icon when status has no icon set', () => {
    const statuses: Status[] = [{ id: 10, name: 'Todo', color: '#aaa', sortOrder: 0 }]
    const todos = [makeTodo({ id: 1, statusId: 10 })]
    const out = selectStatusBreakdown(todos, statuses)
    expect(out[0]?.icon).toBe('circle')
  })

  it('skips statuses with no id (defensive — pre-persist rows shouldn\'t reach here)', () => {
    const statuses: Status[] = [
      { name: 'Pre-insert', color: '#aaa', sortOrder: 0 },
      { id: 10, name: 'Todo', color: '#bbb', sortOrder: 1 },
    ]
    const todos = [makeTodo({ id: 1, statusId: 10 })]
    const out = selectStatusBreakdown(todos, statuses)
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe(10)
  })
})
