import { describe, it, expect, vi } from 'vitest'
import { resolveInput, resolveTags, type TagStoreLike } from '../../services/nlp-resolver'
import { parseInput } from '../../services/natural-language-parser'
import { TagLimitError } from '../../stores/tag-store'
import type { Person, Project, Org, Tag } from '../../models'
import { DEFAULT_ENTITY_COLOR } from '../../constants'

function makeMockTagStore(initialTags: Tag[] = []): TagStoreLike & { nextId: number } {
  const tags: Tag[] = initialTags.map((t) => ({ ...t }))
  const store = {
    tags,
    nextId: Math.max(0, ...tags.map((t) => t.id ?? 0)) + 1,
    async add(name: string, color = DEFAULT_ENTITY_COLOR): Promise<number> {
      // Mirrors the real `tagStore.add` post-M1: idempotent, returns the
      // existing id on case-insensitive match instead of throwing.
      const lower = name.trim().toLowerCase()
      const existing = store.tags.find(
        (t) => t.name.trim().toLowerCase() === lower && t.id !== undefined,
      )
      if (existing?.id != null) return existing.id
      const id = store.nextId++
      store.tags.push({ id, name, color })
      return id
    },
  }
  return store
}

const people: Person[] = [
  { id: 1, name: 'John Smith', initials: 'JS' },
  { id: 2, name: 'Sarah Connor', initials: 'SC' },
  { id: 3, name: 'Mike', initials: 'M' },
]

const projects: Project[] = [
  { id: 100, name: 'Backend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: new Date() },
  { id: 101, name: 'Design System', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() },
  { id: 102, name: 'Frontend', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: new Date() },
]

describe('nlp-resolver', () => {
  type PersonCase = { input: string; personIds: number[]; unmatched?: string[] }

  const personCases: PersonCase[] = [
    { input: 'Task @Mike', personIds: [3] },           // exact name
    { input: 'Task @John', personIds: [1] },           // first name
    { input: 'Task @SC', personIds: [2] },             // initials
    { input: 'Task @Sar', personIds: [2] },            // prefix
    { input: 'Task @Mike @Sarah', personIds: [3, 2] }, // multiple
    { input: 'Task @Mike @Mike', personIds: [3] },     // dedupe
    { input: 'Task @Unknown', personIds: [], unmatched: ['Unknown'] },
  ]

  it.each(personCases)('resolves persons from "$input"', ({ input, personIds, unmatched = [] }) => {
    const parsed = parseInput(input)
    const result = resolveInput(parsed, people)
    expect(result.personIds).toEqual(personIds)
    expect(result.unmatchedPersons).toEqual(unmatched)
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

  type ProjectCase = { input: string; projectId?: number; unmatched?: string[] }

  const projectCases: ProjectCase[] = [
    { input: 'Fix bug /Backend', projectId: 100 },           // exact
    { input: 'Task /Des', projectId: 101 },                  // prefix
    { input: 'Task /Backend /Frontend', projectId: 100 },    // first-match
    { input: 'Task /Unknown', unmatched: ['Unknown'] },
  ]

  it.each(projectCases)('resolves projects from "$input"', ({ input, projectId, unmatched = [] }) => {
    const parsed = parseInput(input)
    const result = resolveInput(parsed, people, projects)
    expect(result.projectId).toBe(projectId)
    expect(result.unmatchedProjects).toEqual(unmatched)
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

describe('resolveTags', () => {
  it('returns the existing id for an exact-name match', async () => {
    const tagStore = makeMockTagStore([{ id: 7, name: 'urgent', color: '#fff' }])
    const ids = await resolveTags(['urgent'], { tagStore })
    expect(ids).toEqual([7])
    expect(tagStore.tags).toHaveLength(1)
  })

  it('matches existing tags case-insensitively (input differs)', async () => {
    const tagStore = makeMockTagStore([{ id: 7, name: 'urgent', color: '#fff' }])
    const ids = await resolveTags(['URGENT'], { tagStore })
    expect(ids).toEqual([7])
    expect(tagStore.tags).toHaveLength(1)
  })

  it('matches existing tags case-insensitively (registry preserves user casing)', async () => {
    const tagStore = makeMockTagStore([{ id: 7, name: 'Urgent', color: '#fff' }])
    const ids = await resolveTags(['urgent'], { tagStore })
    expect(ids).toEqual([7])
    expect(tagStore.tags).toHaveLength(1)
    expect(tagStore.tags[0]!.name).toBe('Urgent')
  })

  it('creates a new tag with DEFAULT_ENTITY_COLOR on miss', async () => {
    const tagStore = makeMockTagStore()
    const ids = await resolveTags(['newtag'], { tagStore })
    expect(ids).toHaveLength(1)
    expect(tagStore.tags).toHaveLength(1)
    expect(tagStore.tags[0]!.name).toBe('newtag')
    expect(tagStore.tags[0]!.color).toBe(DEFAULT_ENTITY_COLOR)
  })

  it('preserves user-supplied case when creating a new tag', async () => {
    const tagStore = makeMockTagStore()
    const ids = await resolveTags(['FooBar'], { tagStore })
    expect(ids).toHaveLength(1)
    expect(tagStore.tags).toHaveLength(1)
    expect(tagStore.tags[0]!.name).toBe('FooBar')
  })

  it('returns the existing id without creating when the registry has a case-folded match', async () => {
    const tagStore = makeMockTagStore([{ id: 9, name: 'foobar', color: '#fff' }])
    const ids = await resolveTags(['FooBar'], { tagStore })
    expect(ids).toEqual([9])
    expect(tagStore.tags).toHaveLength(1)
    expect(tagStore.tags[0]!.name).toBe('foobar')
  })

  it('returns ids in input order, mixed hits and misses', async () => {
    const tagStore = makeMockTagStore([{ id: 42, name: 'old', color: '#fff' }])
    const ids = await resolveTags(['new1', 'old', 'new2'], { tagStore })
    expect(ids).toHaveLength(3)
    expect(ids[1]).toBe(42)
    expect(ids[0]).not.toBe(42)
    expect(ids[2]).not.toBe(42)
    expect(ids[0]).not.toBe(ids[2])
  })

  it('dedupes repeat names within a single call', async () => {
    const tagStore = makeMockTagStore([{ id: 7, name: 'urgent', color: '#fff' }])
    const ids = await resolveTags(['urgent', 'urgent'], { tagStore })
    expect(ids).toEqual([7])
  })

  it('dedupes case-folded repeats that resolve to the same new tag', async () => {
    const tagStore = makeMockTagStore()
    const ids = await resolveTags(['Foo', 'foo', 'FOO'], { tagStore })
    expect(ids).toHaveLength(1)
    expect(tagStore.tags).toHaveLength(1)
  })

  it('skips empty and whitespace-only names', async () => {
    const tagStore = makeMockTagStore()
    const ids = await resolveTags(['', '   ', 'real'], { tagStore })
    expect(ids).toHaveLength(1)
    expect(tagStore.tags).toHaveLength(1)
    expect(tagStore.tags[0]!.name).toBe('real')
  })

  it('returns an empty array for an empty input', async () => {
    const tagStore = makeMockTagStore()
    const ids = await resolveTags([], { tagStore })
    expect(ids).toEqual([])
    expect(tagStore.tags).toHaveLength(0)
  })

  it('catches TagLimitError, surfaces via console.error, and returns ids resolved so far', async () => {
    const tagStore: TagStoreLike = {
      tags: [{ id: 1, name: 'existing', color: '#aaa' }],
      async add(): Promise<number> {
        throw new TagLimitError('Tag limit reached (1) — delete unused tags in Settings → Tags.')
      },
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // 'existing' resolves via lookup (no `add` call). 'neu' hits the limit
      // — loop should break and return [1] rather than throwing.
      const ids = await resolveTags(['existing', 'neu', 'alsofail'], { tagStore })
      expect(ids).toEqual([1])
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/tag limit/i))
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('rethrows non-TagLimitError errors from tag-store.add', async () => {
    const tagStore: TagStoreLike = {
      tags: [],
      async add(): Promise<number> {
        throw new Error('dexie write failed')
      },
    }
    await expect(resolveTags(['neu'], { tagStore })).rejects.toThrow(/dexie write failed/)
  })
})
