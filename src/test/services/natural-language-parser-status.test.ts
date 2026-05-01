import { describe, it, expect } from 'vitest'
import { parseInput } from '../../services/natural-language-parser'
import { resolveInput } from '../../services/nlp-resolver'
import type { Person, Status } from '../../models'

const people: Person[] = []

const statuses: Status[] = [
  { id: 1, name: 'Doing', color: '#0af', sortOrder: 0 },
  { id: 2, name: 'Blocked', color: '#f33', sortOrder: 1 },
  { id: 3, name: 'Done', color: '#0c0', sortOrder: 2 },
]

describe('natural-language-parser — :status token', () => {
  type StatusCase = { input: string; statuses: string[]; title?: string }

  const cases: StatusCase[] = [
    { input: ':doing fix it', statuses: ['doing'], title: 'fix it' },
    { input: 'cleanup task :done', statuses: ['done'], title: 'cleanup task' },
    // No match: middle-of-word colon, post-word colon, leading-digit colon.
    { input: 'meeting at 12:30', statuses: [], title: 'meeting at 12:30' },
    { input: 'notes: thing', statuses: [], title: 'notes: thing' },
    { input: 'weird :123 input', statuses: [] },
    { input: ':doing first :blocked second', statuses: ['doing', 'blocked'], title: 'first second' },
    { input: ':in-progress :v_2 task', statuses: ['in-progress', 'v_2'], title: 'task' },
  ]

  it.each(cases)('parses statuses from "$input"', ({ input, statuses, title }) => {
    const result = parseInput(input)
    expect(result.statuses).toEqual(statuses)
    if (title !== undefined) expect(result.title).toBe(title)
  })

  it('captures :doing and emits a status token', () => {
    const result = parseInput(':doing fix it')
    expect(result.tokens.find((t) => t.type === 'status')?.value).toBe('doing')
  })

  it('captures :status mid-sentence (alongside other tokens)', () => {
    const result = parseInput('ship the thing :blocked tomorrow')
    expect(result.title).toBe('ship the thing')
    expect(result.statuses).toEqual(['blocked'])
    expect(result.scheduledDate).toBeDefined()
  })

  it('!<weekday> deadline syntax is unaffected by status pattern', () => {
    // The collision-avoidance contract: `!mon` must still parse as a deadline,
    // not get hijacked by the `:status` extraction.
    const result = parseInput('!mon fix it')
    expect(result.title).toBe('fix it')
    expect(result.dueDate).toBeInstanceOf(Date)
    expect(result.dueDate?.getDay()).toBe(1) // Monday
    expect(result.statuses).toEqual([])
  })

  it(':tomorrow is a status token, not a date (status precedence)', () => {
    // `:tomorrow` is unambiguously a status (a user named their status
    // "tomorrow" — unlikely but legal). The parser pushes status before date,
    // so dedup keeps the status token.
    const result = parseInput(':tomorrow ship it')
    expect(result.title).toBe('ship it')
    expect(result.statuses).toEqual(['tomorrow'])
    expect(result.scheduledDate).toBeUndefined()
  })
})

describe('nlp-resolver — :status resolution', () => {
  it('resolves :doing to status id via case-insensitive exact match', () => {
    const parsed = parseInput(':doing fix it')
    const result = resolveInput(parsed, people, [], [], statuses)
    expect(result.statusId).toBe(1)
    expect(result.unmatchedStatuses).toEqual([])
    expect(result.title).toBe('fix it')
  })

  it('resolves :Doing (different case) to the same status', () => {
    const parsed = parseInput(':Doing fix it')
    const result = resolveInput(parsed, people, [], [], statuses)
    expect(result.statusId).toBe(1)
  })

  it('resolves by prefix match (:bl → Blocked)', () => {
    const parsed = parseInput(':bl fix it')
    const result = resolveInput(parsed, people, [], [], statuses)
    expect(result.statusId).toBe(2)
  })

  it('reports unmatched status names in unmatchedStatuses', () => {
    const parsed = parseInput(':typo fix it')
    const result = resolveInput(parsed, people, [], [], statuses)
    expect(result.statusId).toBeUndefined()
    expect(result.unmatchedStatuses).toEqual(['typo'])
  })

  it('first matched status wins when multiple :tokens are present', () => {
    const parsed = parseInput(':doing :blocked fix it')
    const result = resolveInput(parsed, people, [], [], statuses)
    expect(result.statusId).toBe(1)
  })

  it('returns undefined statusId when no statuses are passed', () => {
    const parsed = parseInput(':doing fix it')
    const result = resolveInput(parsed, people)
    expect(result.statusId).toBeUndefined()
    expect(result.unmatchedStatuses).toEqual(['doing'])
  })
})
