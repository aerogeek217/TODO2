import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { validateRow, IMPORT_ROW_PICKERS } from '../../data/import-validation'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { emptyPredicate } from '../../stores/list-definition-store'
import { predicateToCriteria } from '../../stores/filter-store'
import { getFilterDefaults, predicateToFilterDefaults } from '../../utils/filter-defaults'
import { defsEqual } from '../../utils/list-def-equal'
import type { PersistedListDefinition } from '../../models/list-definition'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.getState().clear()
})

const mem = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!

describe('bulkSetFocus', () => {
  it('puts tasks in focus and takes them out (absent, not false), undoably', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')

    await useTodoStore.getState().bulkSetFocus([a, b], true)
    expect((await db.todos.get(a))!.focus).toBe(true)
    expect((await db.todos.get(b))!.focus).toBe(true)
    expect(mem(a).focus).toBe(true)

    await useTodoStore.getState().bulkSetFocus([a], false)
    const row = (await db.todos.get(a))!
    expect('focus' in row).toBe(false)
    expect(mem(a).focus).toBeUndefined()

    await useUndoStore.getState().undo()
    expect((await db.todos.get(a))!.focus).toBe(true)
    expect(mem(a).focus).toBe(true)
  })

  it('does nothing for an empty id list', async () => {
    await useTodoStore.getState().bulkSetFocus([], true)
    expect(useUndoStore.getState().canUndo()).toBe(false)
  })
})

describe('focus in import validation', () => {
  const todo = {
    id: 1, uid: 'u1', title: 'T', isCompleted: false, sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z', modifiedAt: '2026-10-01T00:00:00.000Z',
  }

  it('accepts a boolean / absent focus on a todo and keeps only true', () => {
    expect(validateRow('todos', { ...todo, focus: true })).toBe(true)
    expect(validateRow('todos', { ...todo, focus: false })).toBe(true)
    expect(validateRow('todos', todo)).toBe(true)
    expect(validateRow('todos', { ...todo, focus: 'yes' })).not.toBe(true)
    expect(IMPORT_ROW_PICKERS.todos({ ...todo, focus: true }).focus).toBe(true)
    expect(IMPORT_ROW_PICKERS.todos({ ...todo, focus: false }).focus).toBeUndefined()
  })

  it('accepts a tri-state focus clause on a list predicate', () => {
    const def = (focus: unknown) => ({
      id: 1, name: 'L', sortOrder: 0, pinnedToDashboard: false, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), focus } },
    })
    expect(validateRow('listDefinitions', def(true))).toBe(true)
    expect(validateRow('listDefinitions', def(false))).toBe(true)
    expect(validateRow('listDefinitions', def(null))).toBe(true)
    expect(validateRow('listDefinitions', def(1))).not.toBe(true)
  })
})

describe('focus filter defaults and list equality', () => {
  it('a focus-only filter makes new tasks start in focus; not-in-focus does not', () => {
    expect(getFilterDefaults(predicateToCriteria({ ...emptyPredicate(), focus: true })).focus).toBe(true)
    expect(getFilterDefaults(predicateToCriteria({ ...emptyPredicate(), focus: false })).focus).toBe(false)
    expect(predicateToFilterDefaults(emptyPredicate()).focus).toBe(false)
  })

  it('list-definition equality sees focus (absent == null)', () => {
    const base: PersistedListDefinition = {
      id: 1, name: 'L', sortOrder: 0, pinnedToDashboard: false, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: emptyPredicate() },
    }
    const legacyPredicate = { ...emptyPredicate() }
    delete legacyPredicate.focus
    const legacy: PersistedListDefinition = { ...base, membership: { kind: 'custom', predicate: legacyPredicate } }
    const focused: PersistedListDefinition = { ...base, membership: { kind: 'custom', predicate: { ...emptyPredicate(), focus: true } } }
    expect(defsEqual(base, legacy)).toBe(true)
    expect(defsEqual(base, focused)).toBe(false)
  })
})
