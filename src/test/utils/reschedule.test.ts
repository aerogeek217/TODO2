import { describe, it, expect } from 'vitest'
import { buildRescheduleUpdate } from '../../utils/reschedule'
import { makeTodo } from '../helpers'

describe('buildRescheduleUpdate', () => {
  it('moves the due date to the new day, preserving its time of day', () => {
    const todo = makeTodo({
      id: 4,
      dueDate: new Date(2026, 3, 15, 17, 45, 0),
    })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 20))
    expect(next.dueDate).toEqual(new Date(2026, 3, 20, 17, 45, 0))
  })

  it('sets a due date at noon on a task that had none', () => {
    const todo = makeTodo({ id: 3, nextFollowupAt: new Date(2026, 3, 1) })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 20))
    expect(next.dueDate).toEqual(new Date(2026, 3, 20, 12, 0, 0))
    // The follow-up date is not a calendar placement: untouched.
    expect(next.nextFollowupAt).toEqual(new Date(2026, 3, 1))
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
