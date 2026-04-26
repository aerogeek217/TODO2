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
  it('extracts :doing as a status token and strips it from the title', () => {
    const result = parseInput(':doing fix it')
    expect(result.title).toBe('fix it')
    expect(result.statuses).toEqual(['doing'])
    expect(result.tokens.find((t) => t.type === 'status')?.value).toBe('doing')
  })

  it('captures :status mid-sentence (alongside other tokens)', () => {
    const result = parseInput('ship the thing :blocked tomorrow')
    // `tomorrow` is also stripped (date keyword) — title only retains the
    // un-tokenized words. The point of the test is the status extraction in
    // a non-leading position with surrounding context.
    expect(result.title).toBe('ship the thing')
    expect(result.statuses).toEqual(['blocked'])
    expect(result.scheduledDate).toBeDefined()
  })

  it('captures :status at end of input', () => {
    const result = parseInput('cleanup task :done')
    expect(result.title).toBe('cleanup task')
    expect(result.statuses).toEqual(['done'])
  })

  it('does not match a colon in the middle of a word (12:30)', () => {
    const result = parseInput('meeting at 12:30')
    expect(result.statuses).toEqual([])
    expect(result.title).toBe('meeting at 12:30')
  })

  it('does not match a colon directly after a word (notes: thing)', () => {
    const result = parseInput('notes: thing')
    expect(result.statuses).toEqual([])
    expect(result.title).toBe('notes: thing')
  })

  it('does not match a colon followed by digits (:123)', () => {
    // STATUS_PATTERN requires a leading letter — `:123` is not a status.
    const result = parseInput('weird :123 input')
    expect(result.statuses).toEqual([])
  })

  it('captures multiple :status tokens preserving first-seen order', () => {
    const result = parseInput(':doing first :blocked second')
    expect(result.statuses).toEqual(['doing', 'blocked'])
    expect(result.title).toBe('first second')
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

  it('accepts hyphens and underscores in status slugs', () => {
    const result = parseInput(':in-progress :v_2 task')
    expect(result.statuses).toEqual(['in-progress', 'v_2'])
    expect(result.title).toBe('task')
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
