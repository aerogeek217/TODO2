import { describe, it, expect } from 'vitest'
import { emptyPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { copiedListParts, copySourceGroups, uniqueListName, withCopiedParts } from '../../utils/list-copy'

const def = (id: number, name: string, owner: PersistedListDefinition['owner'], sortOrder = id, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id, name, sortOrder, owner,
  membership: { kind: 'custom', predicate: emptyPredicate() },
  sort: 'manual', grouping: 'none',
  ...extra,
})

const layouts = [{ id: 1, name: 'Main' }, { id: 2, name: 'Second' }, { id: 3, name: 'Empty' }, { id: 4, name: 'Third' }]

describe('copySourceGroups', () => {
  const lists = [
    def(10, 'Second B', { layoutId: 2 }, 5),
    def(11, 'Main A', { layoutId: 1 }, 2),
    def(12, 'Third', { layoutId: 4 }),
    def(13, 'Main B', { layoutId: 1 }, 1),
    def(14, 'Second A', { layoutId: 2 }, 0),
    def(15, 'Eisenhower', { eisenhower: true }),
    def(16, 'Orphan', { layoutId: 99 }),
    def(17, 'No owner', undefined),
  ]

  it('this layout first, then the others in their order (empty ones left out), then the Eisenhower; lists by sort order', () => {
    const groups = copySourceGroups({ lists, layouts, openLayoutId: 2, eisenhowerListId: 15 })
    expect(groups.map((g) => [g.heading, g.lists.map((d) => d.name)])).toEqual([
      ['Second · this layout', ['Second A', 'Second B']],
      ['Main', ['Main B', 'Main A']],
      ['Third', ['Third']],
      ['Eisenhower', ['Eisenhower']],
    ])
    expect(groups.map((g) => g.key)).toEqual(['layout:2', 'layout:1', 'layout:4', 'eisenhower'])
  })

  it('leaves out the list being edited (its layout too when it was the only one); an Eisenhower list edited leaves no Eisenhower group', () => {
    expect(copySourceGroups({ lists, layouts, openLayoutId: 4, eisenhowerListId: 15, excludeId: 12 }).map((g) => g.heading))
      .toEqual(['Main', 'Second', 'Eisenhower'])
    expect(copySourceGroups({ lists, layouts, openLayoutId: 1, eisenhowerListId: 15, excludeId: 15 }).map((g) => g.heading))
      .toEqual(['Main · this layout', 'Second', 'Third'])
  })

  it('no open stored layout: every layout as another; the Eisenhower found without the setting', () => {
    expect(copySourceGroups({ lists, layouts, openLayoutId: undefined, eisenhowerListId: null }).map((g) => g.heading))
      .toEqual(['Main', 'Second', 'Third', 'Eisenhower'])
  })
})

describe('copied parts', () => {
  const source = def(1, 'Calls', { layoutId: 2 }, 3, {
    membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText: 'call', showCompleted: true } },
    sort: 'deadline', sortDirection: 'desc', grouping: 'status',
    runtimeFilter: { field: 'person' }, showFilterLine: false,
  })

  it('takes the filters (Show completed with them), group, sort + direction, prompt and filter line — never the name, owner or order', () => {
    const target = def(5, 'Mine', { layoutId: 1 }, 9, { sort: 'name', grouping: 'people' })
    const next = withCopiedParts(target, source)
    expect(next).toEqual({
      id: 5, name: 'Mine', sortOrder: 9, owner: { layoutId: 1 },
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText: 'call', showCompleted: true } },
      sort: 'deadline', sortDirection: 'desc', grouping: 'status',
      runtimeFilter: { field: 'person' }, showFilterLine: false,
    })
    // A copy, not the source's objects.
    expect(next.membership).not.toBe(source.membership)
    expect(next.runtimeFilter).not.toBe(source.runtimeFilter)
  })

  it('drops the target’s direction, prompt and hidden filter line when the source has none', () => {
    const target = def(5, 'Mine', { layoutId: 1 }, 9, { sort: 'created', sortDirection: 'desc', runtimeFilter: { field: 'tag' }, showFilterLine: false })
    const next = withCopiedParts(target, def(2, 'Plain', { layoutId: 1 }))
    expect(next).not.toHaveProperty('sortDirection')
    expect(next).not.toHaveProperty('runtimeFilter')
    expect(next).not.toHaveProperty('showFilterLine')
    expect(copiedListParts(def(2, 'Plain', { layoutId: 1 }))).toEqual({
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
    })
  })
})

describe('uniqueListName', () => {
  it('the name, else the first free `name N`, ignoring case', () => {
    expect(uniqueListName('Calls', ['Mine'])).toBe('Calls')
    expect(uniqueListName('Calls', ['calls', 'Calls 2', ' CALLS 3 '])).toBe('Calls 4')
  })
})
