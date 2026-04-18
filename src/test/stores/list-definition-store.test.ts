import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { useListDefinitionStore, emptyPredicate } from '../../stores/list-definition-store'
import { useUndoStore } from '../../stores/undo-store'
import { criteriaToPredicate, predicateToCriteria, matchesFilter } from '../../stores/filter-store'
import { buildDashboardLists } from '../../services/dashboard-lists'
import type { PersistedTodoItem, TodoPredicate } from '../../models'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useListDefinitionStore.setState({ listDefinitions: [], loading: false, error: null })
  useUndoStore.setState({ undoStack: [], redoStack: [] } as never)
})

describe('useListDefinitionStore load', () => {
  it('load sets listDefinitions to [] when table is empty', async () => {
    await useListDefinitionStore.getState().load()
    expect(useListDefinitionStore.getState().listDefinitions).toEqual([])
    expect(useListDefinitionStore.getState().loading).toBe(false)
    expect(useListDefinitionStore.getState().error).toBeNull()
  })

  it('load reads rows ordered by sortOrder', async () => {
    await listDefinitionRepository.insert({
      name: 'B', sortOrder: 2,
      pinnedToDashboard: true,
      membership: { kind: 'upcoming' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'relative-effective' },
    })
    await listDefinitionRepository.insert({
      name: 'A', sortOrder: 1,
      pinnedToDashboard: true,
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

describe('useListDefinitionStore mutations', () => {
  it('add inserts a custom list with sort-order appended and persists', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'My list' })
    expect(id).toBeGreaterThan(0)
    const defs = useListDefinitionStore.getState().listDefinitions
    expect(defs).toHaveLength(1)
    expect(defs[0]).toMatchObject({
      id,
      name: 'My list',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: { kind: 'custom' },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    })

    // Survives reload
    useListDefinitionStore.setState({ listDefinitions: [] })
    await useListDefinitionStore.getState().load()
    expect(useListDefinitionStore.getState().listDefinitions).toHaveLength(1)
  })

  it('add assigns incrementing sortOrder', async () => {
    await useListDefinitionStore.getState().add({ name: 'A' })
    await useListDefinitionStore.getState().add({ name: 'B' })
    await useListDefinitionStore.getState().add({ name: 'C' })
    const sorted = [...useListDefinitionStore.getState().listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    expect(sorted.map(d => d.name)).toEqual(['A', 'B', 'C'])
    expect(sorted.map(d => d.sortOrder)).toEqual([0, 1, 2])
  })

  it('rename updates name and persists', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'Old' })
    await useListDefinitionStore.getState().rename(id, 'New')
    expect(useListDefinitionStore.getState().listDefinitions[0].name).toBe('New')

    const row = await listDefinitionRepository.getById(id)
    expect(row?.name).toBe('New')
  })

  it('setPinned toggles pinnedToDashboard', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'X' })
    await useListDefinitionStore.getState().setPinned(id, false)
    expect(useListDefinitionStore.getState().listDefinitions[0].pinnedToDashboard).toBe(false)

    const row = await listDefinitionRepository.getById(id)
    expect(row?.pinnedToDashboard).toBe(false)
  })

  it('remove deletes and supports undo', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'Going away' })
    await useListDefinitionStore.getState().remove(id)
    expect(useListDefinitionStore.getState().listDefinitions).toHaveLength(0)
    expect(await listDefinitionRepository.getById(id)).toBeUndefined()

    // Undo
    await useUndoStore.getState().undo()
    const after = useListDefinitionStore.getState().listDefinitions
    expect(after).toHaveLength(1)
    expect(after[0].name).toBe('Going away')
  })

  it('clone duplicates with a unique name', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'Base' })
    const clonedId = await useListDefinitionStore.getState().clone(id)
    expect(clonedId).toBeGreaterThan(0)
    const names = useListDefinitionStore.getState().listDefinitions.map(d => d.name).sort()
    expect(names).toEqual(['Base', 'Base copy'])

    // Second clone gets "Base copy 2"
    await useListDefinitionStore.getState().clone(id)
    const namesAfter = useListDefinitionStore.getState().listDefinitions.map(d => d.name).sort()
    expect(namesAfter).toContain('Base copy 2')
  })

  it('reorder swaps sortOrder and persists', async () => {
    const a = await useListDefinitionStore.getState().add({ name: 'A' })
    const b = await useListDefinitionStore.getState().add({ name: 'B' })
    const c = await useListDefinitionStore.getState().add({ name: 'C' })
    await useListDefinitionStore.getState().reorder(0, 2) // A → end
    const order = useListDefinitionStore.getState().listDefinitions
      .slice()
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .map(d => d.id)
    expect(order).toEqual([b, c, a])

    // Persisted
    useListDefinitionStore.setState({ listDefinitions: [] })
    await useListDefinitionStore.getState().load()
    const reloaded = useListDefinitionStore.getState().listDefinitions.map(d => d.id)
    expect(reloaded).toEqual([b, c, a])
  })

  it('rename rejects empty name', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'Keep' })
    await expect(
      useListDefinitionStore.getState().rename(id, '   '),
    ).rejects.toThrow(/Name is required/)
  })
})

function makeTodo(o: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: 'Task ' + o.id,
    isCompleted: false,
    createdAt: new Date('2026-04-18T00:00:00Z'),
    modifiedAt: new Date('2026-04-18T00:00:00Z'),
    sortOrder: 0,
    ...o,
  }
}

describe('Save-as-preset round-trip', () => {
  it('persists a custom predicate from filter criteria and evaluates correctly', async () => {
    const original = {
      ...predicateToCriteria(emptyPredicate()),
      personIds: new Set([7]),
      tagIds: new Set([2]),
    }
    const predicate: TodoPredicate = criteriaToPredicate(original)

    const id = await useListDefinitionStore.getState().add({
      name: "Alice's tasks",
      membership: { kind: 'custom', predicate },
      sort: { kind: 'sortBy', by: 'date' },
      grouping: { kind: 'by-sortBy' },
      pinnedToDashboard: true,
    })

    // Reload from DB to confirm persistence (no in-memory shortcut).
    useListDefinitionStore.setState({ listDefinitions: [] })
    await useListDefinitionStore.getState().load()
    const reloaded = useListDefinitionStore.getState().listDefinitions.find(d => d.id === id)
    expect(reloaded).toBeDefined()
    expect(reloaded!.membership.kind).toBe('custom')
    if (reloaded!.membership.kind === 'custom') {
      expect(reloaded!.membership.predicate.personIds).toEqual([7])
      expect(reloaded!.membership.predicate.tagIds).toEqual([2])
    }
    expect(reloaded!.sort).toEqual({ kind: 'sortBy', by: 'date' })
    expect(reloaded!.grouping).toEqual({ kind: 'by-sortBy' })

    // Round-trip predicate evaluation: matchesFilter via the dashboard interpreter.
    const todos: PersistedTodoItem[] = [
      makeTodo({ id: 1 }),                                  // unassigned + untagged
      makeTodo({ id: 2 }),                                  // person=7, tag=2
      makeTodo({ id: 3 }),                                  // person=7, tag=99
    ]
    const personMap = new Map<number, number[]>([
      [2, [7]], [3, [7]],
    ])
    const tagMap = new Map<number, number[]>([
      [2, [2]], [3, [99]],
    ])

    const lists = buildDashboardLists([reloaded!], todos, {
      today: new Date('2026-04-18T00:00:00Z'),
      hiddenStatusIds: new Set(),
      showHiddenStatuses: false,
      showCompleted: false,
      evalPredicate: (predicate, todo) => {
        const criteria = predicateToCriteria(predicate)
        return matchesFilter(criteria, todo, personMap.get(todo.id), tagMap.get(todo.id))
      },
    })

    expect(lists).toHaveLength(1)
    const ids = lists[0].todos.map(t => t.id).sort()
    expect(ids).toEqual([2])  // only id=2 has BOTH person=7 AND tag=2
  })

  it('updateListDefinition mirrors a "save edited preset" flow', async () => {
    const initialPredicate = criteriaToPredicate({
      ...predicateToCriteria(emptyPredicate()),
      tagIds: new Set([1]),
    })
    const id = await useListDefinitionStore.getState().add({
      name: 'My preset',
      membership: { kind: 'custom', predicate: initialPredicate },
      sort: { kind: 'sortBy', by: 'date' },
      grouping: { kind: 'by-sortBy' },
    })

    // Simulate a user editing in ListView and saving back: build a new predicate
    // from edited criteria and call update().
    const edited = criteriaToPredicate({
      ...predicateToCriteria(emptyPredicate()),
      tagIds: new Set([1, 2]),  // added a second tag
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
    expect(after).toBeDefined()
    if (after!.membership.kind === 'custom') {
      expect(after!.membership.predicate.tagIds).toEqual([1, 2])
      expect(after!.membership.predicate.showCompleted).toBe(true)
    }
  })
})
