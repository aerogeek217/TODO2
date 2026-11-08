import { describe, expect, it } from 'vitest'
import type { FilterExpr } from '../../models/filter-expression'
import { emptyFilterClauses, type FilterClauses } from '../../models/filter-predicate'
import {
  clausesToExpression,
  expressionToClauses,
  normalizeExpression,
  parseExpression,
  printExpression,
  splitTopLevel,
  type ExpressionNames,
  type ExpressionParse,
} from '../../utils/filter-expression'
import { expressionResolver } from '../../services/filter-expression-field'
import { makePerson } from '../helpers'

const PEOPLE = new Map([[1, 'Aisha'], [2, 'Ben'], [3, 'Ann Lee']])
const TAGS = new Map([[1, 'q4'], [2, 'R&D']])
const STATUSES = new Map([[1, 'Assigned'], [2, 'Waiting'], [3, 'On Hold']])

function resolver(map: Map<number, string>) {
  return (name: string) => [...map].find(([, n]) => n.toLowerCase() === name.toLowerCase())?.[0]
}

const names: ExpressionNames = {
  person: (id) => PEOPLE.get(id),
  tag: (id) => TAGS.get(id),
  status: (id) => STATUSES.get(id),
}

// Friday 6 Nov 2026.
const TODAY = new Date(2026, 10, 6)

function parse(text: string, allowPeople = true): ExpressionParse {
  return parseExpression(text, {
    today: TODAY,
    names: { person: resolver(PEOPLE), tag: resolver(TAGS), status: resolver(STATUSES) },
    allowPeople,
  })
}

function tree(text: string): FilterExpr | null {
  const r = parse(text)
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`)
  return r.expression
}

function errorOf(text: string): string {
  const r = parse(text)
  if (r.ok) throw new Error(`${text} parsed`)
  return r.error.message
}

/** Parse then print: the canonical form. */
function canonical(text: string): string {
  const r = parse(text)
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`)
  return printExpression(r.expression, r.showCompleted, names)
}

const rel = (token: string) => ({ kind: 'relative', token })
const fixed = (y: number, m: number, d: number) => ({ kind: 'fixed', iso: new Date(y, m - 1, d).toISOString() })

describe('filter expressions — parse', () => {
  it('reads the user’s rule', () => {
    expect(tree('(/focus or (/important and /urgent)) and not (!Assigned and followup any)')).toEqual({
      kind: 'and',
      items: [
        { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'and', items: [{ kind: 'priority', value: 'important' }, { kind: 'priority', value: 'urgent' }] }] },
        { kind: 'not', item: { kind: 'and', items: [{ kind: 'status', id: 1 }, { kind: 'date', field: 'followup', match: { match: 'set' } }] } },
      ],
    })
  })

  it('binds not, then and, then or', () => {
    expect(tree('/focus or /urgent and @Aisha')).toEqual({
      kind: 'or',
      items: [{ kind: 'priority', value: 'focus' }, { kind: 'and', items: [{ kind: 'priority', value: 'urgent' }, { kind: 'person', id: 1 }] }],
    })
    expect(tree('not @Aisha and @Ben')).toEqual({ kind: 'and', items: [{ kind: 'not', item: { kind: 'person', id: 1 } }, { kind: 'person', id: 2 }] })
  })

  it('reads names bare and quoted, any case', () => {
    expect(tree('@"ann lee" or #"R&D" or !"On Hold" or #Q4')).toEqual({
      kind: 'or',
      items: [{ kind: 'person', id: 3 }, { kind: 'tag', id: 2 }, { kind: 'status', id: 3 }, { kind: 'tag', id: 1 }],
    })
  })

  it('reads text: quoted, or bare words side by side as one phrase', () => {
    expect(tree('"budget review"')).toEqual({ kind: 'text', text: 'budget review' })
    expect(tree('budget review')).toEqual({ kind: 'text', text: 'budget review' })
    expect(tree('"due friday" and not "draft"')).toEqual({
      kind: 'and', items: [{ kind: 'text', text: 'due friday' }, { kind: 'not', item: { kind: 'text', text: 'draft' } }],
    })
    // A phrase stops at a keyword.
    expect(tree('budget this week and @Ben')).toEqual({ kind: 'and', items: [{ kind: 'text', text: 'budget this week' }, { kind: 'person', id: 2 }] })
  })

  it('reads none / any', () => {
    expect(tree('no person and no tag and no status and no priority')).toEqual({
      kind: 'and',
      items: [{ kind: 'person', id: 0 }, { kind: 'tag', id: 0 }, { kind: 'status', id: 0 }, { kind: 'priority', value: 'none' }],
    })
    expect(tree('any person')).toEqual({ kind: 'not', item: { kind: 'person', id: 0 } })
    expect(tree('any priority')).toEqual({ kind: 'not', item: { kind: 'priority', value: 'none' } })
  })

  it('reads the date types with any / none', () => {
    expect(tree('due any')).toEqual({ kind: 'date', field: 'deadline', match: { match: 'set' } })
    expect(tree('no due')).toEqual({ kind: 'date', field: 'deadline', match: { match: 'unset' } })
    expect(tree('due none')).toEqual({ kind: 'date', field: 'deadline', match: { match: 'unset' } })
    expect(tree('no follow-up')).toEqual({ kind: 'date', field: 'followup', match: { match: 'unset' } })
    expect(tree('followed any')).toEqual({ kind: 'date', field: 'lastFollowup', match: { match: 'set' } })
    expect(tree('never followed')).toEqual({ kind: 'date', field: 'lastFollowup', match: { match: 'unset' } })
    expect(tree('overdue')).toEqual({ kind: 'date', field: 'deadline', match: { match: 'range', start: null, end: rel('yesterday') } })
    expect(tree('followup late')).toEqual({ kind: 'date', field: 'followup', match: { match: 'range', start: null, end: rel('yesterday') } })
  })

  it('reads days, periods, before / by / after / from, ranges and within', () => {
    const due = (text: string) => (tree(`due ${text}`) as { match: unknown }).match
    expect(due('today')).toEqual({ match: 'range', start: rel('today'), end: rel('today') })
    expect(due('fri')).toEqual({ match: 'range', start: fixed(2026, 11, 13), end: fixed(2026, 11, 13) })
    expect(due('11/30')).toEqual({ match: 'range', start: fixed(2026, 11, 30), end: fixed(2026, 11, 30) })
    expect(due('in 3 days')).toEqual({ match: 'range', start: { kind: 'offset', days: 3 }, end: { kind: 'offset', days: 3 } })
    expect(due('this week')).toEqual({ match: 'range', start: rel('today'), end: rel('end-of-week') })
    expect(due('last month')).toEqual({ match: 'range', start: rel('start-of-last-month'), end: rel('end-of-last-month') })
    expect(due('before fri')).toEqual({ match: 'range', start: null, end: fixed(2026, 11, 12) })
    expect(due('by fri')).toEqual({ match: 'range', start: null, end: fixed(2026, 11, 13) })
    expect(due('after today')).toEqual({ match: 'range', start: rel('tomorrow'), end: null })
    expect(due('from start of next week')).toEqual({ match: 'range', start: rel('start-of-next-week'), end: null })
    expect(due('11/1..11/30')).toEqual({ match: 'range', start: fixed(2026, 11, 1), end: fixed(2026, 11, 30) })
    expect(due('within 3 days')).toEqual({ match: 'range', start: rel('today'), end: { kind: 'offset', days: 3 } })
    expect(due('end of month + 3')).toEqual({ match: 'range', start: rel('end-of-month-plus-3'), end: rel('end-of-month-plus-3') })
    // A look-back date's "this week" runs to today.
    expect((tree('modified this week') as { match: unknown }).match).toEqual({ match: 'range', start: rel('start-of-week'), end: rel('today') })
    expect((tree('created within last 7 days') as { match: unknown }).match)
      .toEqual({ match: 'range', start: { kind: 'offset', days: -7 }, end: rel('today') })
    expect((tree('modified before 30 days ago') as { match: unknown }).match).toEqual({ match: 'range', start: null, end: { kind: 'offset', days: -31 } })
  })

  it('rolls a year-less day forward on the dates that look ahead; a weekday is the last one on those that look back (cr33 Answer 12)', () => {
    const match = (text: string) => (tree(text) as { match: unknown }).match
    const day = (y: number, m: number, d: number) => ({ match: 'range', start: fixed(y, m, d), end: fixed(y, m, d) })
    // Friday 6 Nov 2026: 11/1 and 1/5 are past this year.
    expect(match('due 11/1')).toEqual(day(2027, 11, 1))
    expect(match('due 1/5')).toEqual(day(2027, 1, 5))
    expect(match('followup by 1/5')).toEqual({ match: 'range', start: null, end: fixed(2027, 1, 5) })
    expect(match('due 11/6')).toEqual(day(2026, 11, 6))
    // A look-back date keeps this year's.
    expect(match('created 1/5')).toEqual(day(2026, 1, 5))
    expect(match('completed 11/1')).toEqual(day(2026, 11, 1))
    // A range of two year-less days is read as one.
    expect(match('due 12/20..1/5')).toEqual({ match: 'range', start: fixed(2026, 12, 20), end: fixed(2027, 1, 5) })
    expect(match('due 11/1..11/5')).toEqual({ match: 'range', start: fixed(2027, 11, 1), end: fixed(2027, 11, 5) })
    expect(match('created 12/20..1/5')).toEqual({ match: 'range', start: fixed(2025, 12, 20), end: fixed(2026, 1, 5) })
    // A weekday: the next on Due / Next follow-up, the last on the others (never today).
    expect(match('due fri')).toEqual(day(2026, 11, 13))
    expect(match('followup mon')).toEqual(day(2026, 11, 9))
    expect(match('created fri')).toEqual(day(2026, 10, 30))
    expect(match('followed mon')).toEqual(day(2026, 11, 2))
    expect(match('modified by thursday')).toEqual({ match: 'range', start: null, end: fixed(2026, 11, 5) })
    expect(match('completed from wed')).toEqual({ match: 'range', start: fixed(2026, 11, 4), end: null })
    // next fri is the next one on every date.
    expect(match('created next fri')).toEqual(day(2026, 11, 13))
  })

  it('makes a top-level done Show completed', () => {
    const r = parse('@Ben and done')
    expect(r.ok && r.expression).toEqual({ kind: 'person', id: 2 })
    expect(r.ok && r.showCompleted).toBe(true)
    const only = parse('done')
    expect(only.ok && only.expression).toBeNull()
    expect(only.ok && only.showCompleted).toBe(true)
  })

  it('says what is wrong, and where', () => {
    expect(errorOf('(/focus or /important')).toBe('Missing )')
    expect(errorOf('@Zed or #q4')).toBe('No person named Zed')
    expect(errorOf('due frday and not !Waiting')).toBe("Can't read “frday”")
    expect(errorOf('@Aisha @Ben')).toBe('Add and / or before “@Ben”')
    expect(errorOf('@Aisha budget')).toBe('Add and / or before “budget”')
    expect(errorOf('/focus or')).toBe('“or” needs something after it')
    expect(errorOf('/hot')).toBe('Unknown /hot')
    expect(errorOf('/focus or done')).toBe('done goes at the top level')
    expect(errorOf('"open')).toBe('Missing closing "')
    expect(errorOf('created any')).toBe('Every task has a created date')
    expect(errorOf('no')).toBe('no what?')
    const r = parse('@Zed or #q4')
    expect(!r.ok && [r.error.start, r.error.end]).toEqual([0, 4])
  })

  it('refuses a text that nests too deep with an error, never a RangeError (cr33 S3)', () => {
    expect(errorOf(`${'('.repeat(5000)}#q4${')'.repeat(5000)}`)).toBe('This nests too deep')
    expect(errorOf(`${'not '.repeat(3000)}#q4`)).toBe('This nests too deep')
    // Parentheses the normal form folds away are fine while they don't nest that deep.
    expect(tree(`${'('.repeat(40)}#q4${')'.repeat(40)}`)).toEqual({ kind: 'tag', id: 1 })
  })

  it('refuses people where a filter can’t name them', () => {
    const r = parse('@Aisha', false)
    expect(!r.ok && r.error.message).toBe('Leave people out')
  })

  it('tints what it read', () => {
    const r = parse('/focus and @Ben and due today')
    expect(r.spans.map((s) => s.kind)).toEqual(['focus', 'operator', 'person', 'operator', 'due'])
  })
})

describe('filter expressions — print', () => {
  it('writes the canonical form, which reads back the same', () => {
    for (const text of [
      '(/focus or (/important and /urgent)) and not (!Assigned and followup any)',
      '@Aisha or @"Ann Lee"',
      '#q4 and #"R&D"',
      '"budget review" and not "draft"',
      'no person or any tag',
      'no priority and any priority',
      'due today and followup late and overdue',
      'due this week or no due',
      'modified this week',
      'created within last 7 days',
      'due within 3 days',
      'due by 11/13/2026',
      'due from start of next week',
      'due 11/1/2026..11/30/2026',
      'never followed or followed any',
      'completed last month',
      '(@Aisha or @Ben) and done',
    ]) {
      expect(canonical(text)).toBe(text)
      expect(canonical(canonical(text))).toBe(text)
    }
  })

  it('quotes bare words and spells out aliases', () => {
    expect(canonical('budget review and @ben')).toBe('"budget review" and @Ben')
    expect(canonical('due fri')).toBe('due 11/13/2026')
    expect(canonical('due tmr or no follow-up')).toBe('due tomorrow or no followup')
    expect(canonical('not not @Ben')).toBe('@Ben')
  })

  it('escapes a " in a name or a text, so it reads back as itself (cr33 M12)', () => {
    // The real resolver, as the field uses it.
    const people = [makePerson({ id: 1, name: 'Ann "AJ" Lee' }), makePerson({ id: 2, name: 'C:\\docs\\' })]
    const tags = [{ id: 1, name: 'say "hi"', color: '#f00' }, { id: 2, name: 'back\\"slash', color: '#f00' }]
    const statuses = [{ id: 1, name: 'On "Hold"', color: '#888', sortOrder: 1, icon: 'circle' as const }]
    const realNames: ExpressionNames = {
      person: (id) => people.find((p) => p.id === id)?.name,
      tag: (id) => tags.find((t) => t.id === id)?.name,
      status: (id) => statuses.find((s) => s.id === id)?.name,
    }
    const opts = { today: TODAY, names: expressionResolver(people, tags, statuses) }
    const e: FilterExpr = { kind: 'and', items: [
      { kind: 'person', id: 1 },
      { kind: 'or', items: [{ kind: 'person', id: 2 }, { kind: 'tag', id: 1 }, { kind: 'tag', id: 2 }] },
      { kind: 'status', id: 1 },
      { kind: 'text', text: 'say "hi" \\ there' },
    ] }
    const text = printExpression(e, false, realNames)
    expect(text).toBe('@"Ann \\"AJ\\" Lee" and (@"C:\\docs\\\\" or #"say \\"hi\\"" or #"back\\\\\\"slash") and !"On \\"Hold\\"" and "say \\"hi\\" \\ there"')
    const read = parseExpression(text, opts)
    if (!read.ok) throw new Error(read.error.message)
    expect(read.expression).toEqual(e)
    expect(printExpression(read.expression, false, realNames)).toBe(text)
  })

  it('names a deleted id so it reads as an error until fixed', () => {
    expect(printExpression({ kind: 'person', id: 99 }, false, names)).toBe('@"deleted person"')
  })
})

describe('filter expressions — Graphical ↔ expression', () => {
  const clauses = (c: Partial<FilterClauses>): FilterClauses => ({ ...emptyFilterClauses(), ...c })

  it('turns chips into the expression that filters the same', () => {
    const e = clausesToExpression(clauses({
      markers: [{ values: ['focus', 'important'] }],
      statusIds: [2, 3],
      negate: { statusIds: true },
      personIds: [1],
      searchText: 'budget',
      dates: {
        deadline: { match: 'range', start: rel('today') as never, end: rel('end-of-week') as never, includeNoDate: true },
        lastFollowup: { match: 'range', start: { kind: 'offset', days: -7 }, end: rel('today') as never, not: true },
      },
    }))
    expect(printExpression(e, false, names)).toBe(
      '(/focus or /important) and @Aisha and (due this week or no due) and not followed within last 7 days and not (!Waiting or !"On Hold") and "budget"',
    )
  })

  it('reads a plain and of chips back as chips', () => {
    const before = clauses({
      markers: [{ values: ['urgent'], not: true }],
      tags: [1, 0],
      dates: { followup: { match: 'set' }, deadline: { match: 'range', start: null, end: rel('yesterday') as never, includeNoDate: true } },
      searchText: 'plan',
    })
    expect(expressionToClauses(clausesToExpression(before))).toEqual(before)
  })

  it('keeps or / not across fields out of the chips', () => {
    const e = tree('(/focus or (/important and /urgent)) and not (!Assigned and followup any) and #q4 and not @Ben')
    expect(expressionToClauses(e)).toBeNull()
    const split = splitTopLevel(e)
    expect(split.clauses.tags).toEqual([1])
    expect(split.clauses.personIds).toEqual([2])
    expect(split.clauses.negate).toEqual({ personIds: true })
    expect(split.rest).toHaveLength(2)
  })

  it('takes one chip per field (Priority repeats); a second goes to the rest', () => {
    const split = splitTopLevel(tree('@Aisha and @Ben'))
    expect(split.clauses.personIds).toEqual([1])
    expect(split.rest).toEqual([{ kind: 'person', id: 2 }])
    expect(expressionToClauses(tree('@Aisha and @Ben'))).toBeNull()
    expect(expressionToClauses(tree('/urgent and /important'))?.markers).toEqual([{ values: ['urgent'] }, { values: ['important'] }])
  })

  it('normalises nested and / or and double not', () => {
    expect(normalizeExpression({ kind: 'and', items: [{ kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 2 }] }, { kind: 'not', item: { kind: 'not', item: { kind: 'tag', id: 1 } } }] }))
      .toEqual({ kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 2 }, { kind: 'tag', id: 1 }] })
  })
})
