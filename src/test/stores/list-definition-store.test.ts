import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { useListDefinitionStore } from '../../stores/list-definition-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useListDefinitionStore.setState({ listDefinitions: [], loading: false, error: null })
})

describe('useListDefinitionStore', () => {
  it('load sets listDefinitions to [] when table is empty', async () => {
    await useListDefinitionStore.getState().load()
    expect(useListDefinitionStore.getState().listDefinitions).toEqual([])
    expect(useListDefinitionStore.getState().loading).toBe(false)
    expect(useListDefinitionStore.getState().error).toBeNull()
  })

  it('load reads rows ordered by sortOrder', async () => {
    await listDefinitionRepository.insert({
      name: 'B', sortOrder: 2,
      membership: { kind: 'upcoming' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'relative-effective' },
    })
    await listDefinitionRepository.insert({
      name: 'A', sortOrder: 1,
      membership: { kind: 'today' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'none' },
    })

    await useListDefinitionStore.getState().load()
    const names = useListDefinitionStore.getState().listDefinitions.map(d => d.name)
    expect(names).toEqual(['A', 'B'])
  })

  it('load clears loading flag when complete', async () => {
    const promise = useListDefinitionStore.getState().load()
    expect(useListDefinitionStore.getState().loading).toBe(true)
    await promise
    expect(useListDefinitionStore.getState().loading).toBe(false)
  })
})
