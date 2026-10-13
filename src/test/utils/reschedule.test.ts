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
    // Only the due date changes: the follow-up date isn't in the changes.
    expect(next).toEqual({ dueDate: new Date(2026, 3, 20, 12, 0, 0) })
  })

  it('moves the next follow-up instead when asked, keeping its time; nothing else is in the changes', () => {
    const todo = makeTodo({
      id: 5,
      dueDate: new Date(2026, 3, 15, 9, 0, 0),
      nextFollowupAt: new Date(2026, 3, 18, 8, 30, 0),
      lastFollowupAt: new Date(2026, 3, 1),
    })
    const next = buildRescheduleUpdate(todo, new Date(2026, 3, 22), 'followup')
    expect(next).toEqual({ nextFollowupAt: new Date(2026, 3, 22, 8, 30, 0) })
  })

  it('sets a follow-up at noon on a task that had none', () => {
    const next = buildRescheduleUpdate(makeTodo({ id: 6 }), new Date(2026, 3, 22), 'followup')
    expect(next).toEqual({ nextFollowupAt: new Date(2026, 3, 22, 12, 0, 0) })
  })
})
