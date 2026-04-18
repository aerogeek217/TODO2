import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import type { ListDefinition } from '../../models/list-definition'
import type { TodoPredicate } from '../../models'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

function emptyPredicate(): TodoPredicate {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people',
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
  }
}

function makeDef(overrides: Partial<ListDefinition> = {}): ListDefinition {
  return {
    name: 'Custom',
    sortOrder: 0,
    pinnedToDashboard: true,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: { kind: 'effective-date-asc' },
    grouping: { kind: 'none' },
    ...overrides,
  }
}

describe('listDefinitionRepository', () => {
  it('getAll returns empty array on empty DB', async () => {
    const defs = await listDefinitionRepository.getAll()
    expect(defs).toHaveLength(0)
  })

  it('insert + getAll returns inserted rows', async () => {
    await listDefinitionRepository.insert(makeDef({ name: 'Upcoming', sortOrder: 1 }))
    const defs = await listDefinitionRepository.getAll()
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('Upcoming')
  })

  it('getAll returns rows ordered by sortOrder', async () => {
    await listDefinitionRepository.insert(makeDef({ name: 'Third', sortOrder: 3 }))
    await listDefinitionRepository.insert(makeDef({ name: 'First', sortOrder: 1 }))
    await listDefinitionRepository.insert(makeDef({ name: 'Second', sortOrder: 2 }))

    const defs = await listDefinitionRepository.getAll()
    expect(defs.map(d => d.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('update modifies fields', async () => {
    const id = await listDefinitionRepository.insert(makeDef({ name: 'Old' }))
    const existing = await listDefinitionRepository.getById(id)
    await listDefinitionRepository.update({ ...existing!, id, name: 'Renamed' } as ListDefinition & { id: number })

    const def = await listDefinitionRepository.getById(id)
    expect(def!.name).toBe('Renamed')
  })

  it('remove deletes the row', async () => {
    const id = await listDefinitionRepository.insert(makeDef())
    await listDefinitionRepository.remove(id)
    const defs = await listDefinitionRepository.getAll()
    expect(defs).toHaveLength(0)
  })

  it('reorder assigns monotonically increasing sortOrder to given id sequence', async () => {
    const id1 = await listDefinitionRepository.insert(makeDef({ name: 'A', sortOrder: 10 }))
    const id2 = await listDefinitionRepository.insert(makeDef({ name: 'B', sortOrder: 20 }))
    const id3 = await listDefinitionRepository.insert(makeDef({ name: 'C', sortOrder: 30 }))

    await listDefinitionRepository.reorder([id3, id1, id2])

    const defs = await listDefinitionRepository.getAll()
    expect(defs.map(d => d.name)).toEqual(['C', 'A', 'B'])
    expect(defs.map(d => d.sortOrder)).toEqual([0, 1, 2])
  })
})
