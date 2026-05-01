import { describe, it, expect } from 'vitest'
import { parseInput } from '../../services/natural-language-parser'

describe('natural-language-parser', () => {
  it('extracts a plain title with no tokens', () => {
    const result = parseInput('Buy groceries')
    expect(result.title).toBe('Buy groceries')
    expect(result.tokens).toHaveLength(0)
    expect(result.scheduledDate).toBeUndefined()
  })

  it('extracts @person', () => {
    const result = parseInput('Review PR @Mike')
    expect(result.title).toBe('Review PR')
    expect(result.persons).toEqual(['Mike'])
    expect(result.tokens.find((t) => t.type === 'person')?.value).toBe('Mike')
  })

  it('extracts multiple @persons', () => {
    const result = parseInput('Review PR @Mike @Sarah')
    expect(result.title).toBe('Review PR')
    expect(result.persons).toEqual(['Mike', 'Sarah'])
  })

  it('extracts tomorrow as fuzzy scheduled token', () => {
    const result = parseInput('Submit report tomorrow')
    expect(result.title).toBe('Submit report')
    expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow' })
  })

  it('extracts today as fuzzy scheduled token', () => {
    const result = parseInput('Call dentist today')
    expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'today' })
  })

  it('parses a complex input with date + person', () => {
    const result = parseInput('Review PR tomorrow @Mike')
    expect(result.title).toBe('Review PR')
    expect(result.persons).toEqual(['Mike'])
    expect(result.scheduledDate).toBeDefined()
  })

  it('parses combined input: title + date + person', () => {
    const result = parseInput('Buy groceries tomorrow @john')
    expect(result.title).toBe('Buy groceries')
    expect(result.persons).toEqual(['john'])
    expect(result.scheduledDate).toBeDefined()
  })

  it('handles input with only tokens', () => {
    const result = parseInput('@Sarah tomorrow')
    expect(result.persons).toEqual(['Sarah'])
    expect(result.scheduledDate).toBeDefined()
  })

  it('handles empty input', () => {
    const result = parseInput('')
    expect(result.title).toBe('')
    expect(result.tokens).toHaveLength(0)
  })

  it('extracts day name as precise scheduled date', () => {
    const result = parseInput('Meeting friday')
    expect(result.title).toBe('Meeting')
    expect(result.scheduledDate).toBeDefined()
    expect(result.scheduledDate!.kind).toBe('date')
    if (result.scheduledDate!.kind === 'date') {
      expect(result.scheduledDate!.value.getDay()).toBe(5) // Friday
    }
  })

  it('extracts "next monday" as precise scheduled date', () => {
    const result = parseInput('Sprint planning next monday')
    expect(result.title).toBe('Sprint planning')
    expect(result.scheduledDate).toBeDefined()
    if (result.scheduledDate!.kind === 'date') {
      expect(result.scheduledDate!.value.getDay()).toBe(1)
    }
  })

  it('extracts /project', () => {
    const result = parseInput('Fix header /Design')
    expect(result.title).toBe('Fix header')
    expect(result.projects).toEqual(['Design'])
    expect(result.tokens.find((t) => t.type === 'project')?.value).toBe('Design')
  })

  it('extracts /project at start of input', () => {
    const result = parseInput('/Backend Fix the API')
    expect(result.title).toBe('Fix the API')
    expect(result.projects).toEqual(['Backend'])
  })

  it('does not match / in middle of word', () => {
    const result = parseInput('Review path/to/file')
    expect(result.projects).toEqual([])
    expect(result.title).toBe('Review path/to/file')
  })

  it('parses /project with other tokens', () => {
    const result = parseInput('Fix bug /Backend @Mike')
    expect(result.title).toBe('Fix bug')
    expect(result.projects).toEqual(['Backend'])
    expect(result.persons).toEqual(['Mike'])
  })

  // ─── Cross-type overlap detection ──────────────────────────────────────────

  it('person @friday is not also parsed as a date', () => {
    const result = parseInput('Ask @friday about the report')
    expect(result.persons).toEqual(['friday'])
    expect(result.scheduledDate).toBeUndefined()
    expect(result.tokens.filter(t => t.type === 'date')).toHaveLength(0)
  })

  it('project /tomorrow is not also parsed as a date', () => {
    const result = parseInput('Check /tomorrow tasks')
    expect(result.projects).toEqual(['tomorrow'])
    expect(result.scheduledDate).toBeUndefined()
    expect(result.tokens.filter(t => t.type === 'date')).toHaveLength(0)
  })

  it('person and separate date do not conflict when non-overlapping', () => {
    const result = parseInput('Ask @Mike about tomorrow')
    expect(result.persons).toEqual(['Mike'])
    expect(result.scheduledDate).toBeDefined()
  })

  it('bare day name on same day resolves to next week, not today', () => {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const todayName = dayNames[new Date().getDay()]
    const result = parseInput(`Task ${todayName}`)
    expect(result.scheduledDate).toBeDefined()
    if (result.scheduledDate!.kind === 'date') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today)
      expected.setDate(expected.getDate() + 7)
      expect(result.scheduledDate!.value.toDateString()).toBe(expected.toDateString())
    }
  })

  describe('deadline syntax', () => {
    function dateAtOffset(days: number): string {
      const t = new Date()
      t.setHours(0, 0, 0, 0)
      return new Date(t.getTime() + days * 24 * 60 * 60 * 1000).toDateString()
    }

    type DeadlineCase = {
      input: string
      title: string
      day?: number
      offsetDays?: number
    }

    const matches: DeadlineCase[] = [
      // `by` syntax
      { input: 'Submit report by friday', title: 'Submit report', day: 5 },
      { input: 'Call vendor by tomorrow', title: 'Call vendor', offsetDays: 1 },
      { input: 'Wrap up tasks by this week', title: 'Wrap up tasks' },
      // `!` syntax
      { input: 'Urgent task !tuesday', title: 'Urgent task', day: 2 },
      { input: 'Ship it !today', title: 'Ship it', offsetDays: 0 },
      // `due` syntax
      { input: 'Submit report due friday', title: 'Submit report', day: 5 },
      { input: 'Call vendor due tomorrow', title: 'Call vendor', offsetDays: 1 },
      { input: 'Ship feature due tmr', title: 'Ship feature', offsetDays: 1 },
      { input: 'Email client due today', title: 'Email client', offsetDays: 0 },
      { input: 'Wrap up tasks due this week', title: 'Wrap up tasks' },
      { input: 'Present plan due next monday', title: 'Present plan', day: 1 },
      { input: 'Followup due in 3 days', title: 'Followup', offsetDays: 3 },
    ]

    it.each(matches)('extracts deadline from "$input"', ({ input, title, day, offsetDays }) => {
      const result = parseInput(input)
      expect(result.title).toBe(title)
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.scheduledDate).toBeUndefined()
      if (day !== undefined) expect(result.dueDate!.getDay()).toBe(day)
      if (offsetDays !== undefined) {
        expect(result.dueDate!.toDateString()).toBe(dateAtOffset(offsetDays))
      }
    })

    const noMatches: Array<{ input: string; reason: string }> = [
      { input: 'Done by default', reason: '"by" followed by non-date words' },
      { input: 'Urgent!', reason: 'bare "!" without a date' },
      { input: 'Pay invoice due to vendor', reason: '"due" followed by non-date words' },
    ]

    it.each(noMatches)('does not extract deadline ($reason): "$input"', ({ input }) => {
      const result = parseInput(input)
      expect(result.title).toBe(input)
      expect(result.dueDate).toBeUndefined()
    })

    it('allows scheduled + "by <day>" deadline in one input', () => {
      const result = parseInput('Review tomorrow by friday')
      expect(result.title).toBe('Review')
      expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow' })
      expect(result.dueDate).toBeInstanceOf(Date)
    })

    it('allows scheduled + "due <day>" deadline in one input', () => {
      const result = parseInput('Review tomorrow due friday')
      expect(result.title).toBe('Review')
      expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow' })
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.dueDate!.getDay()).toBe(5)
    })

    it('does not extract "due" inside another word (overdue)', () => {
      const result = parseInput('Mark task overdue tomorrow')
      // "overdue" must not satisfy the `\bdue` boundary; the standalone
      // "tomorrow" then becomes a fuzzy scheduled token, not a deadline.
      expect(result.dueDate).toBeUndefined()
      expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow' })
    })

    it('only consumes "due monday" from "due monday at 5pm"', () => {
      const result = parseInput('Sync due monday at 5pm')
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.dueDate!.getDay()).toBe(1)
      expect(result.title).toBe('Sync at 5pm')
    })
  })

  describe('tags (#foo)', () => {
    type TagCase = { input: string; tags: string[]; title?: string }

    const cases: TagCase[] = [
      { input: '#foo bar', tags: ['foo'], title: 'bar' },
      { input: '/proj #foo bar', tags: ['foo'], title: 'bar' },
      { input: 'Do thing #Urgent', tags: ['Urgent'] },
      { input: 'ship #FooBar', tags: ['FooBar'] },
      // Dedupe case-variants by lowercase, first-seen case wins.
      { input: '#Foo work #foo more #FOO', tags: ['Foo'] },
      // Capture stops at the first non-slug char.
      { input: 'ship it #foo!', tags: ['foo'], title: 'ship it !' },
      { input: '#urgent ship it', tags: ['urgent'], title: 'ship it' },
      // word#tag is NOT a tag (requires whitespace before #).
      { input: 'email@work#followup today', tags: [] },
      { input: '#foo work #bar then #foo', tags: ['foo', 'bar'] },
      { input: '#alpha middle #beta end', tags: ['alpha', 'beta'], title: 'middle end' },
      { input: '#high-priority #v_2', tags: ['high-priority', 'v_2'] },
      { input: 'Plain title', tags: [] },
    ]

    it.each(cases)('parses tags from "$input"', ({ input, tags, title }) => {
      const result = parseInput(input)
      expect(result.tags).toEqual(tags)
      if (title !== undefined) expect(result.title).toBe(title)
    })

    it('captures #foo and emits a tag token', () => {
      const result = parseInput('#foo bar')
      expect(result.tokens.find((t) => t.type === 'tag')?.value).toBe('foo')
    })

    it('tag does not shadow date keyword elsewhere in the input', () => {
      // `#today` is a tag; a bare `today` after it is still a date.
      const result = parseInput('#today today')
      expect(result.tags).toEqual(['today'])
      expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'today' })
    })
  })
})
