import { describe, expect, it } from 'vitest'
import type { DateField } from '../../models/app-view'
import type { FilterExpr } from '../../models/filter-expression'
import type { DateAnchor, DateMatch } from '../../models/filter-predicate'
import { parseExpression, printExpression, type ExpressionNames, type ExpressionParse } from '../../utils/filter-expression'

/**
 * Date comparisons in a filter expression (`due <= +7d`, `followup >= fri`)
 * and relative days (`+3d`, `-30d`): what they read as, what prints, the
 * older words that still read, and the errors for the forms refused.
 */

const PEOPLE = new Map([[1, 'Aisha'], [2, 'Ben']])
const resolver = (map: Map<number, string>) => (name: string) => [...map].find(([, n]) => n.toLowerCase() === name.toLowerCase())?.[0]
const names: ExpressionNames = { person: (id) => PEOPLE.get(id), tag: () => undefined, status: () => undefined }

// Friday 6 Nov 2026.
const TODAY = new Date(2026, 10, 6)

function parse(text: string): ExpressionParse {
  return parseExpression(text, { today: TODAY, names: { person: resolver(PEOPLE), tag: () => undefined, status: () => undefined } })
}

function tree(text: string): FilterExpr | null {
  const r = parse(text)
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`)
  return r.expression
}

function match(text: string): DateMatch {
  const e = tree(text)
  if (e?.kind !== 'date') throw new Error(`${text}: not a date clause`)
  return e.match
}

function canonical(text: string): string {
  const r = parse(text)
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`)
  return printExpression(r.expression, r.showCompleted, names)
}

function errorOf(text: string): { message: string; hint?: string; at: [number, number] } {
  const r = parse(text)
  if (r.ok) throw new Error(`${text} parsed`)
  return { message: r.error.message, hint: r.error.hint, at: [r.error.start, r.error.end] }
}

const rel = (token: string): DateAnchor => ({ kind: 'relative', token } as DateAnchor)
const off = (days: number): DateAnchor => ({ kind: 'offset', days })
const fixed = (y: number, m: number, d: number): DateAnchor => ({ kind: 'fixed', iso: new Date(y, m - 1, d).toISOString() })
const range = (start: DateAnchor | null, end: DateAnchor | null): DateMatch => ({ match: 'range', start, end })
const print = (field: DateField, m: DateMatch) => printExpression({ kind: 'date', field, match: m }, false, names)

describe('filter expressions — date comparisons', () => {
  it('reads each comparison with a day offset', () => {
    expect(match('due <= +7d')).toEqual(range(null, off(7)))
    expect(match('due < +7d')).toEqual(range(null, off(6)))
    expect(match('due >= +7d')).toEqual(range(off(7), null))
    expect(match('due > +7d')).toEqual(range(off(8), null))
    expect(match('due = +7d')).toEqual(range(off(7), off(7)))
    expect(match('created <= -30d')).toEqual(range(null, off(-30)))
    expect(match('created < -30d')).toEqual(range(null, off(-31)))
    expect(match('created > -30d')).toEqual(range(off(-29), null))
  })

  it('reads each comparison with today (the day words stay named)', () => {
    expect(match('due <= today')).toEqual(range(null, rel('today')))
    expect(match('due < today')).toEqual(range(null, rel('yesterday')))
    expect(match('due >= today')).toEqual(range(rel('today'), null))
    expect(match('due > today')).toEqual(range(rel('tomorrow'), null))
    expect(match('due = today')).toEqual(range(rel('today'), rel('today')))
    expect(match('due < +2d')).toEqual(range(null, rel('tomorrow')))
  })

  it('reads each comparison with a weekday, by the field’s direction', () => {
    // Due: the next Friday, 11/13; created: the last one, 10/30.
    expect(match('due <= fri')).toEqual(range(null, fixed(2026, 11, 13)))
    expect(match('due < fri')).toEqual(range(null, fixed(2026, 11, 12)))
    expect(match('due >= fri')).toEqual(range(fixed(2026, 11, 13), null))
    expect(match('due > fri')).toEqual(range(fixed(2026, 11, 14), null))
    expect(match('due = fri')).toEqual(range(fixed(2026, 11, 13), fixed(2026, 11, 13)))
    expect(match('created < fri')).toEqual(range(null, fixed(2026, 10, 29)))
    expect(match('followup >= next mon')).toEqual(range(fixed(2026, 11, 9), null))
  })

  it('reads each comparison with a date, across a month and a year', () => {
    expect(match('due >= 11/30')).toEqual(range(fixed(2026, 11, 30), null))
    expect(match('due > 11/30')).toEqual(range(fixed(2026, 12, 1), null))
    expect(match('due < 1/1/2027')).toEqual(range(null, fixed(2026, 12, 31)))
    expect(match('due <= 12/31/2026')).toEqual(range(null, fixed(2026, 12, 31)))
    expect(match('completed = 11/2/2026')).toEqual(range(fixed(2026, 11, 2), fixed(2026, 11, 2)))
  })

  it('reads a week or month anchor, < / > onto its named neighbour', () => {
    expect(match('due <= start of week')).toEqual(range(null, rel('start-of-week')))
    expect(match('due >= start of next month')).toEqual(range(rel('start-of-next-month'), null))
    expect(match('due = end of week')).toEqual(range(rel('end-of-week'), rel('end-of-week')))
    expect(match('due < start of week')).toEqual(range(null, rel('end-of-last-week')))
    expect(match('due > end of week')).toEqual(range(rel('start-of-next-week'), null))
    expect(match('due < start of next week')).toEqual(range(null, rel('end-of-week')))
    expect(match('due > end of last week')).toEqual(range(rel('start-of-week'), null))
    expect(match('due < start of month')).toEqual(range(null, rel('end-of-last-month')))
    expect(match('due > end of month')).toEqual(range(rel('start-of-next-month'), null))
    expect(match('due < start of next month')).toEqual(range(null, rel('end-of-month')))
    expect(match('due > end of last month')).toEqual(range(rel('start-of-month'), null))
    expect(match('due <= end of month + 3')).toEqual(range(null, rel('end-of-month-plus-3')))
    // The older words step the same way.
    expect(match('due before start of week')).toEqual(range(null, rel('end-of-last-week')))
  })

  it('refuses < / > where the day past the anchor has no name', () => {
    expect(errorOf('due < start of last week')).toMatchObject({ message: 'Use <= with start of last week' })
    expect(errorOf('due > end of next week').message).toBe('Use >= with end of next week')
    expect(errorOf('due > end of month + 3').message).toBe('Use >= with end of month + 3')
    expect(errorOf('due < start of last month').message).toBe('Use <= with start of last month')
    expect(errorOf('due before start of last week').message).toBe('Use by with start of last week')
    expect(errorOf('due after end of next month').message).toBe('Use from with end of next month')
    const e = errorOf('due < start of last week')
    expect(e.hint).toBe('< is the day before it, which has no name here; <= includes the day')
    expect(e.at).toEqual([6, 24])
  })

  it('takes = with a period (the period), refuses the others with a hint', () => {
    expect(match('due = this week')).toEqual(match('due this week'))
    expect(match('created = last month')).toEqual(match('created last month'))
    expect(errorOf('due < this week')).toEqual({ message: 'Compare with a day, not this week', hint: 'As in due < start of week', at: [4, 15] })
    expect(errorOf('due <= next week').hint).toBe('As in due <= end of next week')
    expect(errorOf('created > last month').hint).toBe('As in created > end of last month')
    expect(errorOf('created >= this month').hint).toBe('As in created >= start of month')
    expect(errorOf('due by this week')).toMatchObject({ message: 'Compare with a day, not this week', hint: 'As in due by end of week' })
  })
})

describe('filter expressions — relative days', () => {
  it('reads +Nd / -Nd wherever a day goes', () => {
    expect(match('due +3d')).toEqual(range(off(3), off(3)))
    expect(match('due -3d')).toEqual(range(off(-3), off(-3)))
    expect(match('due +0d')).toEqual(range(rel('today'), rel('today')))
    expect(match('due -0d')).toEqual(range(rel('today'), rel('today')))
    expect(match('due +1d')).toEqual(range(rel('tomorrow'), rel('tomorrow')))
    expect(match('due -1D')).toEqual(range(rel('yesterday'), rel('yesterday')))
    expect(match('due -3d..+7d')).toEqual(range(off(-3), off(7)))
    expect(match('due +3d..11/30')).toEqual(range(off(3), fixed(2026, 11, 30)))
    expect(match('due by +7d')).toEqual(range(null, off(7)))
    expect(match('due <= +3660d')).toEqual(range(null, off(3660)))
  })

  it('refuses a number without its sign or its d', () => {
    expect(errorOf('due +3')).toMatchObject({ message: "Can't read “+3” as a day", hint: 'Days from today with their sign and d: +3d, -30d (up to 3660)' })
    expect(errorOf('due -30').message).toBe("Can't read “-30” as a day")
    expect(errorOf('due +3661d').message).toBe("Can't read “+3661d” as a day")
    expect(errorOf('due 3d').message).toBe("Can't read “3d”")
  })
})

describe('filter expressions — date printing', () => {
  it('prints an open-ended range as <= / >=, a relative day compact', () => {
    for (const [typed, printed] of [
      ['due <= +7d', 'due <= +7d'],
      ['due < +7d', 'due <= +6d'],
      ['followup >= +7d', 'followup >= +7d'],
      ['followup > +7d', 'followup >= +8d'],
      ['created <= -30d', 'created <= -30d'],
      ['created < -30d', 'created <= -31d'],
      ['modified >= -30d', 'modified >= -30d'],
      ['due <= fri', 'due <= 11/13/2026'],
      ['due > 11/30', 'due >= 12/1/2026'],
      ['due < start of week', 'due <= end of last week'],
      ['due >= start of next month', 'due >= start of next month'],
      ['due <= end of month + 3', 'due <= end of month + 3'],
      ['due +3d', 'due +3d'],
      ['created -30d', 'created -30d'],
      ['due -3d..+7d', 'due -3d..+7d'],
      ['due 11/1/2026..+30d', 'due 11/1/2026..+30d'],
    ] as const) {
      expect(canonical(typed)).toBe(printed)
      expect(canonical(printed)).toBe(printed)
    }
  })

  it('keeps the named forms', () => {
    expect(canonical('due < today')).toBe('overdue')
    expect(canonical('due <= yesterday')).toBe('overdue')
    expect(canonical('followup < today')).toBe('followup late')
    expect(canonical('followed < today')).toBe('followed <= yesterday')
    expect(canonical('due = today')).toBe('due today')
    expect(canonical('due +0d')).toBe('due today')
    expect(canonical('due = +1d')).toBe('due tomorrow')
    expect(canonical('due > today')).toBe('due >= tomorrow')
    expect(canonical('due = this week')).toBe('due this week')
    expect(canonical('due today..+7d')).toBe('due within 7 days')
    expect(canonical('created -7d..+0d')).toBe('created within last 7 days')
    expect(canonical('due -1d..+1d')).toBe('due yesterday..tomorrow')
  })

  it('prints a stored offset the Relative panel wrote, 0 and ±1 by name', () => {
    expect(print('modified', range(null, off(-30)))).toBe('modified <= -30d')
    expect(print('followup', range(off(7), null))).toBe('followup >= +7d')
    expect(print('deadline', range(off(0), off(0)))).toBe('due today')
    expect(print('deadline', range(null, off(1)))).toBe('due <= tomorrow')
    expect(print('created', range(off(-1), null))).toBe('created >= yesterday')
  })

  it('settles the older words in the new form', () => {
    for (const [typed, printed] of [
      ['due by fri', 'due <= 11/13/2026'],
      ['due before fri', 'due <= 11/12/2026'],
      ['due after 11/30', 'due >= 12/1/2026'],
      ['due from mon', 'due >= 11/9/2026'],
      ['followup from in 7 days', 'followup >= +7d'],
      ['due by in 7 days', 'due <= +7d'],
      ['modified from 30 days ago', 'modified >= -30d'],
      ['modified before 30 days ago', 'modified <= -31d'],
      ['due after 3 days ago', 'due >= -2d'],
      ['due in 3 days', 'due +3d'],
      ['created 3 days ago', 'created -3d'],
      ['due in 3 days..in 10 days', 'due +3d..+10d'],
      ['due 3 days ago..in 1 day', 'due -3d..tomorrow'],
      ['due from start of next week', 'due >= start of next week'],
    ] as const) {
      expect(canonical(typed)).toBe(printed)
    }
  })

  it('round-trips comparisons inside and / or / not', () => {
    for (const text of [
      '(due <= +7d or no due) and @Ben',
      'not followup >= +7d',
      'not (created <= -30d and modified <= -14d)',
      '@Aisha or followed <= -14d',
      'due -3d..+7d and done',
    ]) {
      expect(canonical(text)).toBe(text)
    }
  })
})

describe('filter expressions — comparison tokens', () => {
  it('reads a comparison with or without spaces', () => {
    expect(canonical('due<=+7d')).toBe('due <= +7d')
    expect(canonical('due>=fri')).toBe('due >= 11/13/2026')
    expect(canonical('(due<today)')).toBe('overdue')
    expect(canonical('due <=+7d and @Ben')).toBe('due <= +7d and @Ben')
    // A sign doesn't end a word (`follow-up` is a date word): `due-3d` is one word, text.
    expect(canonical('follow-up >= +7d')).toBe('followup >= +7d')
    expect(tree('due-3d')).toEqual({ kind: 'text', text: 'due-3d' })
  })

  it('keeps < > = and +Nd as text inside quotes, and a bare -3d in a phrase', () => {
    expect(tree('"a<b" and due <= +7d')).toEqual({
      kind: 'and',
      items: [{ kind: 'text', text: 'a<b' }, { kind: 'date', field: 'deadline', match: range(null, off(7)) }],
    })
    expect(tree('"x >= +3d"')).toEqual({ kind: 'text', text: 'x >= +3d' })
    expect(tree('budget -3d')).toEqual({ kind: 'text', text: 'budget -3d' })
    expect(tree('@Ben and budget +7d')).toEqual({ kind: 'and', items: [{ kind: 'person', id: 2 }, { kind: 'text', text: 'budget +7d' }] })
  })

  it('says a comparison goes after a date word', () => {
    expect(errorOf('<= +7d')).toEqual({ message: '<= goes after a date word', hint: 'As in due <= +7d — quote text that has one: "a<b"', at: [0, 2] })
    expect(errorOf('@Ben <= fri').message).toBe('<= goes after a date word')
    expect(errorOf('budget = 3').message).toBe('= goes after a date word')
    expect(errorOf('a<b').message).toBe('< goes after a date word')
    expect(errorOf('(due today) > fri').message).toBe('> goes after a date word')
  })

  it('says what is wrong with a comparison', () => {
    expect(errorOf('due <=').message).toBe('A day goes here')
    expect(errorOf('due >= +3d..+7d')).toMatchObject({ message: '>= takes one day', hint: 'As in due >= -3d — for a range: due -3d..+7d', at: [4, 12] })
    expect(errorOf('due == fri').message).toBe("Can't read “=” as a day")
    expect(errorOf('due => fri').message).toBe("Can't read “>” as a day")
    expect(errorOf('due != fri')).toMatchObject({ message: '!= isn’t a comparison', at: [4, 6] })
    expect(errorOf('due < any').message).toBe("Can't read “any”")
  })

  it('tints the whole comparison as the date term', () => {
    const r = parse('due <= +7d and @Ben')
    expect(r.spans).toEqual([
      { start: 0, end: 10, kind: 'due' },
      { start: 11, end: 14, kind: 'operator' },
      { start: 15, end: 19, kind: 'person' },
    ])
  })
})
