import { describe, it, expect } from 'vitest'
import {
  DEFAULT_URGENT_DUE_WITHIN_DAYS,
  dueDatePhrase,
  formatUrgentDueWithinDays,
  isEffectivelyUrgent,
  isUrgentByDate,
  parseUrgentDueWithinDays,
  urgentByDateReason,
  urgentMark,
  urgentRangeLabel,
  urgentToggleHint,
} from '../../utils/urgency'

// Sat 10 Oct 2026, mid-morning: "today" is the day, not the moment.
const today = new Date(2026, 9, 10, 9, 30)
const day = (offset: number, hour = 0) => new Date(2026, 9, 10 + offset, hour)
const task = (patch: { urgent?: boolean; dueDate?: Date; isCompleted?: boolean } = {}) =>
  ({ isCompleted: false, ...patch })

describe('isUrgentByDate / isEffectivelyUrgent', () => {
  it.each([
    // [range, due offset, urgent by date]
    [3, -5, true], // overdue
    [3, 0, true], // today
    [3, 3, true], // last day of the range
    [3, 4, false], // just outside
    [0, 0, true], // Today: due today
    [0, -1, true], // Today: overdue
    [0, 1, false], // Today: tomorrow is not
    [1, 1, true],
    [14, 14, true],
    [14, 15, false],
  ] as const)('range %s, due %s days away → %s', (range, offset, expected) => {
    expect(isUrgentByDate(task({ dueDate: day(offset) }), today, range)).toBe(expected)
    expect(isEffectivelyUrgent(task({ dueDate: day(offset) }), today, range)).toBe(expected)
  })

  it('is day-granular: a due time later today is still today', () => {
    expect(isUrgentByDate(task({ dueDate: day(3, 23) }), today, 3)).toBe(true)
    expect(isUrgentByDate(task({ dueDate: day(4, 0) }), today, 3)).toBe(false)
  })

  it('range off: only the flag makes a task urgent', () => {
    expect(isUrgentByDate(task({ dueDate: day(-1) }), today, null)).toBe(false)
    expect(isEffectivelyUrgent(task({ dueDate: day(-1) }), today, null)).toBe(false)
    expect(isEffectivelyUrgent(task({ urgent: true }), today, null)).toBe(true)
  })

  it('no due date: only the flag', () => {
    expect(isUrgentByDate(task(), today, 3)).toBe(false)
    expect(isEffectivelyUrgent(task(), today, 3)).toBe(false)
    expect(isEffectivelyUrgent(task({ urgent: true }), today, 3)).toBe(true)
  })

  it('completed tasks are never urgent by date, but keep their flag', () => {
    expect(isUrgentByDate(task({ dueDate: day(-2), isCompleted: true }), today, 3)).toBe(false)
    expect(isEffectivelyUrgent(task({ dueDate: day(-2), isCompleted: true }), today, 3)).toBe(false)
    expect(isEffectivelyUrgent(task({ urgent: true, isCompleted: true }), today, 3)).toBe(true)
  })
})

describe('urgentMark', () => {
  it('flag wins over the date; the clock only when the date alone makes it urgent', () => {
    expect(urgentMark(task({ urgent: true, dueDate: day(1) }), today, 3)).toBe('flag')
    expect(urgentMark(task({ urgent: true }), today, 3)).toBe('flag')
    expect(urgentMark(task({ dueDate: day(1) }), today, 3)).toBe('date')
    expect(urgentMark(task({ dueDate: day(9) }), today, 3)).toBeNull()
    expect(urgentMark(task({ dueDate: day(-1), isCompleted: true }), today, 3)).toBeNull()
  })
})

describe('urgentByDateReason / dueDatePhrase', () => {
  it('words the reason', () => {
    expect(urgentByDateReason(task({ dueDate: day(3) }), today, 3)).toBe('Due Tue 13, within 3 days.')
    expect(urgentByDateReason(task({ dueDate: day(1) }), today, 1)).toBe('Due Sun 11, within 1 day.')
    expect(urgentByDateReason(task({ dueDate: day(0) }), today, 3)).toBe('Due today.')
    expect(urgentByDateReason(task({ dueDate: day(-2) }), today, 3)).toBe('Overdue (Thu 8), so it counts as urgent.')
    expect(urgentByDateReason(task({ dueDate: day(9) }), today, 3)).toBe('')
    expect(urgentByDateReason(task({ urgent: true }), today, 3)).toBe('')
  })

  it('phrases a due date in a sentence', () => {
    expect(dueDatePhrase(day(0), today)).toBe('today')
    expect(dueDatePhrase(day(3), today)).toBe('Tue 13')
    expect(dueDatePhrase(day(-2), today)).toBe('overdue (Thu 8)')
  })
})

describe('urgentToggleHint', () => {
  it('one task: unflagged and urgent by date → the hint to flag it; flagged → the date keeps it urgent', () => {
    expect(urgentToggleHint([task({ dueDate: day(3) })], today, 3)).toBe('Urgent by due date — due Tue 13. Click to flag it urgent too.')
    expect(urgentToggleHint([task({ dueDate: day(0) })], today, 3)).toBe('Urgent by due date — due today. Click to flag it urgent too.')
    expect(urgentToggleHint([task({ dueDate: day(-2) })], today, 3)).toBe('Urgent by due date — overdue (Thu 8). Click to flag it urgent too.')
    expect(urgentToggleHint([task({ urgent: true, dueDate: day(1) })], today, 3)).toBe('Its due date keeps it urgent even unflagged — due Sun 11.')
  })

  it('nothing to say when no due date makes it urgent (none, too far, range off, completed)', () => {
    expect(urgentToggleHint([task()], today, 3)).toBe('')
    expect(urgentToggleHint([task({ urgent: true })], today, 3)).toBe('')
    expect(urgentToggleHint([task({ dueDate: day(9) })], today, 3)).toBe('')
    expect(urgentToggleHint([task({ dueDate: day(1) })], today, null)).toBe('')
    expect(urgentToggleHint([task({ dueDate: day(1), isCompleted: true })], today, 3)).toBe('')
  })

  it('several tasks: how many are urgent by their due dates', () => {
    expect(urgentToggleHint([task({ dueDate: day(1) }), task()], today, 3)).toBe('1 of 2 tasks is urgent by its due date, flagged or not.')
    expect(urgentToggleHint([task({ dueDate: day(1) }), task({ urgent: true, dueDate: day(0) }), task()], today, 3))
      .toBe('2 of 3 tasks are urgent by their due dates, flagged or not.')
    expect(urgentToggleHint([task(), task({ urgent: true })], today, 3)).toBe('')
  })
})

describe('the urgentDueWithinDays setting value', () => {
  it('defaults to 3 days', () => {
    expect(DEFAULT_URGENT_DUE_WITHIN_DAYS).toBe(3)
  })

  it('round-trips off and day counts; rejects anything else', () => {
    for (const range of [null, 0, 1, 2, 3, 7, 14, 365]) {
      expect(parseUrgentDueWithinDays(formatUrgentDueWithinDays(range))).toBe(range)
    }
    expect(formatUrgentDueWithinDays(null)).toBe('off')
    for (const bad of ['', '-1', '366', '1.5', 'soon', ' 3', '1000']) expect(parseUrgentDueWithinDays(bad), bad).toBeUndefined()
  })

  it('labels the choices', () => {
    expect([null, 0, 1, 2, 3, 7, 14].map(urgentRangeLabel)).toEqual(['Off', 'Today', '1 day', '2 days', '3 days', '1 week', '2 weeks'])
  })
})
