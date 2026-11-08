import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem } from '../../../models'
import { computeTodayPicks, TODAY_SUGGESTIONS } from '../../../services/stats/today-picks'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 10, 11)
const RECENT = new Date(2026, 10, 10)
const OLD = new Date(2026, 8, 1) // untouched for 70 days

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: RECENT, ...overrides })
}

const ctx = { today, urgentRange: 3 as const }

describe('computeTodayPicks', () => {
  it('no tasks: nothing picked, nothing suggested', () => {
    expect(computeTodayPicks([], ctx)).toEqual({ focusIds: [], suggestions: [] })
  })

  it('the open Focus tasks by due date; a done one isn’t today’s', () => {
    const tasks = [
      task({ id: 1, focus: true, dueDate: new Date(2026, 10, 20) }),
      task({ id: 2, focus: true, dueDate: new Date(2026, 10, 12) }),
      task({ id: 3, focus: true, isCompleted: true }),
    ]
    expect(computeTodayPicks(tasks, ctx).focusIds).toEqual([2, 1])
  })

  it('suggests what is due today, then what is slipping, never a Focus task, at most five', () => {
    const tasks = [
      task({ id: 1, dueDate: today }),
      task({ id: 2, dueDate: today, focus: true }),
      task({ id: 3, dueDate: new Date(2026, 10, 9), modifiedAt: OLD }), // late, untouched: slipping
      task({ id: 4, dueDate: new Date(2026, 10, 12), modifiedAt: OLD }), // due soon, untouched: slipping
      task({ id: 5, dueDate: new Date(2026, 10, 9) }), // late but touched: in hand, not suggested
      task({ id: 6, dueDate: today, modifiedAt: OLD }), // due today and slipping: once, as due today
      task({ id: 7, dueDate: new Date(2026, 11, 30), modifiedAt: OLD }), // drifting: not suggested
    ]
    expect(computeTodayPicks(tasks, ctx).suggestions).toEqual([
      { id: 1, reason: 'dueToday' },
      { id: 6, reason: 'dueToday' },
      { id: 3, reason: 'slipping' },
      { id: 4, reason: 'slipping' },
    ])
    const many = Array.from({ length: 8 }, (_, i) => task({ id: 10 + i, dueDate: today }))
    expect(computeTodayPicks(many, ctx).suggestions).toHaveLength(TODAY_SUGGESTIONS)
  })
})
