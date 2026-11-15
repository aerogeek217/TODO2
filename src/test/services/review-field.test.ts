import { describe, expect, it } from 'vitest'
import type { FilterExpr } from '../../models'
import type { AutocompleteItem, AutocompleteSources, AutocompleteView } from '../../services/nlp-autocomplete'
import { peopleOnly, reviewFieldAutocomplete, reviewFieldPick, withPick, type ReviewFieldCounts, type ReviewFieldText } from '../../services/review-field'
import { parseExpression, printExpression } from '../../utils/filter-expression'

/**
 * The Review widget's field (widget feedback 2A, board Review-field): the
 * whole list of people, tags and statuses on a click, bare letters matching
 * all three, picks joined as chips combine (one sort `or`, the sorts `and`),
 * and which filters name only people (the check-in buttons).
 */

const aisha: AutocompleteItem = { id: 1, name: 'Aisha', initials: 'A', kind: 'person', color: '#c8743a' }
const ben: AutocompleteItem = { id: 2, name: 'Ben', initials: 'B', kind: 'person' }
const marcus: AutocompleteItem = { id: 3, name: 'Marcus Chen', initials: 'MC', kind: 'person' }
const marco: AutocompleteItem = { id: 4, name: 'Marco Ruiz', initials: 'MR', kind: 'person' }
const atlas: AutocompleteItem = { id: 1, name: 'Project: Atlas', kind: 'tag' }
const marketing: AutocompleteItem = { id: 2, name: 'marketing', kind: 'tag' }
/** A tag the lists of this test don't offer (the field still reads it). */
const q4: AutocompleteItem = { id: 3, name: 'q4', kind: 'tag' }
const waiting: AutocompleteItem = { id: 1, name: 'Waiting', kind: 'status' }
const onHold: AutocompleteItem = { id: 2, name: 'On Hold', kind: 'status' }

const SOURCES: AutocompleteSources = {
  people: [aisha, ben, marcus, marco],
  tags: [atlas, marketing],
  statuses: [waiting, onHold],
  commands: true,
  followupDefault: null,
  today: new Date(2026, 10, 11),
}

const COUNTS: ReviewFieldCounts = {
  person: new Map([[1, 12], [2, 5], [3, 6], [4, 2]]),
  tag: new Map([[1, 9], [2, 4]]),
  status: new Map([[1, 4]]),
}

/** Whether a text reads: the words this test uses as whole terms. */
const reads = (text: string) => !/(\b(and|or|not|due)\s*$)|\($/i.test(text.trim())

function view(value: string, cursor = value.length, browse = false): AutocompleteView | null {
  return reviewFieldAutocomplete(value, cursor, SOURCES, { counts: COUNTS, browse, reads })
}

const names = (v: AutocompleteView | null) => v?.rows.map((r) => (r.kind === 'entity' ? `${r.section ? `${r.section}:` : ''}${r.item.name}${r.count != null ? ` ${r.count}` : ''}` : r.kind))

describe('reviewFieldAutocomplete', () => {
  it('a click on the empty field: people, tags and statuses under their headings, the most counted first', () => {
    const v = view('', 0, true)
    expect(v?.trigger).toBeNull()
    expect(v?.mixed).toBe(true)
    expect(v?.header).toBe('')
    expect(names(v)).toEqual([
      'People:Aisha 12', 'People:Marcus Chen 6', 'People:Ben 5', 'People:Marco Ruiz 2',
      'Tags:Project: Atlas 9', 'Tags:marketing 4',
      'Status:Waiting 4', 'Status:On Hold 0',
    ])
  })

  it('nothing typed and not clicked (a space typed): no list', () => {
    expect(view('')).toBeNull()
    expect(view('@Aisha ')).toBeNull()
  })

  it('the whole list where a term may go: after an operator, after a whole term, inside parentheses — not inside a word or after an unfinished one', () => {
    expect(view('@Aisha and ', 11, true)?.rows).toHaveLength(8)
    expect(view('@Aisha ', 7, true)?.rows).toHaveLength(8)
    expect(view('(', 1, true)?.rows).toHaveLength(8)
    expect(view('marketing', 3, true)).toBeNull()
    expect(view('due ', 4, true)).toBeNull()
  })

  it('bare letters match people, tags and statuses at once (no @ first), best first, with counts', () => {
    expect(names(view('mar'))).toEqual(['Marco Ruiz 2', 'Marcus Chen 6', 'marketing 4'])
    // A word start counts (Project: Atlas); a match only inside a word doesn't.
    expect(names(view('atl'))).toEqual(['Project: Atlas 9'])
    expect(view('isha')).toBeNull()
    // Never completed by typing on.
    expect(view('mar')?.rows.every((r) => r.kind === 'entity' && !r.resolves)).toBe(true)
  })

  it('bare letters after a whole term match too — but not while they could still be an operator', () => {
    expect(names(view('@Aisha or mar'))).toEqual(['Marco Ruiz 2', 'Marcus Chen 6', 'marketing 4'])
    expect(names(view('@Aisha mar'))).toEqual(['Marco Ruiz 2', 'Marcus Chen 6', 'marketing 4'])
    expect(view('@Aisha a')).toBeNull()
    expect(view('@Aisha an')).toBeNull()
    expect(view('@Aisha o')).toBeNull()
    expect(view('@Aisha no')).toBeNull()
  })

  it('a keyword, a date, a number lists nothing', () => {
    expect(view('overdue')).toBeNull()
    expect(view('due')).toBeNull()
    expect(view('due fri')).toBeNull()
    expect(view('11/30')).toBeNull()
  })

  it('@ # ! still open the expression field’s popup, its names with their counts', () => {
    const at = view('@m')
    expect(at?.trigger).toBe('@')
    expect(names(at)).toEqual(['Marco Ruiz 2', 'Marcus Chen 6'])
    expect(names(view('#'))).toEqual(['marketing 4', 'Project: Atlas 9'])
    expect(view('!wa')?.rows.map((r) => (r.kind === 'entity' ? r.item.name : r.kind))).toEqual(['Waiting'])
    expect(view('/ur')?.mode).toBe('command')
  })
})

/** The field's reading and printing over this test's names (the real parser and printer). */
const NAMED = [...SOURCES.people, ...SOURCES.tags, ...SOURCES.statuses, q4]
const idOf = (kind: AutocompleteItem['kind']) => (name: string) => NAMED.find((i) => i.kind === kind && i.name.toLowerCase() === name.toLowerCase())?.id
const nameOf = (kind: AutocompleteItem['kind']) => (id: number) => NAMED.find((i) => i.kind === kind && i.id === id)?.name
const TEXT: ReviewFieldText = {
  parse: (text) => parseExpression(text, { today: SOURCES.today, names: { person: idOf('person'), tag: idOf('tag'), status: idOf('status') } }),
  print: (expression, showCompleted) => printExpression(expression, showCompleted, { person: nameOf('person'), tag: nameOf('tag'), status: nameOf('status') }),
}
const pick = (value: string, from: number, to: number, item: AutocompleteItem) => reviewFieldPick(value, from, to, item, TEXT)
/** The filter a text reads as. */
const read = (text: string): FilterExpr | null => {
  const parse = TEXT.parse(text)
  return parse.ok ? parse.expression : null
}
const p = (id: number): FilterExpr => ({ kind: 'person', id })
const t = (id: number): FilterExpr => ({ kind: 'tag', id })

describe('reviewFieldPick', () => {
  it('into an empty field: the token and a space', () => {
    expect(pick('', 0, 0, aisha)).toEqual({ value: '@Aisha ', cursor: 7 })
  })

  it('a second pick of the same sort joins with or, a different sort with and', () => {
    expect(pick('@Aisha ', 7, 7, ben).value).toBe('@Aisha or @Ben ')
    expect(pick('@Aisha ', 7, 7, atlas).value).toBe('@Aisha and #"Project: Atlas" ')
    expect(pick('@Aisha', 6, 6, waiting).value).toBe('@Aisha and !Waiting ')
    // Bare letters typed after the term are replaced.
    expect(pick('@Aisha mar', 7, 10, marcus)).toEqual({ value: '@Aisha or @"Marcus Chen" ', cursor: 25 })
    // After a group of people, still or — one group.
    expect(pick('(@Aisha or @Ben) ', 17, 17, marco).value).toBe('@Aisha or @Ben or @"Marco Ruiz" ')
    // After a term that isn't a name: and.
    expect(pick('overdue ', 8, 8, aisha).value).toBe('overdue and @Aisha ')
  })

  it('picks combine as chips do — the names of one sort or together, the sorts and (F1)', () => {
    // Aisha, Ben, then a tag: the tag narrows both people's tasks.
    const third = pick('@Aisha or @Ben ', 15, 15, q4)
    expect(third.value).toBe('(@Aisha or @Ben) and #q4 ')
    expect(third.cursor).toBe(third.value.length)
    expect(read(third.value)).toEqual({ kind: 'and', items: [{ kind: 'or', items: [p(1), p(2)] }, t(3)] })
    // Aisha, a tag, then another tag: the tags join each other, not the whole filter.
    const tags = pick('@Aisha and #q4 ', 15, 15, marketing)
    expect(tags.value).toBe('@Aisha and (#q4 or #marketing) ')
    expect(read(tags.value)).toEqual({ kind: 'and', items: [p(1), { kind: 'or', items: [t(3), t(2)] }] })
    // A person after a tag joins the people already picked.
    expect(pick('@Aisha and #q4 ', 15, 15, ben).value).toBe('(@Aisha or @Ben) and #q4 ')
    // A fourth pick joins its own sort's group, wherever that stands.
    expect(pick('(@Aisha or @Ben) and #q4 ', 25, 25, marco).value).toBe('(@Aisha or @Ben or @"Marco Ruiz") and #q4 ')
    // One picked already stays once.
    expect(pick('(@Aisha or @Ben) and #q4 ', 25, 25, ben).value).toBe('(@Aisha or @Ben) and #q4 ')
    // A name under `not` is not a pick: a pick of its sort is one more condition.
    expect(pick('not @Aisha ', 11, 11, ben).value).toBe('not @Aisha and @Ben ')
  })

  it('after an operator or a parenthesis: no joining word', () => {
    expect(pick('@Aisha or mar', 10, 13, marcus).value).toBe('@Aisha or @"Marcus Chen" ')
    expect(pick('@Aisha and ', 11, 11, onHold).value).toBe('@Aisha and !"On Hold" ')
    expect(pick('(', 1, 1, ben).value).toBe('(@Ben ')
  })

  it('in the middle of the text: the pick joins the whole filter the same way', () => {
    const mid = pick('@Aisha  and #q4', 7, 7, ben)
    expect(mid).toEqual({ value: '(@Aisha or @Ben) and #q4 ', cursor: 25 })
    expect(read(mid.value)).toEqual({ kind: 'and', items: [{ kind: 'or', items: [p(1), p(2)] }, t(3)] })
  })

  it('after a whole term in a text that doesn’t read yet: the token joined by a word, the rest kept', () => {
    expect(pick('@Aisha  and (', 7, 7, ben)).toEqual({ value: '@Aisha or @Ben and (', cursor: 15 })
    expect(pick('@Aisha  and (', 7, 7, q4).value).toBe('@Aisha and #q4 and (')
  })
})

describe('withPick', () => {
  it('joins the picks of its sort among the top-level terms, else ANDs with the whole filter', () => {
    expect(withPick(p(1), { kind: 'person', id: 2 })).toEqual({ kind: 'or', items: [p(1), p(2)] })
    expect(withPick(p(1), { kind: 'tag', id: 3 })).toEqual({ kind: 'and', items: [p(1), t(3)] })
    expect(withPick({ kind: 'or', items: [p(1), t(3)] }, { kind: 'person', id: 2 }))
      .toEqual({ kind: 'and', items: [{ kind: 'or', items: [p(1), t(3)] }, p(2)] })
    // The "none" choice is a pick of its sort too (Unassigned or Ben).
    expect(withPick(p(0), { kind: 'person', id: 2 })).toEqual({ kind: 'or', items: [p(0), p(2)] })
  })
})

describe('peopleOnly', () => {
  it('one person, or several joined by or', () => {
    expect(peopleOnly(p(1))).toEqual([1])
    expect(peopleOnly({ kind: 'or', items: [p(1), p(2), p(1)] })).toEqual([1, 2])
  })

  it('anything else: null', () => {
    expect(peopleOnly(null)).toBeNull()
    expect(peopleOnly(p(0))).toBeNull()
    expect(peopleOnly({ kind: 'and', items: [p(1), { kind: 'tag', id: 2 }] })).toBeNull()
    expect(peopleOnly({ kind: 'or', items: [p(1), { kind: 'status', id: 2 }] })).toBeNull()
    expect(peopleOnly({ kind: 'not', item: p(1) })).toBeNull()
  })
})
