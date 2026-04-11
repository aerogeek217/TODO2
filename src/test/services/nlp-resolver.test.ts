import { describe, it, expect } from 'vitest'
import { resolveInput } from '../../services/nlp-resolver'
import { parseInput } from '../../services/natural-language-parser'
import { Priority } from '../../models'
import type { Person, Tag, Project } from '../../models'

const people: Person[] = [
  { id: 1, name: 'John Smith', initials: 'JS', color: '#ff0000' },
  { id: 2, name: 'Sarah Connor', initials: 'SC', color: '#00ff00' },
  { id: 3, name: 'Mike', initials: 'M', color: '#0000ff' },
]

const tags: Tag[] = [
  { id: 10, name: 'shopping', color: '#aaa' },
  { id: 11, name: 'urgent', color: '#f00' },
  { id: 12, name: 'work', color: '#00f' },
]

const projects: Project[] = [
  { id: 100, name: 'Backend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
  { id: 101, name: 'Design System', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
  { id: 102, name: 'Frontend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: new Date() },
]

describe('nlp-resolver', () => {
  it('resolves exact person name match', () => {
    const parsed = parseInput('Task @Mike')
    const result = resolveInput(parsed, people, tags)
    expect(result.personIds).toEqual([3])
    expect(result.unmatchedPersons).toEqual([])
  })

  it('resolves person by first name', () => {
    const parsed = parseInput('Task @John')
    const result = resolveInput(parsed, people, tags)
    expect(result.personIds).toEqual([1])
  })

  it('resolves person by initials', () => {
    const parsed = parseInput('Task @SC')
    const result = resolveInput(parsed, people, tags)
    expect(result.personIds).toEqual([2])
  })

  it('resolves person by prefix', () => {
    const parsed = parseInput('Task @Sar')
    const result = resolveInput(parsed, people, tags)
    expect(result.personIds).toEqual([2])
  })

  it('reports unmatched person', () => {
    const parsed = parseInput('Task @Unknown')
    const result = resolveInput(parsed, people, tags)
    expect(result.personIds).toEqual([])
    expect(result.unmatchedPersons).toEqual(['Unknown'])
  })

  it('resolves exact tag name match', () => {
    const parsed = parseInput('Task #shopping')
    const result = resolveInput(parsed, people, tags)
    expect(result.tagIds).toEqual([10])
    expect(result.unmatchedTags).toEqual([])
  })

  it('resolves tag by prefix', () => {
    const parsed = parseInput('Task #urg')
    const result = resolveInput(parsed, people, tags)
    expect(result.tagIds).toEqual([11])
  })

  it('reports unmatched tag', () => {
    const parsed = parseInput('Task #nonexistent')
    const result = resolveInput(parsed, people, tags)
    expect(result.tagIds).toEqual([])
    expect(result.unmatchedTags).toEqual(['nonexistent'])
  })

  it('resolves multiple persons and tags', () => {
    const parsed = parseInput('Task @Mike @Sarah #shopping #urgent')
    const result = resolveInput(parsed, people, tags)
    expect(result.personIds).toEqual([3, 2])
    expect(result.tagIds).toEqual([10, 11])
  })

  it('deduplicates person IDs', () => {
    const parsed = parseInput('Task @Mike @Mike')
    const result = resolveInput(parsed, people, tags)
    expect(result.personIds).toEqual([3])
  })

  it('preserves priority and dueDate from parsed input', () => {
    const parsed = parseInput('Task p1 tomorrow')
    const result = resolveInput(parsed, people, tags)
    expect(result.priority).toBe(Priority.High)
    expect(result.dueDate).toBeDefined()
    expect(result.title).toBe('Task')
  })

  it('handles combined input with all token types', () => {
    const parsed = parseInput('Buy groceries tomorrow #shopping @John p1')
    const result = resolveInput(parsed, people, tags)
    expect(result.title).toBe('Buy groceries')
    expect(result.priority).toBe(Priority.High)
    expect(result.dueDate).toBeDefined()
    expect(result.personIds).toEqual([1])
    expect(result.tagIds).toEqual([10])
  })

  it('resolves exact project name match', () => {
    const parsed = parseInput('Fix bug /Backend')
    const result = resolveInput(parsed, people, tags, projects)
    expect(result.projectId).toBe(100)
    expect(result.unmatchedProjects).toEqual([])
  })

  it('resolves project by prefix', () => {
    const parsed = parseInput('Task /Des')
    const result = resolveInput(parsed, people, tags, projects)
    expect(result.projectId).toBe(101)
  })

  it('reports unmatched project', () => {
    const parsed = parseInput('Task /Unknown')
    const result = resolveInput(parsed, people, tags, projects)
    expect(result.projectId).toBeUndefined()
    expect(result.unmatchedProjects).toEqual(['Unknown'])
  })

  it('uses first matched project when multiple specified', () => {
    const parsed = parseInput('Task /Backend /Frontend')
    const result = resolveInput(parsed, people, tags, projects)
    expect(result.projectId).toBe(100)
  })

  it('resolves project alongside people and tags', () => {
    const parsed = parseInput('Fix bug /Backend @Mike #urgent p1')
    const result = resolveInput(parsed, people, tags, projects)
    expect(result.projectId).toBe(100)
    expect(result.personIds).toEqual([3])
    expect(result.tagIds).toEqual([11])
    expect(result.priority).toBe(Priority.High)
    expect(result.title).toBe('Fix bug')
  })
})
