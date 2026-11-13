import { describe, expect, it } from 'vitest'
import { daysLabel, oldestWords, rowFigure } from '../../../components/workspace/glance/breakdown-copy'
import type { BreakdownRow } from '../../../services/stats/breakdown'

/** A Breakdown's words (`glance/breakdown-copy`). */

const row = (days: number | null, n = 2): BreakdownRow => ({
  key: 'person-1',
  label: 'Aisha',
  entity: { kind: 'none' },
  ids: Array.from({ length: n }, (_, i) => i + 1),
  overdue: 0,
  columns: {},
  oldest: days == null ? null : { id: 1, title: 'T', days },
  medianDays: days,
})

describe('an oldest task’s age (cr34 G10)', () => {
  it('a plain age in days; by due date, a date still ahead reads when it is due, never a negative age', () => {
    expect(daysLabel(19)).toBe('19 d')
    expect(daysLabel(19, 'lastFollowup')).toBe('19 d')
    expect(daysLabel(3, 'due')).toBe('3 d')
    expect(daysLabel(0, 'due')).toBe('0 d')
    expect(daysLabel(-1, 'due')).toBe('in 1 d')
    expect(daysLabel(-5, 'due')).toBe('in 5 d')
  })

  it('in a row’s accessible name', () => {
    expect(oldestWords(19, 'lastFollowup')).toBe('oldest 19 days')
    expect(oldestWords(1, 'created')).toBe('oldest 1 day')
    expect(oldestWords(3, 'due')).toBe('oldest 3 days overdue')
    expect(oldestWords(1, 'due')).toBe('oldest 1 day overdue')
    expect(oldestWords(0, 'due')).toBe('oldest due today')
    expect(oldestWords(-1, 'due')).toBe('oldest due in 1 day')
    expect(oldestWords(-5, 'due')).toBe('oldest due in 5 days')
  })

  it('a row’s figure: its count, or its oldest’s age by the Breakdown’s date; – without one', () => {
    expect(rowFigure(row(-5), 'count', 'due')).toBe('2')
    expect(rowFigure(row(-5), 'oldest', 'due')).toBe('in 5 d')
    expect(rowFigure(row(4), 'oldest', 'due')).toBe('4 d')
    expect(rowFigure(row(4), 'oldest', 'modified')).toBe('4 d')
    expect(rowFigure(row(null), 'oldest', 'due')).toBe('–')
  })
})
