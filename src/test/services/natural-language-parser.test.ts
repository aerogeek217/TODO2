import { describe, it, expect } from 'vitest'
import { parseInput } from '../../services/natural-language-parser'
import { Priority } from '../../models'

describe('natural-language-parser', () => {
  it('extracts a plain title with no tokens', () => {
    const result = parseInput('Buy groceries')
    expect(result.title).toBe('Buy groceries')
    expect(result.tokens).toHaveLength(0)
    expect(result.priority).toBeUndefined()
  })

  it('extracts !high priority', () => {
    const result = parseInput('Fix login bug !high')
    expect(result.title).toBe('Fix login bug')
    expect(result.priority).toBe(Priority.High)
    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0].type).toBe('priority')
  })

  it('extracts !medium priority', () => {
    const result = parseInput('Review PR !medium')
    expect(result.priority).toBe(Priority.Medium)
  })

  it('extracts !med as medium priority', () => {
    const result = parseInput('Update docs !med')
    expect(result.priority).toBe(Priority.Medium)
  })

  it('extracts p1 as high priority', () => {
    const result = parseInput('Fix login bug p1')
    expect(result.title).toBe('Fix login bug')
    expect(result.priority).toBe(Priority.High)
  })

  it('extracts p2 as medium priority', () => {
    const result = parseInput('Review PR p2')
    expect(result.title).toBe('Review PR')
    expect(result.priority).toBe(Priority.Medium)
  })

  it('extracts p3 as normal priority', () => {
    const result = parseInput('Update docs p3')
    expect(result.title).toBe('Update docs')
    expect(result.priority).toBe(Priority.Normal)
  })

  it('does not match p1 inside a word', () => {
    const result = parseInput('Fix map1 rendering')
    expect(result.title).toBe('Fix map1 rendering')
    expect(result.priority).toBeUndefined()
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

  it('extracts tomorrow as date', () => {
    const result = parseInput('Submit report tomorrow')
    expect(result.title).toBe('Submit report')
    expect(result.dueDate).toBeDefined()
    const expected = new Date()
    expected.setDate(expected.getDate() + 1)
    expected.setHours(0, 0, 0, 0)
    expect(result.dueDate!.toDateString()).toBe(expected.toDateString())
  })

  it('extracts today as date', () => {
    const result = parseInput('Call dentist today')
    expect(result.dueDate).toBeDefined()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(result.dueDate!.toDateString()).toBe(today.toDateString())
  })

  it('parses a complex input with all token types', () => {
    const result = parseInput('Review PR #142 tomorrow !high @Mike #bugs')
    expect(result.title).toBe('Review PR #142')
    expect(result.priority).toBe(Priority.High)
    expect(result.persons).toEqual(['Mike'])
    expect(result.tags).toEqual(['bugs'])
    expect(result.dueDate).toBeDefined()
  })

  it('parses combined input: title + date + tag + person + priority', () => {
    const result = parseInput('Buy groceries tomorrow #shopping @john p1')
    expect(result.title).toBe('Buy groceries')
    expect(result.priority).toBe(Priority.High)
    expect(result.persons).toEqual(['john'])
    expect(result.tags).toEqual(['shopping'])
    expect(result.dueDate).toBeDefined()
  })

  it('handles input with only tokens', () => {
    const result = parseInput('!high @Sarah tomorrow')
    expect(result.priority).toBe(Priority.High)
    expect(result.persons).toEqual(['Sarah'])
    expect(result.dueDate).toBeDefined()
  })

  it('handles empty input', () => {
    const result = parseInput('')
    expect(result.title).toBe('')
    expect(result.tokens).toHaveLength(0)
  })

  it('extracts day name as date', () => {
    const result = parseInput('Meeting friday')
    expect(result.title).toBe('Meeting')
    expect(result.dueDate).toBeDefined()
    expect(result.dueDate!.getDay()).toBe(5) // Friday
  })

  it('extracts "next monday" as date', () => {
    const result = parseInput('Sprint planning next monday')
    expect(result.title).toBe('Sprint planning')
    expect(result.dueDate).toBeDefined()
    expect(result.dueDate!.getDay()).toBe(1) // Monday
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
    const result = parseInput('Fix bug /Backend @Mike p1')
    expect(result.title).toBe('Fix bug')
    expect(result.projects).toEqual(['Backend'])
    expect(result.persons).toEqual(['Mike'])
    expect(result.priority).toBe(Priority.High)
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

  it('bare day name on same day resolves to next week, not today', () => {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const todayName = dayNames[new Date().getDay()]
    const result = parseInput(`Task ${todayName}`)
    expect(result.dueDate).toBeDefined()
    // Should be 7 days from now, not today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expected = new Date(today)
    expected.setDate(expected.getDate() + 7)
    expect(result.dueDate!.toDateString()).toBe(expected.toDateString())
  })
})
