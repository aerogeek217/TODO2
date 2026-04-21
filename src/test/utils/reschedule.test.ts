import { describe, it, expect } from 'vitest'
import { buildRescheduleUpdate } from '../../utils/reschedule'
import { makeTodo } from '../helpers'

describe('buildRescheduleUpdate', () => {
  it('updates scheduledDate (committing to kind=date) when the todo has a scheduledDate', () => {
    const todo = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 15, 14, 30, 0) },
    })
    const target = new Date(2026, 3, 20) // midnight
    const next = buildRescheduleUpdate(todo, target)
    expect(next.scheduledDate).toEqual({
      kind: 'date',
      value: new Date(2026, 3, 20, 14, 30, 0),
    })
    expect(next.dueDate).toBeUndefined()
  })

  it('preserves scheduledDate time of day (14:30) on the new day', () => {
    const todo = makeTodo({
      id: 2,
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 15, 9, 5, 0) },
    })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 20))
    if (next.scheduledDate?.kind !== 'date') throw new Error('expected date kind')
    const d = next.scheduledDate.value
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(5)
  })

  it('rewrites a fuzzy scheduled token to a precise date (no time to preserve → noon)', () => {
    const todo = makeTodo({
      id: 3,
      scheduledDate: { kind: 'fuzzy', token: 'today' },
    })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 20))
    expect(next.scheduledDate?.kind).toBe('date')
    if (next.scheduledDate?.kind !== 'date') throw new Error('expected date kind')
    const d = next.scheduledDate.value
    expect(d.getHours()).toBe(12)
    expect(d.getMinutes()).toBe(0)
  })

  it('updates dueDate when the todo has only a dueDate, preserving time', () => {
    const todo = makeTodo({
      id: 4,
      dueDate: new Date(2026, 3, 15, 17, 45, 0),
    })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 20))
    expect(next.scheduledDate).toBeUndefined()
    expect(next.dueDate?.getFullYear()).toBe(2026)
    expect(next.dueDate?.getMonth()).toBe(3)
    expect(next.dueDate?.getDate()).toBe(20)
    expect(next.dueDate?.getHours()).toBe(17)
    expect(next.dueDate?.getMinutes()).toBe(45)
  })

  it('prefers scheduledDate when both scheduledDate and dueDate are set', () => {
    const todo = makeTodo({
      id: 5,
      scheduledDate: { kind: 'date', value: new Date(2026, 3, 15, 10, 0, 0) },
      dueDate: new Date(2026, 3, 18, 20, 0, 0),
    })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 20))
    // dueDate is untouched; only scheduledDate moves
    expect(next.dueDate).toEqual(new Date(2026, 3, 18, 20, 0, 0))
    expect(next.scheduledDate?.kind).toBe('date')
    if (next.scheduledDate?.kind !== 'date') throw new Error('expected date kind')
    expect(next.scheduledDate.value.getDate()).toBe(20)
    expect(next.scheduledDate.value.getHours()).toBe(10)
  })

  it('bumps modifiedAt', () => {
    const todo = makeTodo({
      id: 6,
      dueDate: new Date(2026, 3, 15),
      modifiedAt: new Date(2026, 0, 1),
    })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 20))
    expect(next.modifiedAt.getTime()).toBeGreaterThan(todo.modifiedAt.getTime())
  })
})
