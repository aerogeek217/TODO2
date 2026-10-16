import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { listDefinitionRepository } from '../../data/list-definition-repository'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { criteriaToPredicate, predicateToCriteria } from '../../utils/filter-criteria'
import { buildList } from '../../services/build-list'
import type { PersistedTodoItem, TodoPredicate } from '../../models'
import { makeTodo, matchesFilterNow as matchesFilter } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useListDefinitionStore.setState({ listDefinitions: [] })
  useUndoStore.setState({ undoStack: [], redoStack: [] } as never)
  useSettingsStore.setState({ checkinTaskScope: { kind: 'all' } })
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
      pinnedToDashboard: true,
      membership: { kind: 'custom', predicate: emptyPredicate() },
      sort: 'deadline',
      grouping: 'deadline',
    })
    await listDefinitionRepository.insert({
      name: 'A', sortOrder: 1,
      pinnedToDashboard: true,
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
      sort: 'manual',
      grouping: 'none',
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

  it('remove deletes and supports undo', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'Going away' })
    await useListDefinitionStore.getState().remove(id)
    expect(useListDefinitionStore.getState().listDefinitions).toHaveLength(0)
    expect(await listDefinitionRepository.getById(id)).toBeUndefined()

    // Undo
    await useUndoStore.getState().undo()
    const after = useListDefinitionStore.getState().listDefinitions
    expect(after).toHaveLength(1)
    expect(after[0]!.name).toBe('Going away')
  })

  it('remove clears a check-in scope on that list; undo brings it back, redo clears it again', async () => {
    const id = await useListDefinitionStore.getState().add({ name: 'Check-in list' })
    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'list', listDefinitionId: id })

    await useListDefinitionStore.getState().remove(id)
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'all' })
    expect((await db.settings.get('checkinTaskScope'))?.value).toBe('all')

    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'list', listDefinitionId: id })
    expect((await db.settings.get('checkinTaskScope'))?.value).toBe(`list:${id}`)

    await useUndoStore.getState().redo()
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'all' })
  })

  it('remove leaves a check-in scope on another list alone; undo keeps a scope changed since', async () => {
    const keep = await useListDefinitionStore.getState().add({ name: 'Keep' })
    const gone = await useListDefinitionStore.getState().add({ name: 'Gone' })
    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'list', listDefinitionId: keep })
    await useListDefinitionStore.getState().remove(gone)
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'list', listDefinitionId: keep })
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'list', listDefinitionId: keep })

    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'list', listDefinitionId: gone })
    await useListDefinitionStore.getState().remove(gone)
    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'hot' })
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'hot' })
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
})

describe('Save-as-preset round-trip', () => {
  it('persists a custom predicate from filter criteria and evaluates correctly', async () => {
    const original = {
      ...predicateToCriteria(emptyPredicate()),
      personIds: new Set([7]),
    }
    const predicate: TodoPredicate = criteriaToPredicate(original)

    const id = await useListDefinitionStore.getState().add({
      name: "Alice's tasks",
      membership: { kind: 'custom', predicate },
      sort: 'deadline',
      grouping: 'deadline',
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
    const id = await useListDefinitionStore.getState().add({
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
    expect(after).toBeDefined()
    if (after!.membership.kind === 'custom') {
      expect(after!.membership.predicate.personIds).toEqual([1, 2])
      expect(after!.membership.predicate.showCompleted).toBe(true)
    }
  })
})
