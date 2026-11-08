import { describe, it, expect } from 'vitest'
import {
  parseSearch,
  searchAutocomplete,
  searchTints,
  searchWords,
  takeTokens,
  type SearchSources,
} from '../../services/search-tokens'
import { personItems, statusItems, tagItems, type AutocompleteSources } from '../../services/nlp-autocomplete'
import { parseDatePhrase } from '../../utils/date-phrase'
import { fixedAnchor } from '../../utils/filter-criteria'
import type { Person, Status, Tag } from '../../models'

const today = new Date(2026, 9, 25)
const people: Person[] = [
  { id: 1, name: 'Aisha Rahman', initials: 'AR' },
  { id: 2, name: 'Kai Nakamura', initials: 'KN' },
]
const tags: Tag[] = [
  { id: 10, name: 'northwind', color: '#888' },
  { id: 11, name: 'q4', color: '#888' },
]
const statuses: Status[] = [
  { id: 20, name: 'Waiting', color: '#888', sortOrder: 0, icon: 'clock' },
  { id: 21, name: 'In progress', color: '#888', sortOrder: 1, icon: 'arrow' },
]
const sources: SearchSources = { people, tags, statuses, today }

const clausesOf = (text: string) => parseSearch(text, sources).tokens.map((t) => t.clause)
const rel = (token: string) => ({ kind: 'relative', token })

describe('search-tokens: the D16 spec table', () => {
  it('@aisha, and @ai (a prefix) → People', () => {
    expect(clausesOf('@aisha ')).toEqual([{ field: 'personIds', id: 1 }])
    expect(clausesOf('@ai ')).toEqual([{ field: 'personIds', id: 1 }])
  })

  it('several @ are one clause each (they OR in the People chip)', () => {
    expect(clausesOf('@aisha @kai ')).toEqual([{ field: 'personIds', id: 1 }, { field: 'personIds', id: 2 }])
  })

  it('#northwind → Tags; an unknown tag stays words', () => {
    expect(clausesOf('#northwind ')).toEqual([{ field: 'tags', id: 10 }])
    const p = parseSearch('#nope ', sources)
    expect(p.tokens).toEqual([])
    expect(p.names).toEqual([expect.objectContaining({ kind: 'tag', name: 'nope', unmatched: true })])
  })

  it('!waiting, !wa (a prefix) and !"In progress" → Status', () => {
    expect(clausesOf('!waiting ')).toEqual([{ field: 'statusIds', id: 20 }])
    expect(clausesOf('!wa ')).toEqual([{ field: 'statusIds', id: 20 }])
    expect(clausesOf('!"In progress" ')).toEqual([{ field: 'statusIds', id: 21 }])
  })

  // cr33 M12: a name holding `"`, typed as the autocomplete and the expression field write it.
  it('a quoted name with an escaped quote resolves', () => {
    const odd = { people: [...people, { id: 3, name: 'Ann "AJ" Lee', initials: 'AL' }], tags: [...tags, { id: 12, name: 'say "hi"', color: '#888' }], statuses: [...statuses, { id: 22, name: 'On "hold"', color: '#888', sortOrder: 2 }], today }
    expect(parseSearch('@"Ann \\"AJ\\" Lee" #"say \\"hi\\"" !"On \\"hold\\"" report', odd).tokens.map((t) => t.clause)).toEqual([
      { field: 'personIds', id: 3 },
      { field: 'tags', id: 12 },
      { field: 'statusIds', id: 22 },
    ])
  })

  it('several ! are one clause each (they OR in the Status chip)', () => {
    expect(clausesOf('!waiting !"In progress" ')).toEqual([
      { field: 'statusIds', id: 20 },
      { field: 'statusIds', id: 21 },
    ])
    expect(clausesOf('!a !b ')).toEqual([])
    expect(clausesOf('!in !wa ')).toEqual([
      { field: 'statusIds', id: 21 },
      { field: 'statusIds', id: 20 },
    ])
  })

  it('an unknown !name stays words: the "new" ring and its name in the text search', () => {
    const p = parseSearch('!nope report', sources)
    expect(p.tokens).toEqual([])
    expect(p.names).toEqual([expect.objectContaining({ kind: 'status', name: 'nope', unmatched: true, complete: true })])
    expect(searchTints(p)).toEqual([{ start: 0, end: 5, tint: 'new' }])
    expect(searchWords(p)).toBe('nope report')
  })

  it('/waiting and /status ⟨name⟩ are plain unknown text now', () => {
    for (const text of ['/waiting ', '/status waiting ']) {
      const p = parseSearch(text, sources)
      expect(p.tokens, text).toEqual([])
      expect(p.errors, text).toEqual([])
      expect(searchWords(p), text).toBe(text.trim())
    }
  })

  it('/urgent /important /focus → Priority; /hot is words', () => {
    expect(clausesOf('/urgent /important /focus ')).toEqual([
      { field: 'markers', marker: 'urgent' },
      { field: 'markers', marker: 'important' },
      { field: 'markers', marker: 'focus' },
    ])
  })

  it('overdue → Due before today', () => {
    expect(clausesOf('overdue ')).toEqual([{ field: 'deadline', match: { match: 'range', start: null, end: rel('yesterday') } }])
  })

  it('due today · due tomorrow · due fri · due 11/03 → Due that day', () => {
    expect(clausesOf('due today ')).toEqual([{ field: 'deadline', match: { match: 'range', start: rel('today'), end: rel('today') } }])
    expect(clausesOf('due tomorrow ')).toEqual([{ field: 'deadline', match: { match: 'range', start: rel('tomorrow'), end: rel('tomorrow') } }])
    const fri = fixedAnchor(parseDatePhrase('fri', today) as Date)
    expect(clausesOf('due fri ')).toEqual([{ field: 'deadline', match: { match: 'range', start: fri, end: fri } }])
    const nov3 = fixedAnchor(new Date(2026, 10, 3))
    expect(clausesOf('due 11/03 ')).toEqual([{ field: 'deadline', match: { match: 'range', start: nov3, end: nov3 } }])
  })

  it('due this week · next week · this month → the relative ranges', () => {
    expect(clausesOf('due this week ')).toEqual([{ field: 'deadline', match: { match: 'range', start: rel('today'), end: rel('end-of-week') } }])
    expect(clausesOf('due next week ')).toEqual([{ field: 'deadline', match: { match: 'range', start: rel('start-of-next-week'), end: rel('end-of-next-week') } }])
    expect(clausesOf('due this month ')).toEqual([{ field: 'deadline', match: { match: 'range', start: rel('today'), end: rel('end-of-month') } }])
  })

  it('due next fri reads the longest phrase', () => {
    const fri = fixedAnchor(parseDatePhrase('next fri', today) as Date)
    expect(clausesOf('due next fri ')).toEqual([{ field: 'deadline', match: { match: 'range', start: fri, end: fri } }])
  })

  it('followup today · followup late · followup this week → Follow-up', () => {
    expect(clausesOf('followup today ')).toEqual([{ field: 'followup', match: { match: 'range', start: rel('today'), end: rel('today') } }])
    expect(clausesOf('followup late ')).toEqual([{ field: 'followup', match: { match: 'range', start: null, end: rel('yesterday') } }])
    expect(clausesOf('follow-up this week ')).toEqual([{ field: 'followup', match: { match: 'range', start: rel('today'), end: rel('end-of-week') } }])
  })

  it('due late is not a phrase (late is the follow-up\'s)', () => {
    expect(clausesOf('due late ')).toEqual([])
  })

  it('no due · no followup → No date', () => {
    expect(clausesOf('no due ')).toEqual([{ field: 'deadline', match: { match: 'unset' } }])
    expect(clausesOf('no followup ')).toEqual([{ field: 'followup', match: { match: 'unset' } }])
  })

  it('done · completed → Show completed', () => {
    expect(clausesOf('done ')).toEqual([{ field: 'showCompleted' }])
    expect(clausesOf('completed ')).toEqual([{ field: 'showCompleted' }])
  })

  it('anything else is the text search', () => {
    const p = parseSearch('budget review', sources)
    expect(p.tokens).toEqual([])
    expect(searchWords(p)).toBe('budget review')
  })

  it('/due and /followup read as one day, /followup none as No date', () => {
    expect(clausesOf('/due today ')).toEqual([{ field: 'deadline', match: { match: 'range', start: rel('today'), end: rel('today') } }])
    expect(clausesOf('/followup none ')).toEqual([{ field: 'followup', match: { match: 'unset' } }])
  })
})

describe('search-tokens: completion and the box', () => {
  it('a token is complete once a space follows it', () => {
    expect(parseSearch('overdue', sources).tokens.map((t) => t.complete)).toEqual([false])
    expect(parseSearch('overdue ', sources).tokens.map((t) => t.complete)).toEqual([true])
  })

  it('a phrase still being typed is plain words', () => {
    expect(clausesOf('due ')).toEqual([])
    expect(clausesOf('due this ')).toEqual([])
    expect(clausesOf('no ')).toEqual([])
  })

  it('overdue #northwind budget → two chips and the word', () => {
    const p = parseSearch('overdue #northwind budget', sources)
    expect(p.tokens.map((t) => t.clause.field)).toEqual(['deadline', 'tags'])
    const box = takeTokens(p, p.text.length)
    expect(box.text).toBe('budget')
    expect(box.caret).toBe('budget'.length)
    expect(searchWords(p)).toBe('budget')
  })

  it('takeTokens leaves an incomplete token, unless ⏎ (all)', () => {
    const p = parseSearch('budget overdue', sources)
    expect(takeTokens(p, 14).text).toBe('budget overdue')
    expect(takeTokens(p, 14, true)).toMatchObject({ text: 'budget', taken: [expect.objectContaining({ raw: 'overdue' })] })
  })

  it('an unknown @name stays words: the "new" ring and its name in the text search', () => {
    const p = parseSearch('@nobody report', sources)
    expect(p.tokens).toEqual([])
    expect(p.names).toEqual([expect.objectContaining({ kind: 'person', name: 'nobody', unmatched: true, complete: true })])
    expect(searchTints(p)).toEqual([{ start: 0, end: 7, tint: 'new' }])
    expect(searchWords(p)).toBe('nobody report')
    expect(takeTokens(p, 14).text).toBe('@nobody report')
  })

  it('a token Esc kept as words is not a chip, and not "new"', () => {
    const p = parseSearch('@ai ', sources, ['@ai'])
    expect(p.tokens).toEqual([])
    expect(p.names).toEqual([expect.objectContaining({ name: 'ai', unmatched: false })])
    expect(searchTints(p)).toEqual([])
    const status = parseSearch('!wa ', sources, ['!wa'])
    expect(status.tokens).toEqual([])
    expect(status.names).toEqual([expect.objectContaining({ kind: 'status', name: 'wa', unmatched: false })])
    expect(searchWords(status)).toBe('wa')
  })

  it('takeTokens takes a complete ! token like @ / #', () => {
    const p = parseSearch('!wa budget', sources)
    expect(takeTokens(p, 10)).toMatchObject({ text: 'budget', taken: [expect.objectContaining({ raw: '!wa', clause: { field: 'statusIds', id: 20 } })] })
  })

  it('tints by what a token sets; the popup\'s token as being typed', () => {
    const p = parseSearch('overdue /urgent #q4 @ai', sources)
    expect(searchTints(p).map((s) => s.tint)).toEqual(['due', 'urgent', 'chip', 'chip'])
    expect(searchTints(p, { start: 20, end: 23 }).at(-1)).toEqual({ start: 20, end: 23, tint: 'chip' })
  })

  it('an unreadable command is an error tint and stays words', () => {
    const p = parseSearch('/due frday x', sources)
    expect(p.tokens).toEqual([])
    expect(searchTints(p)).toEqual([{ start: 0, end: 10, tint: 'error' }])
  })

  it('a lone trigger is left out of the text search', () => {
    expect(searchWords(parseSearch('budget @', sources))).toBe('budget')
    expect(searchWords(parseSearch('budget !', sources))).toBe('budget')
  })
})

describe('search-tokens: the popup', () => {
  const ac: AutocompleteSources = {
    people: personItems(people),
    tags: tagItems(tags),
    statuses: statusItems([...statuses, { id: 22, name: 'Urgent', color: '#888', sortOrder: 2 }]),
    commands: true,
    followupDefault: null,
    today,
  }

  it('lists people without a Create row', () => {
    const view = searchAutocomplete('@ai', 3, ac)
    expect(view?.rows.map((r) => r.kind)).toEqual(['entity', 'entity'])
    expect(searchAutocomplete('@zz', 3, ac)?.rows).toEqual([])
  })

  it('lists tags without a Create row', () => {
    expect(searchAutocomplete('#q', 2, ac)?.rows.map((r) => r.kind)).toEqual(['entity'])
  })

  it('/ lists the commands without /repeat — no status', () => {
    const view = searchAutocomplete('/', 1, ac)
    const labels = view?.rows.map((r) => (r.kind === 'command' ? `/${r.command.name}` : r.kind === 'value' ? r.label : r.kind))
    expect(labels).toEqual(['/focus', '/urgent', '/important', '/due', '/followup'])
    expect(searchAutocomplete('/wa', 3, ac)).toBeNull()
  })

  it('! lists the statuses (Settings order, prefix), no Create row', () => {
    const all = searchAutocomplete('!', 1, ac)
    expect(all).toMatchObject({ trigger: '!', mode: 'entity', header: 'Statuses' })
    expect(all?.rows.map((r) => (r.kind === 'entity' ? r.item.name : r.kind))).toEqual(['Waiting', 'In progress', 'Urgent'])
    const view = searchAutocomplete('x !in', 5, ac)
    expect(view?.rows.map((r) => (r.kind === 'entity' ? r.item.name : r.kind))).toEqual(['In progress'])
    expect(searchAutocomplete('!zz', 3, ac)?.rows).toEqual([])
  })

  it('/ho offers nothing', () => {
    expect(searchAutocomplete('x /ho', 5, ac)).toBeNull()
  })

  it('/status ⟨…⟩ opens nothing (no such command)', () => {
    expect(searchAutocomplete('/status w', 9, ac)).toBeNull()
  })
})
