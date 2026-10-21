import { describe, it, expect, vi } from 'vitest'
import { resolveInput, resolveTags, resolveUnmatchedPeople, type TagStoreLike } from '../../services/nlp-resolver'
import { parseInput } from '../../services/natural-language-parser'
import { computeAutocomplete, personItems } from '../../services/nlp-autocomplete'
import type { Person, Status, Tag } from '../../models'
import { DEFAULT_ENTITY_COLOR } from '../../constants'

function makeMockTagStore(initialTags: Tag[] = []): TagStoreLike & { nextId: number } {
  const tags: Tag[] = initialTags.map((t) => ({ ...t }))
  const store = {
    tags,
    nextId: Math.max(0, ...tags.map((t) => t.id ?? 0)) + 1,
    async add(name: string, color = DEFAULT_ENTITY_COLOR): Promise<number> {
      // Mirrors the real `tagStore.add`: idempotent, returns the
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

  it('a typed name resolves to the person the @ popup shows first', () => {
    const crowd: Person[] = [
      { id: 10, name: 'Dkarl Berg', initials: 'DB' },
      { id: 11, name: 'Dana Kim', initials: 'DK' },
      { id: 12, name: 'Mikkel', initials: 'MI' },
      { id: 13, name: 'Jo Mike', initials: 'JM' },
    ]
    for (const name of ['dk', 'mik', 'ike', 'Dana']) {
      const view = computeAutocomplete(`x @${name}`, name.length + 3, {
        people: personItems(crowd), tags: [], statuses: [], commands: true, followupDefault: null, today: new Date(2026, 9, 10),
      })
      const first = view?.rows[0]
      const shown = first?.kind === 'entity' ? first.item.id : undefined
      expect(shown).toBeDefined()
      expect(resolveInput(parseInput(`x @${name}`), crowd).personIds).toEqual([shown])
    }
    // Initials beat a name merely starting with them; a substring still matches.
    expect(resolveInput(parseInput('x @dk'), crowd).personIds).toEqual([11])
    expect(resolveInput(parseInput('x @ike'), crowd).personIds).toEqual([13])
  })

  it('passes the commands through', () => {
    const parsed = parseInput('Buy groceries /due tomorrow /urgent /important /focus /followup 2w @John', new Date(2026, 9, 10))
    const result = resolveInput(parsed, people)
    expect(result).toMatchObject({
      title: 'Buy groceries',
      dueDate: new Date(2026, 9, 11),
      urgent: true,
      important: true,
      focus: true,
      nextFollowupAt: new Date(2026, 9, 24),
      personIds: [1],
      problems: [],
    })
    expect(result.followupNone).toBeUndefined()
  })

  it('a plain date word is title text', () => {
    const result = resolveInput(parseInput('Task tomorrow'), people)
    expect(result.dueDate).toBeUndefined()
    expect(result.title).toBe('Task tomorrow')
  })

  it('keeps a /word in the resolved title', () => {
    const parsed = parseInput('Fix bug /Backend @Mike')
    const result = resolveInput(parsed, people)
    expect(result.title).toBe('Fix bug /Backend')
    expect(result.personIds).toEqual([3])
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'unknown', raw: '/Backend' })])
  })

  it('textWithoutCommands drops the commands but keeps @ and # tokens', () => {
    const result = resolveInput(parseInput('Call @Mike /urgent about #q4 /due fri /urgnt'), people)
    expect(result.title).toBe('Call about /urgnt')
    expect(result.textWithoutCommands).toBe('Call @Mike about #q4 /urgnt')
  })
})

describe('nlp-resolver — /status', () => {
  const statuses: Status[] = [
    { id: 10, name: 'Doing', color: '#0af', sortOrder: 0 },
    { id: 11, name: 'Blocked', color: '#f00', sortOrder: 1 },
    { id: 12, name: 'In progress', color: '#0f0', sortOrder: 2 },
  ]

  it.each([
    ['/status doing', 10],
    ['/status Doing', 10],
    ['/status bl', 11],
    ['/status "In progress"', 12],
    ['/status in', 12],
  ] as const)('%s resolves', (cmd, id) => {
    const result = resolveInput(parseInput(`fix it ${cmd}`), people, statuses)
    expect(result.statusId).toBe(id)
    expect(result.title).toBe('fix it')
    expect(result.unmatchedStatuses).toEqual([])
  })

  it('an unknown name stays in the title and is reported', () => {
    const result = resolveInput(parseInput('fix it /status typo now'), people, statuses)
    expect(result.statusId).toBeUndefined()
    expect(result.title).toBe('fix it /status typo now')
    expect(result.textWithoutCommands).toBe('fix it /status typo now')
    expect(result.unmatchedStatuses).toEqual(['typo'])
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'unmatched', command: 'status', raw: '/status typo' })])
  })

  it('without a status registry every name is unknown', () => {
    const result = resolveInput(parseInput('fix it /status doing'), people)
    expect(result.statusId).toBeUndefined()
    expect(result.unmatchedStatuses).toEqual(['doing'])
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

  it('rethrows a failed tag-store.add', async () => {
    const tagStore: TagStoreLike = {
      tags: [],
      async add(): Promise<number> {
        throw new Error('dexie write failed')
      },
    }
    await expect(resolveTags(['neu'], { tagStore })).rejects.toThrow(/dexie write failed/)
  })
})

describe('resolveUnmatchedPeople', () => {
  function makePersonStore(existing: Person[] = []) {
    const people = [...existing]
    let nextId = 100
    const getOrCreate = vi.fn(async (name: string) => {
      const hit = people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
      if (hit?.id !== undefined) return hit.id
      const id = nextId++
      people.push({ id, name: name.trim(), initials: '' })
      return id
    })
    return { people, getOrCreate }
  }

  it('creates each new name and returns ids in input order', async () => {
    const personStore = makePersonStore()
    const ids = await resolveUnmatchedPeople(['Marco', 'Marco Rossi'], { personStore })
    expect(ids).toEqual([100, 101])
    expect(personStore.people.map((p) => p.name)).toEqual(['Marco', 'Marco Rossi'])
  })

  it('looks each name up case-insensitively before creating', async () => {
    const personStore = makePersonStore([{ id: 7, name: 'Dana Kim', initials: 'DK' }])
    const ids = await resolveUnmatchedPeople(['dana kim'], { personStore })
    expect(ids).toEqual([7])
    expect(personStore.people).toHaveLength(1)
  })

  it('dedupes names that differ only in case, and skips blanks', async () => {
    const personStore = makePersonStore()
    const ids = await resolveUnmatchedPeople(['marco', '  ', 'MARCO'], { personStore })
    expect(ids).toEqual([100])
    expect(personStore.getOrCreate).toHaveBeenCalledTimes(1)
  })
})
