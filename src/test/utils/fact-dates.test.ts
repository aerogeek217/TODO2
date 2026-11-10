import { describe, it, expect } from 'vitest'
import { factDateWords } from '../../utils/fact-dates'

// The task layout's one date look (board BJ): the rows' words, how far it is
// where the words don't say it, the full date for the tooltip.
const TODAY = new Date(2026, 10, 9)
const day = (offset: number) => new Date(2026, 10, 9 + offset)

describe('factDateWords', () => {
  it('a due date before today: its date and how late', () => {
    expect(factDateWords(day(-3), TODAY, 'relative', 'due')).toEqual({ words: '11/06', relative: '3 days late', full: 'Friday, November 6, 2026' })
    expect(factDateWords(day(-1), TODAY, 'relative', 'due').relative).toBe('1 day late')
    expect(factDateWords(day(-21), TODAY, 'relative', 'due').relative).toBe('3 weeks late')
  })

  it('today and the next six days say it themselves', () => {
    expect(factDateWords(day(0), TODAY, 'relative', 'next')).toEqual({ words: 'Today', full: 'Monday, November 9, 2026' })
    expect(factDateWords(day(3), TODAY, 'relative', 'due')).toEqual({ words: 'Thu', full: 'Thursday, November 12, 2026' })
  })

  it('a numeric date says how far it is', () => {
    expect(factDateWords(day(7), TODAY, 'relative', 'next')).toMatchObject({ words: '11/16', relative: 'in 7 days' })
    expect(factDateWords(day(-14), TODAY, 'relative', 'last')).toMatchObject({ words: '10/26', relative: '2 weeks ago' })
  })

  it('under Settings › Dates `MM/DD`, every date is numeric with its distance (today plain)', () => {
    expect(factDateWords(day(3), TODAY, 'numeric', 'next')).toMatchObject({ words: '11/12', relative: 'in 3 days' })
    expect(factDateWords(day(0), TODAY, 'numeric', 'next')).toEqual({ words: '11/09', full: 'Monday, November 9, 2026' })
  })
})
