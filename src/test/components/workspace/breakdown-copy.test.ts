import { describe, expect, it } from 'vitest'
import { breakdownLines, daysLabel, followupAgeLabel, followupAgeTooltip, oldestWords, rowFigure, sortHeading, sortWords } from '../../../components/workspace/glance/breakdown-copy'
import type { BreakdownColumn } from '../../../models/chart-widgets'
import { emptyPredicate } from '../../../models/filter-predicate'
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
  followup: null,
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

describe('a count column’s follow-up age (board V1)', () => {
  const followup: BreakdownColumn = { id: 'followup', name: 'Follow-up', color: '#f5c842', filter: emptyPredicate(), litWhen: 'above', litAt: 0, age: { yellowAfterDays: 14 } }
  const due: BreakdownColumn = { id: 'due', name: 'Due', color: '#e86bf0', filter: emptyPredicate(), litWhen: 'above', litAt: 0 }
  const aged = (days: number, never = false): BreakdownRow => ({
    ...row(null, 3),
    columns: { followup: [1, 2, 3], due: [1] },
    followup: { oldest: { id: 1, title: 'Vendor contract renewal', days }, medianDays: 9, neverFollowedUp: never },
  })

  it('drawn `23d`; its tooltip names the oldest open task and the median', () => {
    expect(followupAgeLabel(23)).toBe('23d')
    expect(followupAgeLabel(0)).toBe('0d')
    expect(followupAgeTooltip(aged(23).followup!)).toBe('Oldest: “Vendor contract renewal” · 23 days since followed up · median 9 days')
    expect(followupAgeTooltip({ ...aged(1).followup!, medianDays: 1 })).toBe('Oldest: “Vendor contract renewal” · 1 day since followed up · median 1 day')
    expect(followupAgeTooltip(aged(23, true).followup!)).toBe('Oldest: “Vendor contract renewal” · 23 days since created, never followed up · median 9 days')
  })

  it('Copy adds it after the column’s count (none without an open task)', () => {
    const lines = breakdownLines('People', 3, 'open', [{ ...aged(23), label: 'Marcus' }, { ...row(null, 1), label: 'Lena' }], 'count', [due, followup])
    expect(lines[1]).toEqual([{ label: 'Marcus', count: '3' }, { label: 'Due', count: '1' }, { label: 'Follow-up', count: '3 · 23d' }])
    expect(lines[2]).toEqual([{ label: 'Lena', count: '1' }, { label: 'Due', count: '0' }, { label: 'Follow-up', count: '0' }])
  })

  it('its sort’s words: the heading `Follow-up age`; oldest first, reversed latest first; a column without it reads as the default', () => {
    expect(sortHeading('age:followup', 'people', 'count', [due, followup])).toBe('Follow-up age')
    expect(sortWords({ by: 'age:followup' }, 'people', 'count', [due, followup])).toBe('Longest since follow-up first')
    expect(sortWords({ by: 'age:followup', reversed: true }, 'people', 'count', [due, followup])).toBe('Latest follow-up first')
    expect(sortWords({ by: 'age:due' }, 'people', 'count', [due, followup])).toBe('Most counted first')
  })
})
