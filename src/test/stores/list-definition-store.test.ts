import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import { buildList } from '../../services/build-list'
import type { PersistedTodoItem, TodoPredicate } from '../../models'
import { makeTodo, matchesFilterNow as matchesFilter } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useListDefinitionStore.setState({ listDefinitions: [] })
  useUndoStore.setState({ undoStack: [], redoStack: [] } as never)
})

describe('useListDefinitionStore load', () => {
  it('load sets listDefinitions to [] when table is empty', async () => {
    await useListDefinitionStore.getState().load()
    expect(useListDefinitionStore.getState().listDefinitions).toEqual([])
    expect(useListDefinitionStore.getState().loaded).toBe(true)
  })

  it('load reads rows ordered by sortOrder', async () => {
    await listDefinitionRepository.insert({
      name: 'B', sortOrder: 2,
      membership: { kind: 'custom', predicate: emptyPredicate() },
      sort: 'deadline',
      grouping: 'deadline',
    })
    await listDefinitionRepository.insert({
      name: 'A', sortOrder: 1,
      membership: { kind: 'custom', predicate: emptyPredicate() },
      sort: 'deadline',
      grouping: 'none',
    })

    await useListDefinitionStore.getState().load()
    const names = useListDefinitionStore.getState().listDefinitions.map(d => d.name)
    expect(names).toEqual(['A', 'B'])
  })
})

describe('useListDefinitionStore mutations', () => {
  it('add inserts a custom list with sort-order appended and persists', async () => {
    const id = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'My list' })
    expect(id).toBeGreaterThan(0)
    const defs = useListDefinitionStore.getState().listDefinitions
    expect(defs).toHaveLength(1)
    expect(defs[0]).toMatchObject({
      id,
      name: 'My list',
      sortOrder: 0,
      membership: { kind: 'custom' },
      sort: 'manual',
      grouping: 'none',
    })

    // Survives reload
    useListDefinitionStore.setState({ listDefinitions: [] })
    await useListDefinitionStore.getState().load()
    expect(useListDefinitionStore.getState().listDefinitions).toHaveLength(1)
  })

  it('add assigns incrementing sortOrder', async () => {
    await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'A' })
    await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'B' })
    await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'C' })
    const sorted = [...useListDefinitionStore.getState().listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    expect(sorted.map(d => d.name)).toEqual(['A', 'B', 'C'])
    expect(sorted.map(d => d.sortOrder)).toEqual([0, 1, 2])
  })

  it('a blank list starts with Settings’ new-list sort, direction and grouping; a given sort / grouping and the Eisenhower’s list don’t', async () => {
    useSettingsStore.setState({ newListSort: 'deadline', newListSortDirection: 'desc', newListGroup: 'people' })
    const blank = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'Blank' })
    // A copy passes its source's definition.
    const copy = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'Copy', sort: 'name', grouping: 'none' })
    const copyDesc = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'Copy ↓', sort: 'created', sortDirection: 'desc', grouping: 'tag' })
    const eisenhower = await useListDefinitionStore.getState().add({ owner: { eisenhower: true }, name: 'Eisenhower' })
    const stored = new Map((await db.listDefinitions.toArray()).map((d) => [d.id, d]))
    expect(stored.get(blank)).toMatchObject({ sort: 'deadline', sortDirection: 'desc', grouping: 'people' })
    expect(stored.get(copy)).toMatchObject({ sort: 'name', grouping: 'none' })
    expect(stored.get(copy)).not.toHaveProperty('sortDirection')
    expect(stored.get(copyDesc)).toMatchObject({ sort: 'created', sortDirection: 'desc', grouping: 'tag' })
    expect(stored.get(eisenhower)).toMatchObject({ sort: 'manual', grouping: 'none' })
    expect(stored.get(eisenhower)).not.toHaveProperty('sortDirection')

    // A default sort without a direction stores none.
    useSettingsStore.setState({ newListSort: 'people', newListSortDirection: 'asc', newListGroup: 'none' })
    const byPeople = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'People' })
    expect(useListDefinitionStore.getState().listDefinitions.find((d) => d.id === byPeople)).toMatchObject({ sort: 'people', grouping: 'none' })
    expect(useListDefinitionStore.getState().listDefinitions.find((d) => d.id === byPeople)).not.toHaveProperty('sortDirection')
  })
})

describe('a copy (`ranksFrom`)', () => {
  it('stores the parts it is given — prompt and hidden filter line too — and the source’s manual order, in memory and on disk', async () => {
    useSettingsStore.setState({ newListSort: 'deadline', newListSortDirection: 'desc', newListGroup: 'people' })
    const source = await useListDefinitionStore.getState().add({ owner: { layoutId: 2 }, name: 'Calls', sort: 'manual', grouping: 'none' })
    await db.listOrders.bulkAdd([
      { listDefinitionId: source, todoId: 5, rank: 2000 },
      { listDefinitionId: source, todoId: 6, rank: 1000 },
      { listDefinitionId: 99, todoId: 5, rank: 7 },
    ])
    const id = await useListDefinitionStore.getState().add({
      owner: { layoutId: 1 }, name: 'Calls', ranksFrom: source,
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText: 'call' } },
      sort: 'manual', grouping: 'none', runtimeFilter: { field: 'tag' }, showFilterLine: false,
    })
    expect(await db.listDefinitions.get(id)).toMatchObject({
      name: 'Calls', owner: { layoutId: 1 }, sort: 'manual', grouping: 'none',
      runtimeFilter: { field: 'tag' }, showFilterLine: false,
      membership: { predicate: { searchText: 'call' } },
    })
    const ranks = (await db.listOrders.where('listDefinitionId').equals(id).toArray()).map((r) => [r.todoId, r.rank])
    expect(ranks.sort()).toEqual([[5, 2000], [6, 1000]])
    expect([...(useListOrderStore.getState().ranks.get(id) ?? [])].sort()).toEqual([[5, 2000], [6, 1000]])
    // The source keeps its own.
    expect(await db.listOrders.where('listDefinitionId').equals(source).count()).toBe(2)
  })

  it('a source with no manual order: the copy has none', async () => {
    const source = await useListDefinitionStore.getState().add({ owner: { layoutId: 2 }, name: 'Plain' })
    const id = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name: 'Plain', ranksFrom: source, sort: 'name', grouping: 'none' })
    expect(await db.listOrders.where('listDefinitionId').equals(id).count()).toBe(0)
    expect(useListOrderStore.getState().ranks.has(id)).toBe(false)
  })
})

describe('Save-as-preset round-trip', () => {
  it('persists a custom predicate from filter criteria and evaluates correctly', async () => {
    const original = {
      ...predicateToCriteria(emptyPredicate()),
      personIds: new Set([7]),
    }
    const predicate: TodoPredicate = criteriaToPredicate(original)

    const id = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 },
      name: "Alice's tasks",
      membership: { kind: 'custom', predicate },
      sort: 'deadline',
      grouping: 'deadline',
    })

    // Reload from DB to confirm persistence (no in-memory shortcut).
    useListDefinitionStore.setState({ listDefinitions: [] })
    await useListDefinitionStore.getState().load()
    const reloaded = useListDefinitionStore.getState().listDefinitions.find(d => d.id === id)
    expect(reloaded).toBeDefined()
    expect(reloaded!.membership.kind).toBe('custom')
    if (reloaded!.membership.kind === 'custom') {
      expect(reloaded!.membership.predicate.personIds).toEqual([7])
    }
    expect(reloaded!.sort).toBe('deadline')
    expect(reloaded!.grouping).toBe('deadline')

    // Round-trip predicate evaluation: matchesFilter via the dashboard interpreter.
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1 }),                                  // unassigned
      makeTodo({ id: 2 }),                                  // person=7
      makeTodo({ id: 3 }),                                  // person=99
    ]
    const personMap = new Map<number, number[]>([
      [2, [7]], [3, [99]],
    ])

    const list = buildList(reloaded!, todos, {
      today: new Date('2026-04-18T00:00:00Z'),
      weekStartsOn: 1,
      evalPredicate: (predicate, todo) => {
        const criteria = predicateToCriteria(predicate)
        return matchesFilter(criteria, todo, personMap.get(todo.id))
      },
    })

    const ids = list.todos.map(t => t.id).sort()
    expect(ids).toEqual([2])  // only id=2 has person=7
  })

  it('updateListDefinition mirrors a "save edited preset" flow', async () => {
    const initialPredicate = criteriaToPredicate({
      ...predicateToCriteria(emptyPredicate()),
      personIds: new Set([1]),
    })
    const id = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 },
      name: 'My preset',
      membership: { kind: 'custom', predicate: initialPredicate },
      sort: 'deadline',
      grouping: 'deadline',
    })

    // Simulate a user editing in ListView and saving back: build a new predicate
    // from edited criteria and call update().
    const edited = criteriaToPredicate({
      ...predicateToCriteria(emptyPredicate()),
      personIds: new Set([1, 2]),  // added a second person
      showCompleted: true,
    })
    const def = useListDefinitionStore.getState().listDefinitions.find(d => d.id === id)!
    await useListDefinitionStore.getState().update({
      ...def,
      membership: { kind: 'custom', predicate: edited },
    })

    useListDefinitionStore.setState({ listDefinitions: [] })
    await useListDefinitionStore.getState().load()
    const after = useListDefinitionStore.getState().listDefinitions.find(d => d.id === id)
    expect(after?.membership.kind).toBe('custom')
    if (after?.membership.kind === 'custom') {
      expect(after.membership.predicate.personIds).toEqual([1, 2])
      expect(after.membership.predicate.showCompleted).toBe(true)
    }
  })
})
