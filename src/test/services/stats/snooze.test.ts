import { describe, it, expect } from 'vitest'
import type { TodoEvent } from '../../../models'
import { selectMostDeferred } from '../../../services/stats/snooze'
import { makeTodo } from '../../helpers'

function ev(overrides: Partial<TodoEvent> & Pick<TodoEvent, 'todoId' | 'type' | 'timestamp'>): TodoEvent {
  return {
    fromValue: null,
    toValue: null,
    ...overrides,
  }
}

describe('selectMostDeferred', () => {
  it('counts only future-shift scheduled events (toValue > fromValue)', () => {
    const todos = [makeTodo({ id: 1 })]
    const events: TodoEvent[] = [
      // forward shift → counts
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-01T08:00:00Z', fromValue: '2026-04-01T00:00:00Z', toValue: '2026-04-05T00:00:00Z' }),
      // backward shift (rescheduling earlier) → does not count
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-02T08:00:00Z', fromValue: '2026-04-05T00:00:00Z', toValue: '2026-04-03T00:00:00Z' }),
      // same-day → does not count
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-03T08:00:00Z', fromValue: '2026-04-03T00:00:00Z', toValue: '2026-04-03T00:00:00Z' }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(1)
    expect(out[0]!.count).toBe(1)
  })

  it('skips events whose from/to is null (initial schedule from-unset is not a snooze)', () => {
    const todos = [makeTodo({ id: 1 })]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-01T08:00:00Z', fromValue: null, toValue: '2026-04-05T00:00:00Z' }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(0)
  })

  it('skips events with fuzzy from or to (cannot compare meaningfully)', () => {
    const todos = [makeTodo({ id: 1 })]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-01T08:00:00Z', fromValue: 'fuzzy:this-week', toValue: '2026-04-10T00:00:00Z' }),
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-02T08:00:00Z', fromValue: '2026-04-10T00:00:00Z', toValue: 'fuzzy:next-week' }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(0)
  })

  it('drops completed todos from the result set even if they have snooze events', () => {
    const todos = [makeTodo({ id: 1, isCompleted: true })]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-01T08:00:00Z', fromValue: '2026-04-01T00:00:00Z', toValue: '2026-04-05T00:00:00Z' }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(0)
  })

  it('drops events whose todoId is not in the todos list (orphan after delete)', () => {
    const todos = [makeTodo({ id: 1 })]
    const events: TodoEvent[] = [
      ev({ todoId: 999, type: 'scheduled', timestamp: '2026-04-01T08:00:00Z', fromValue: '2026-04-01T00:00:00Z', toValue: '2026-04-05T00:00:00Z' }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(0)
  })

  it('ranks by count desc, then by todoId asc as tiebreaker', () => {
    const todos = [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })]
    const snooze = (todoId: number, ts: string, from: string, to: string): TodoEvent =>
      ev({ todoId, type: 'scheduled', timestamp: ts, fromValue: from, toValue: to })
    const events: TodoEvent[] = [
      // todo 1: 2 snoozes
      snooze(1, '2026-04-01T08:00:00Z', '2026-04-01T00:00:00Z', '2026-04-05T00:00:00Z'),
      snooze(1, '2026-04-05T08:00:00Z', '2026-04-05T00:00:00Z', '2026-04-09T00:00:00Z'),
      // todo 2: 3 snoozes (winner)
      snooze(2, '2026-04-01T08:00:00Z', '2026-04-01T00:00:00Z', '2026-04-03T00:00:00Z'),
      snooze(2, '2026-04-03T08:00:00Z', '2026-04-03T00:00:00Z', '2026-04-06T00:00:00Z'),
      snooze(2, '2026-04-06T08:00:00Z', '2026-04-06T00:00:00Z', '2026-04-10T00:00:00Z'),
      // todo 3: 2 snoozes (ties with todo 1 — id=3 > id=1, so 1 ranks first)
      snooze(3, '2026-04-01T08:00:00Z', '2026-04-01T00:00:00Z', '2026-04-05T00:00:00Z'),
      snooze(3, '2026-04-05T08:00:00Z', '2026-04-05T00:00:00Z', '2026-04-08T00:00:00Z'),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out.map((r) => r.todo.id)).toEqual([2, 1, 3])
    expect(out[0]!.count).toBe(3)
  })

  it('takes top N (default 5)', () => {
    const todos = Array.from({ length: 10 }, (_, i) => makeTodo({ id: i + 1 }))
    const events: TodoEvent[] = todos.map((t) => ev({
      todoId: t.id,
      type: 'scheduled',
      timestamp: '2026-04-01T08:00:00Z',
      fromValue: '2026-04-01T00:00:00Z',
      toValue: '2026-04-05T00:00:00Z',
    }))
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(5)
  })

  it('respects custom limit', () => {
    const todos = Array.from({ length: 10 }, (_, i) => makeTodo({ id: i + 1 }))
    const events: TodoEvent[] = todos.map((t) => ev({
      todoId: t.id,
      type: 'scheduled',
      timestamp: '2026-04-01T08:00:00Z',
      fromValue: '2026-04-01T00:00:00Z',
      toValue: '2026-04-05T00:00:00Z',
    }))
    expect(selectMostDeferred({ events, todos, limit: 3 })).toHaveLength(3)
  })

  it('oldestScheduled = first scheduled event\'s parsed toValue (chronological order)', () => {
    const todos = [makeTodo({ id: 1 })]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-05T08:00:00Z', fromValue: '2026-04-05T00:00:00Z', toValue: '2026-04-09T00:00:00Z' }),
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-01T08:00:00Z', fromValue: null, toValue: '2026-04-05T00:00:00Z' }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out[0]!.oldestScheduled).toEqual(new Date('2026-04-05T00:00:00Z'))
  })

  it('oldestScheduled is null when first scheduled event\'s toValue is fuzzy', () => {
    const todos = [makeTodo({ id: 1 })]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-01T08:00:00Z', fromValue: null, toValue: 'fuzzy:next-week' }),
      ev({ todoId: 1, type: 'scheduled', timestamp: '2026-04-05T08:00:00Z', fromValue: '2026-04-05T00:00:00Z', toValue: '2026-04-09T00:00:00Z' }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(1)
    expect(out[0]!.oldestScheduled).toBeNull()
  })

  it('non-scheduled event types are ignored entirely', () => {
    const todos = [makeTodo({ id: 1 })]
    const events: TodoEvent[] = [
      ev({ todoId: 1, type: 'created', timestamp: '2026-04-01T08:00:00Z' }),
      ev({ todoId: 1, type: 'completed', timestamp: '2026-04-02T08:00:00Z' }),
      ev({ todoId: 1, type: 'reopened', timestamp: '2026-04-03T08:00:00Z' }),
      ev({ todoId: 1, type: 'deadline', timestamp: '2026-04-04T08:00:00Z', fromValue: null, toValue: '2026-04-10T00:00:00Z' }),
      ev({ todoId: 1, type: 'status', timestamp: '2026-04-05T08:00:00Z', fromValue: null, toValue: 5 }),
    ]
    const out = selectMostDeferred({ events, todos })
    expect(out).toHaveLength(0)
  })
})
