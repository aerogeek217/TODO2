import { describe, it, expect } from 'vitest'
import { resolveInput } from '../../services/nlp-resolver'
import { parseInput } from '../../services/natural-language-parser'
import type { Person, Project, Org } from '../../models'

const people: Person[] = [
  { id: 1, name: 'John Smith', initials: 'JS', color: '#ff0000' },
  { id: 2, name: 'Sarah Connor', initials: 'SC', color: '#00ff00' },
  { id: 3, name: 'Mike', initials: 'M', color: '#0000ff' },
]

const projects: Project[] = [
  { id: 100, name: 'Backend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
  { id: 101, name: 'Design System', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
  { id: 102, name: 'Frontend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: new Date() },
]

describe('nlp-resolver', () => {
  it('resolves exact person name match', () => {
    const parsed = parseInput('Task @Mike')
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual([3])
    expect(result.unmatchedPersons).toEqual([])
  })

  it('resolves person by first name', () => {
    const parsed = parseInput('Task @John')
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual([1])
  })

  it('resolves person by initials', () => {
    const parsed = parseInput('Task @SC')
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual([2])
  })

  it('resolves person by prefix', () => {
    const parsed = parseInput('Task @Sar')
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual([2])
  })

  it('reports unmatched person', () => {
    const parsed = parseInput('Task @Unknown')
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual([])
    expect(result.unmatchedPersons).toEqual(['Unknown'])
  })

  it('resolves multiple persons', () => {
    const parsed = parseInput('Task @Mike @Sarah')
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual([3, 2])
  })

  it('deduplicates person IDs', () => {
    const parsed = parseInput('Task @Mike @Mike')
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual([3])
  })

  it('preserves scheduledDate from parsed input', () => {
    const parsed = parseInput('Task tomorrow')
    const result = resolveInput(parsed, people)
    expect(result.scheduledDate).toBeDefined()
    expect(result.title).toBe('Task')
  })

  it('handles combined input with multiple token types', () => {
    const parsed = parseInput('Buy groceries tomorrow @John')
    const result = resolveInput(parsed, people)
    expect(result.title).toBe('Buy groceries')
    expect(result.scheduledDate).toBeDefined()
    expect(result.personIds).toEqual([1])
  })

  it('resolves exact project name match', () => {
    const parsed = parseInput('Fix bug /Backend')
    const result = resolveInput(parsed, people, projects)
    expect(result.projectId).toBe(100)
    expect(result.unmatchedProjects).toEqual([])
  })

  it('resolves project by prefix', () => {
    const parsed = parseInput('Task /Des')
    const result = resolveInput(parsed, people, projects)
    expect(result.projectId).toBe(101)
  })

  it('reports unmatched project', () => {
    const parsed = parseInput('Task /Unknown')
    const result = resolveInput(parsed, people, projects)
    expect(result.projectId).toBeUndefined()
    expect(result.unmatchedProjects).toEqual(['Unknown'])
  })

  it('uses first matched project when multiple specified', () => {
    const parsed = parseInput('Task /Backend /Frontend')
    const result = resolveInput(parsed, people, projects)
    expect(result.projectId).toBe(100)
  })

  it('resolves project alongside people', () => {
    const parsed = parseInput('Fix bug /Backend @Mike')
    const result = resolveInput(parsed, people, projects)
    expect(result.projectId).toBe(100)
    expect(result.personIds).toEqual([3])
    expect(result.title).toBe('Fix bug')
  })

  describe('org resolution', () => {
    const orgs: Org[] = [
      { id: 50, name: 'Acme Corp', initials: 'AC', color: '#ff0' },
      { id: 51, name: 'Globex', color: '#0ff' },
    ]

    it('resolves @name as org when no person matches', () => {
      const parsed = parseInput('Task @Acme')
      const result = resolveInput(parsed, people, projects, orgs)
      expect(result.orgIds).toEqual([50])
      expect(result.personIds).toEqual([])
      expect(result.unmatchedPersons).toEqual([])
    })

    it('resolves org by initials', () => {
      const parsed = parseInput('Task @AC')
      const result = resolveInput(parsed, people, projects, orgs)
      expect(result.orgIds).toEqual([50])
    })

    it('person takes priority over org with same name prefix', () => {
      const parsed = parseInput('Task @Mike')
      const result = resolveInput(parsed, people, projects, orgs)
      expect(result.personIds).toEqual([3])
      expect(result.orgIds).toEqual([])
    })

    it('resolves mixed people and orgs from @tokens', () => {
      const parsed = parseInput('Task @Mike @Globex')
      const result = resolveInput(parsed, people, projects, orgs)
      expect(result.personIds).toEqual([3])
      expect(result.orgIds).toEqual([51])
    })

    it('reports truly unmatched @tokens when no person or org matches', () => {
      const parsed = parseInput('Task @Unknown')
      const result = resolveInput(parsed, people, projects, orgs)
      expect(result.personIds).toEqual([])
      expect(result.orgIds).toEqual([])
      expect(result.unmatchedPersons).toEqual(['Unknown'])
    })

    it('returns empty orgIds when no orgs provided', () => {
      const parsed = parseInput('Task @Acme')
      const result = resolveInput(parsed, people, projects)
      expect(result.orgIds).toEqual([])
      expect(result.unmatchedPersons).toEqual(['Acme'])
    })
  })
})
