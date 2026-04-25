import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem } from '../../models'
import { bucketByDate, dateBucketBoundaries } from '../../utils/bucket-by-date'
import { startOfDay, MS_PER_DAY } from '../../utils/date'

function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    isCompleted: false,
    sortOrder: overrides.id,
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...overrides,
  } as PersistedTodoItem
}

describe('dateBucketBoundaries', () => {
  it('honors weekStartsOn = 1 (Mon-first)', () => {
    // 2026-04-15 is a Wednesday. Mon-first week ends Sunday 4/19.
    const today = startOfDay(new Date('2026-04-15T00:00:00'))
    const ctx = dateBucketBoundaries(today, 1)
    const expected = startOfDay(new Date('2026-04-19T00:00:00')).getTime()
    expect(ctx.thisWeekEnd).toBe(expected)
  })

  it('honors weekStartsOn = 0 (Sun-first)', () => {
    // 2026-04-15 is a Wednesday. Sun-first week ends Saturday 4/18.
    const today = startOfDay(new Date('2026-04-15T00:00:00'))
    const ctx = dateBucketBoundaries(today, 0)
    const expected = startOfDay(new Date('2026-04-18T00:00:00')).getTime()
    expect(ctx.thisWeekEnd).toBe(expected)
  })

  it('next-week boundary is exactly 7 days after this-week', () => {
    const today = startOfDay(new Date('2026-04-15T00:00:00'))
    const ctx = dateBucketBoundaries(today, 1)
    expect(ctx.nextWeekEnd - ctx.thisWeekEnd).toBe(7 * MS_PER_DAY)
  })

  it('this-month boundary is the last day of the calendar month', () => {
    const today = startOfDay(new Date('2026-04-15T00:00:00'))
    const ctx = dateBucketBoundaries(today, 1)
    expect(ctx.thisMonthEnd).toBe(startOfDay(new Date('2026-04-30T00:00:00')).getTime())
  })
})

describe('bucketByDate — 6-bucket effective form', () => {
  const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
  const windows = ['tomorrow', 'thisWeek', 'nextWeek', 'laterMonth', 'nextMonth', 'beyond'] as const

  it('places a tomorrow date in the tomorrow bucket', () => {
    const t = makeTodo({ id: 1, dueDate: new Date(today.getTime() + MS_PER_DAY) })
    const { buckets } = bucketByDate(
      [t],
      (x) => x.dueDate ? startOfDay(new Date(x.dueDate)) : null,
      today,
      1,
      windows,
    )
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.key).toBe('tomorrow')
    expect(buckets[0]!.todos.map((x) => x.id)).toEqual([1])
  })

  it('places a Sunday-of-this-week date in this-week (Mon-first)', () => {
    const sunday = startOfDay(new Date('2026-04-19T00:00:00'))
    const t = makeTodo({ id: 1, dueDate: sunday })
    const { buckets } = bucketByDate(
      [t],
      (x) => x.dueDate ? startOfDay(new Date(x.dueDate)) : null,
      today,
      1,
      windows,
    )
    expect(buckets[0]!.key).toBe('thisWeek')
  })

  it('places the same Sunday-of-this-week in next-week with Sun-first (off-by-one shift)', () => {
    const sunday = startOfDay(new Date('2026-04-19T00:00:00'))
    const t = makeTodo({ id: 1, dueDate: sunday })
    const { buckets } = bucketByDate(
      [t],
      (x) => x.dueDate ? startOfDay(new Date(x.dueDate)) : null,
      today,
      0,
      windows,
    )
    expect(buckets[0]!.key).toBe('nextWeek')
  })

  it('places far-future dates in beyond', () => {
    const farOut = startOfDay(new Date('2026-09-01T00:00:00'))
    const t = makeTodo({ id: 1, dueDate: farOut })
    const { buckets } = bucketByDate(
      [t],
      (x) => x.dueDate ? startOfDay(new Date(x.dueDate)) : null,
      today,
      1,
      windows,
    )
    expect(buckets[0]!.key).toBe('beyond')
  })

  it('null-date todos go to noDate, never into a window', () => {
    const t = makeTodo({ id: 1 })
    const { buckets, noDate } = bucketByDate(
      [t],
      () => null,
      today,
      1,
      windows,
    )
    expect(buckets).toHaveLength(0)
    expect(noDate).toEqual([t])
  })
})

describe('bucketByDate — 4-bucket short form', () => {
  const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
  const windows = ['overdue', 'today', 'thisWeek', 'later'] as const

  it('classifies overdue, today, thisWeek, later in window order', () => {
    const overdueTask = makeTodo({ id: 1, dueDate: new Date(today.getTime() - MS_PER_DAY) })
    const todayTask = makeTodo({ id: 2, dueDate: today })
    const thisWeekTask = makeTodo({ id: 3, dueDate: new Date('2026-04-18T00:00:00') }) // Sat
    const laterTask = makeTodo({ id: 4, dueDate: new Date('2026-05-15T00:00:00') })
    const { buckets } = bucketByDate(
      [overdueTask, todayTask, thisWeekTask, laterTask],
      (x) => x.dueDate ? startOfDay(new Date(x.dueDate)) : null,
      today,
      1,
      windows,
    )
    expect(buckets.map((b) => b.key)).toEqual(['overdue', 'today', 'thisWeek', 'later'])
    expect(buckets[0]!.todos.map((t) => t.id)).toEqual([1])
    expect(buckets[1]!.todos.map((t) => t.id)).toEqual([2])
    expect(buckets[2]!.todos.map((t) => t.id)).toEqual([3])
    expect(buckets[3]!.todos.map((t) => t.id)).toEqual([4])
  })
})
