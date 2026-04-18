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

  it('extracts #tag', () => {
    const result = parseInput('Fix timeout #bugs')
    expect(result.title).toBe('Fix timeout')
    expect(result.tags).toEqual(['bugs'])
  })

  it('extracts multiple #tags', () => {
    const result = parseInput('Fix timeout #bugs #urgent')
    expect(result.title).toBe('Fix timeout')
    expect(result.tags).toEqual(['bugs', 'urgent'])
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

  it('parses a complex input with date + tag + person', () => {
    const result = parseInput('Review PR #142 tomorrow @Mike #bugs')
    expect(result.title).toBe('Review PR #142')
    expect(result.persons).toEqual(['Mike'])
    expect(result.tags).toEqual(['bugs'])
    expect(result.scheduledDate).toBeDefined()
  })

  it('parses combined input: title + date + tag + person', () => {
    const result = parseInput('Buy groceries tomorrow #shopping @john')
    expect(result.title).toBe('Buy groceries')
    expect(result.persons).toEqual(['john'])
    expect(result.tags).toEqual(['shopping'])
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

  it('preserves numeric # references in title', () => {
    const result = parseInput('Fix issue #42')
    expect(result.title).toBe('Fix issue #42')
    expect(result.tags).toEqual([])
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

  it('extracts #tag before /project without consuming the project', () => {
    const result = parseInput('Task #urgent /Backend')
    expect(result.tags).toEqual(['urgent'])
    expect(result.projects).toEqual(['Backend'])
    expect(result.title).toBe('Task')
  })

  it('does not consume subsequent words into tag name', () => {
    const result = parseInput('Task #bug fix the issue')
    expect(result.tags).toEqual(['bug'])
    expect(result.title).toBe('Task fix the issue')
  })

  it('extracts single-word tag followed by regular text', () => {
    const result = parseInput('Do something #urgent and then rest')
    expect(result.tags).toEqual(['urgent'])
    expect(result.title).toBe('Do something and then rest')
  })

  // ─── Cross-type overlap detection ──────────────────────────────────────────

  it('person @friday is not also parsed as a date', () => {
    const result = parseInput('Ask @friday about the report')
    expect(result.persons).toEqual(['friday'])
    expect(result.scheduledDate).toBeUndefined()
    expect(result.tokens.filter(t => t.type === 'date')).toHaveLength(0)
  })

  it('tag #monday is not also parsed as a date', () => {
    const result = parseInput('Review #monday items')
    expect(result.tags).toEqual(['monday'])
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
  })
})
