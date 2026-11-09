import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, TodoEvent, TodoEventType } from '../../../models'
import { computeMetricHistory } from '../../fixtures/v77-metrics'
import { eventsByTask, taskReplay } from '../../../services/stats/task-history'
import { HISTORY_EVENT_TYPES } from '../../fixtures/v77-metrics'
import { makeTodo } from '../../helpers'

const today = new Date(2026, 10, 11) // Wed 11 Nov
const day = (n: number, hour = 12) => new Date(2026, 10, 11 + n, hour)
const OLD = new Date(2026, 0, 1)

let seq = 0
function ev(todoId: number, type: TodoEventType, at: Date, fromValue: string | null = null): TodoEvent {
  return { id: ++seq, todoId, type, fromValue, toValue: null, timestamp: at.toISOString() }
}

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: OLD, ...overrides })
}

describe('taskReplay', () => {
  it('before its created event, absent; before a completion, open; before a reopen, done', () => {
    const t = task({ id: 1, createdAt: day(-5) })
    const events = eventsByTask([ev(1, 'created', day(-5)), ev(1, 'completed', day(-3)), ev(1, 'reopened', day(-1))], new Set([1]), HISTORY_EVENT_TYPES, today)
    const at = taskReplay(t, events.get(1), today)
    expect(at(-6).state).toBe('absent')
    expect(at(-4).state).toBe('open')
    expect(at(-2)).toEqual({ state: 'done', completed: day(-3), due: null })
    expect(at(0).state).toBe('open')
  })

  it('in a gap: absent before its createdAt; a completed task open until its completion day', () => {
    const t = task({ id: 1, createdAt: day(-4), isCompleted: true, completedAt: day(-2) })
    const at = taskReplay(t, undefined, today)
    expect(at(-5).state).toBe('absent')
    expect(at(-3).state).toBe('open')
    expect(at(-2).state).toBe('done')
  })

  it('the due date before its next deadline event; with none, the date it has now', () => {
    const t = task({ id: 1, dueDate: day(4) })
    const events = eventsByTask([ev(1, 'deadline', day(-1, 9), day(-3).toISOString())], new Set([1]), HISTORY_EVENT_TYPES, today)
    const at = taskReplay(t, events.get(1), today)
    expect(at(-2).due).toEqual(day(-3))
    expect(at(-1).due).toEqual(day(4))
  })
})

describe('the Overdue history replays each task to each day’s end', () => {
  it('its rise since yesterday is the tasks that went late since: by the day, a reopen, a due date moved into the past', () => {
    const tasks = [
      task({ id: 1, dueDate: day(-1) }), // went late today
      task({ id: 2, dueDate: day(-4) }), // late already
      task({ id: 3, dueDate: day(-2) }), // reopened today: late again
      task({ id: 4, dueDate: day(-3) }), // moved into the past today
    ]
    const events = [
      ev(3, 'completed', day(-6)), ev(3, 'reopened', day(0, 9)),
      ev(4, 'deadline', day(0, 9), day(6).toISOString()),
    ]
    const history = computeMetricHistory(tasks, events, { today, weekStartsOn: 0 })
    const overdue = history.series.overdue
    expect((overdue.at(-1) ?? 0) - (overdue.at(-2) ?? 0)).toBe(3)
  })
})
