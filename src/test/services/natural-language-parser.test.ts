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
    it('extracts "by <day>" as a deadline, not a scheduled date', () => {
      const result = parseInput('Submit report by friday')
      expect(result.title).toBe('Submit report')
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "by tomorrow" as a deadline', () => {
      const result = parseInput('Call vendor by tomorrow')
      expect(result.title).toBe('Call vendor')
      expect(result.dueDate).toBeInstanceOf(Date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today.getTime() + 24 * 60 * 60 * 1000)
      expect(result.dueDate!.toDateString()).toBe(expected.toDateString())
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "by this week" as a deadline (end-of-window date)', () => {
      const result = parseInput('Wrap up tasks by this week')
      expect(result.title).toBe('Wrap up tasks')
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "!<day>" as a deadline', () => {
      const result = parseInput('Urgent task !tuesday')
      expect(result.title).toBe('Urgent task')
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "!today" as a deadline', () => {
      const result = parseInput('Ship it !today')
      expect(result.title).toBe('Ship it')
      expect(result.dueDate).toBeInstanceOf(Date)
    })

    it('allows scheduled + deadline in one input', () => {
      const result = parseInput('Review tomorrow by friday')
      expect(result.title).toBe('Review')
      expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow' })
      expect(result.dueDate).toBeInstanceOf(Date)
    })

    it('does not match "by" followed by non-date words', () => {
      const result = parseInput('Done by default')
      expect(result.title).toBe('Done by default')
      expect(result.dueDate).toBeUndefined()
    })

    it('does not match bare "!" without a date', () => {
      const result = parseInput('Urgent!')
      expect(result.title).toBe('Urgent!')
      expect(result.dueDate).toBeUndefined()
    })

    it('extracts "due <day>" as a deadline, not a scheduled date', () => {
      const result = parseInput('Submit report due friday')
      expect(result.title).toBe('Submit report')
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.dueDate!.getDay()).toBe(5)
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "due tomorrow" as a deadline', () => {
      const result = parseInput('Call vendor due tomorrow')
      expect(result.title).toBe('Call vendor')
      expect(result.dueDate).toBeInstanceOf(Date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today.getTime() + 24 * 60 * 60 * 1000)
      expect(result.dueDate!.toDateString()).toBe(expected.toDateString())
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "due tmr" as a deadline', () => {
      const result = parseInput('Ship feature due tmr')
      expect(result.title).toBe('Ship feature')
      expect(result.dueDate).toBeInstanceOf(Date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today.getTime() + 24 * 60 * 60 * 1000)
      expect(result.dueDate!.toDateString()).toBe(expected.toDateString())
    })

    it('extracts "due today" as a deadline', () => {
      const result = parseInput('Email client due today')
      expect(result.title).toBe('Email client')
      expect(result.dueDate).toBeInstanceOf(Date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      expect(result.dueDate!.toDateString()).toBe(today.toDateString())
    })

    it('extracts "due this week" as a deadline (end-of-window date)', () => {
      const result = parseInput('Wrap up tasks due this week')
      expect(result.title).toBe('Wrap up tasks')
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "due next monday" as a deadline', () => {
      const result = parseInput('Present plan due next monday')
      expect(result.title).toBe('Present plan')
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.dueDate!.getDay()).toBe(1)
      expect(result.scheduledDate).toBeUndefined()
    })

    it('extracts "due in 3 days" as a deadline', () => {
      const result = parseInput('Followup due in 3 days')
      expect(result.title).toBe('Followup')
      expect(result.dueDate).toBeInstanceOf(Date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const expected = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000)
      expect(result.dueDate!.toDateString()).toBe(expected.toDateString())
    })

    it('allows scheduled + "due <day>" deadline in one input', () => {
      const result = parseInput('Review tomorrow due friday')
      expect(result.title).toBe('Review')
      expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'tomorrow' })
      expect(result.dueDate).toBeInstanceOf(Date)
      expect(result.dueDate!.getDay()).toBe(5)
    })

    it('does not match "due" followed by non-date words', () => {
      const result = parseInput('Pay invoice due to vendor')
      expect(result.title).toBe('Pay invoice due to vendor')
      expect(result.dueDate).toBeUndefined()
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
    it('captures #foo and leaves the rest of the title', () => {
      const result = parseInput('#foo bar')
      expect(result.title).toBe('bar')
      expect(result.tags).toEqual(['foo'])
      expect(result.tokens.find((t) => t.type === 'tag')?.value).toBe('foo')
    })

    it('captures /proj and #foo together', () => {
      const result = parseInput('/proj #foo bar')
      expect(result.title).toBe('bar')
      expect(result.projects).toEqual(['proj'])
      expect(result.tags).toEqual(['foo'])
    })

    it('preserves user-supplied case in the parsed tag', () => {
      const result = parseInput('Do thing #Urgent')
      expect(result.tags).toEqual(['Urgent'])
    })

    it('preserves mixed case (#FooBar → FooBar)', () => {
      const result = parseInput('ship #FooBar')
      expect(result.tags).toEqual(['FooBar'])
    })

    it('dedupes case-variant tags by lowercase, preserving first-seen case', () => {
      const result = parseInput('#Foo work #foo more #FOO')
      expect(result.tags).toEqual(['Foo'])
    })

    it('stops the capture at the first non-slug char (#foo! → foo)', () => {
      const result = parseInput('ship it #foo!')
      // The `!` is not a tag char, so only "foo" is captured. The leftover `!`
      // stays in the remaining title.
      expect(result.tags).toEqual(['foo'])
      expect(result.title).toBe('ship it !')
    })

    it('captures #tag at start of input', () => {
      const result = parseInput('#urgent ship it')
      expect(result.title).toBe('ship it')
      expect(result.tags).toEqual(['urgent'])
    })

    it('requires whitespace before # (word#tag is not a tag)', () => {
      const result = parseInput('email@work#followup today')
      expect(result.tags).toEqual([])
    })

    it('dedupes repeated tags in first-seen order', () => {
      const result = parseInput('#foo work #bar then #foo')
      expect(result.tags).toEqual(['foo', 'bar'])
    })

    it('captures multiple tags preserving first-seen order', () => {
      const result = parseInput('#alpha middle #beta end')
      expect(result.tags).toEqual(['alpha', 'beta'])
      expect(result.title).toBe('middle end')
    })

    it('accepts hyphens and underscores in tag slugs', () => {
      const result = parseInput('#high-priority #v_2')
      expect(result.tags).toEqual(['high-priority', 'v_2'])
    })

    it('tag does not shadow date keyword elsewhere in the input', () => {
      // `#today` is a tag; a bare `today` after it is still a date.
      const result = parseInput('#today today')
      expect(result.tags).toEqual(['today'])
      expect(result.scheduledDate).toEqual({ kind: 'fuzzy', token: 'today' })
    })

    it('empty tags array when no # tokens present', () => {
      const result = parseInput('Plain title')
      expect(result.tags).toEqual([])
    })
  })
})
