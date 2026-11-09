import { describe, expect, it } from 'vitest'
import { expressionWords, parseExpression, type ExpressionNames } from '../../utils/filter-expression'

const PEOPLE = new Map([[1, 'Aisha'], [2, 'Ben']])
const TAGS = new Map([[1, 'q4'], [2, 'Ops']])
const STATUSES = new Map([[1, 'Waiting'], [2, 'Blocked']])

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

function read(text: string) {
  const r = parseExpression(text, { today: TODAY, names: { person: resolver(PEOPLE), tag: resolver(TAGS), status: resolver(STATUSES) } })
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`)
  if (!r.expression) throw new Error(`${text}: no expression`)
  return expressionWords(r.expression, names)
}

const words = (text: string) => read(text).text

describe('expressionWords — board BF', () => {
  it('reads the board’s examples', () => {
    expect(words('@Aisha or #q4 and not !Waiting')).toBe('Aisha, or #q4 but not Waiting')
    expect(words('followed by 7 days ago or never followed')).toBe('Last follow-up 7+ days ago, or never')
    expect(words('(@Aisha or @Ben) and not #Ops')).toBe('(Aisha or Ben) · not #Ops')
    expect(words('"invoice" and completed this month')).toBe('Mentions “invoice” · completed this month')
  })

  it('words a date as its Graphical chip does (where the board’s wording differs)', () => {
    // Board: `Next follow-up 7+ days away`, `due in the next 7 days`, `created in the last 14 days`.
    expect(words('followup from in 7 days')).toBe('Next follow-up 7+ days ahead')
    expect(words('/urgent and due within next 7 days')).toBe('Urgent · due within the next 7 days')
    expect(words('no person and created within last 14 days')).toBe('Unassigned · created within the last 14 days')
  })

  it('reads the board’s filter line', () => {
    expect(words('(@Aisha or (#q4 and not !Waiting)) and followed by 7 days ago')).toBe('(Aisha or #q4 but not Waiting) · last follow-up 7+ days ago')
  })
})

describe('expressionWords — structure', () => {
  it('joins top-level and terms with a dot, a not term reading “not x”', () => {
    expect(words('@Aisha and #q4 and not !Waiting')).toBe('Aisha · #q4 · not Waiting')
  })

  it('reads a lone not', () => {
    expect(words('not #Ops')).toBe('not #Ops')
    expect(words('not (@Aisha or @Ben)')).toBe('not (Aisha or Ben)')
    expect(words('not (@Aisha and #q4)')).toBe('not (Aisha and #q4)')
  })

  it('brackets an or inside an and inside an or', () => {
    expect(words('@Aisha or (#q4 and (!Waiting or !Blocked))')).toBe('Aisha, or #q4 and (Waiting or Blocked)')
  })

  it('puts an and’s not terms last, after but not', () => {
    expect(words('@Ben or (not !Waiting and #q4 and not !Blocked)')).toBe('Ben, or #q4 but not Waiting or Blocked')
    expect(words('@Ben or (not !Waiting and not !Blocked)')).toBe('Ben, or not Waiting and not Blocked')
  })

  it('reads none and any as words', () => {
    expect(words('no tag and any person and no status and any priority')).toBe('No tags · assigned · no status · has a priority')
    expect(words('no priority and any tag and any status')).toBe('No priority · has a tag · has a status')
  })

  it('reads the date shortcuts and Any / None', () => {
    expect(words('overdue and followup late')).toBe('Overdue · follow-up late')
    expect(words('due any and no followup and never followed')).toBe('Has a due date · no next follow-up · never followed up')
    expect(words('due by today or no due')).toBe('Due today or earlier, or none')
    expect(words('due this week')).toBe('Due this week')
    expect(words('not due within 3 days')).toBe('not due within the next 3 days')
  })

  it('folds a date and its none in a bracketed or', () => {
    expect(words('#q4 and (followed by 7 days ago or never followed or @Ben)')).toBe('#q4 · (last follow-up 7+ days ago, or never or Ben)')
  })

  it('splits pieces into name chips, words and joiners, each with its top-level term', () => {
    const r = read('(@Aisha or #q4) and not !Waiting and /urgent and "x"')
    expect(r.terms).toBe(4)
    expect(r.pieces.map((p) => [p.kind, p.text, p.term])).toEqual([
      ['joiner', '(', 0], ['name', 'Aisha', 0], ['joiner', 'or', 0], ['name', '#q4', 0], ['joiner', ')', 0],
      ['joiner', '·', 1], ['joiner', 'not', 1], ['name', 'Waiting', 1],
      ['joiner', '·', 2], ['name', 'Urgent', 2],
      ['joiner', '·', 3], ['word', 'mentions “x”', 3],
    ])
    expect(r.pieces.flatMap((p) => (p.kind === 'name' ? [p.name] : []))).toEqual(['person', 'tag', 'status', 'priority'])
  })

  it('names a deleted entity as the printer does', () => {
    const r = expressionWords({ kind: 'and', items: [{ kind: 'person', id: 9 }, { kind: 'tag', id: 9 }] }, names)
    expect(r.text).toBe('deleted person · #deleted tag')
  })

  it('counts one term for a non-and root', () => {
    expect(read('@Aisha or @Ben').terms).toBe(1)
  })
})
