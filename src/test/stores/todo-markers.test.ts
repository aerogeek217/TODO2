import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { validateRow, rowFixes, IMPORT_TABLES } from '../../data/import-validation'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { emptyPredicate } from '../../models'
import { predicateToCriteria } from '../../utils/filter-criteria'
import { getFilterDefaults, markerFlags, predicateToFilterDefaults } from '../../utils/filter-defaults'
import { defsEqual } from '../../utils/list-def-equal'
import type { PersistedListDefinition } from '../../models/list-definition'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.setState(useUndoStore.getInitialState(), true)
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
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})

describe('bulkSetUrgent / bulkSetImportant', () => {
  it.each(['urgent', 'important'] as const)('sets and clears %s (absent, not false), one undo step each', async (field) => {
    const set = field === 'urgent' ? useTodoStore.getState().bulkSetUrgent : useTodoStore.getState().bulkSetImportant
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')

    await set([a, b], true)
    expect((await db.todos.get(a))![field]).toBe(true)
    expect(mem(b)[field]).toBe(true)

    await set([a, b], false)
    expect(field in (await db.todos.get(a))!).toBe(false)
    expect(mem(a)[field]).toBeUndefined()

    await useUndoStore.getState().undo()
    expect((await db.todos.get(a))![field]).toBe(true)
    expect(mem(b)[field]).toBe(true)
  })

  it('does nothing for an empty id list', async () => {
    await useTodoStore.getState().bulkSetUrgent([], true)
    await useTodoStore.getState().bulkSetImportant([], true)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})

describe('bulkClearDueDate', () => {
  it('removes the due dates in one undo step and shows the undo snackbar', async () => {
    const a = await useTodoStore.getState().add('A')
    const b = await useTodoStore.getState().add('B')
    const due = new Date(2026, 9, 12)
    await useTodoStore.getState().bulkSetDeadline([a, b], due)

    await useTodoStore.getState().bulkClearDueDate([a, b])
    expect('dueDate' in (await db.todos.get(a))!).toBe(false)
    expect(mem(b).dueDate).toBeUndefined()
    expect(useUndoStore.getState().snackbar?.description).toBe('Removed 2 due dates')

    await useUndoStore.getState().undo()
    expect((await db.todos.get(a))!.dueDate).toEqual(due)
    expect(mem(b).dueDate).toEqual(due)
  })
})

describe('duplicate', () => {
  it('copies the urgent and important flags', async () => {
    const a = await useTodoStore.getState().add('A')
    await useTodoStore.getState().bulkSetUrgent([a], true)
    await useTodoStore.getState().bulkSetImportant([a], true)
    const copy = (await useTodoStore.getState().duplicate(a))!
    expect(mem(copy)).toMatchObject({ urgent: true, important: true })
  })
})

describe('markers in import validation', () => {
  const todo = {
    id: 1, uid: 'u1', title: 'T', isCompleted: false, sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z', modifiedAt: '2026-10-01T00:00:00.000Z',
  }

  it.each(['focus', 'urgent', 'important'] as const)('accepts a boolean / absent %s on a todo and keeps only true', (field) => {
    expect(validateRow('todos', { ...todo, [field]: true })).toBe(true)
    expect(validateRow('todos', { ...todo, [field]: false })).toBe(true)
    expect(validateRow('todos', todo)).toBe(true)
    expect(validateRow('todos', { ...todo, [field]: 'yes' })).not.toBe(true)
    expect(IMPORT_TABLES.todos.pick({ ...todo, [field]: true })[field]).toBe(true)
    expect(IMPORT_TABLES.todos.pick({ ...todo, [field]: false })[field]).toBeUndefined()
  })

  it('accepts a Markers filter on a list predicate: known markers set to true; drops any other', () => {
    const def = (markers: unknown) => ({
      id: 1, name: 'L', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), markers } },
    })
    expect(validateRow('listDefinitions', def({ focus: true }))).toBe(true)
    expect(validateRow('listDefinitions', def({ urgent: true, important: true, focus: true }))).toBe(true)
    expect(validateRow('listDefinitions', def(null))).toBe(true)
    expect(validateRow('listDefinitions', def(undefined))).toBe(true)
    // Anything else is dropped on import (no filter), not rejected.
    for (const bad of [{ focus: false }, { hot: true }, true, ['urgent']]) {
      expect(validateRow('listDefinitions', def(bad))).toBe(true)
      expect(rowFixes('listDefinitions', def(bad))).toEqual(['markers filter dropped'])
      const picked = IMPORT_TABLES.listDefinitions.pick(def(bad))
      expect(picked.membership.predicate.markers).toBeNull()
    }
  })

  it('validates the urgent range setting: off or a day count 0–365', () => {
    for (const value of ['off', '0', '3', '14', '365']) expect(validateRow('settings', { key: 'urgentDueWithinDays', value }), value).toBe(true)
    for (const value of ['', '-1', '366', '2.5', 'soon', 'null']) expect(validateRow('settings', { key: 'urgentDueWithinDays', value }), value).not.toBe(true)
  })
})

describe('marker filter defaults and list equality', () => {
  it('a Markers filter makes new tasks start with those markers', () => {
    const fd = getFilterDefaults(predicateToCriteria({ ...emptyPredicate(), markers: { focus: true, urgent: true } }))
    expect(fd.markers).toEqual({ urgent: true, focus: true })
    expect(markerFlags(fd)).toEqual({ urgent: true, focus: true })
    const none = predicateToFilterDefaults(emptyPredicate())
    expect(none.markers).toBeUndefined()
    expect(markerFlags(none)).toEqual({})
  })

  it('a Hot filter seeds no markers (no one set of flags makes a task hot under every rule)', () => {
    const fd = getFilterDefaults(predicateToCriteria({ ...emptyPredicate(), markers: 'hot', personIds: [3] }))
    expect(fd.markers).toBeUndefined()
    expect(fd.personIds).toEqual([3])
    expect(markerFlags(fd)).toEqual({})
  })

  it('list-definition equality sees markers (absent == null == {}), not their order', () => {
    const base: PersistedListDefinition = {
      id: 1, name: 'L', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: emptyPredicate() },
    }
    const legacyPredicate = { ...emptyPredicate() }
    delete legacyPredicate.markers
    const withPredicate = (predicate: PersistedListDefinition['membership']['predicate']): PersistedListDefinition =>
      ({ ...base, membership: { kind: 'custom', predicate } })
    expect(defsEqual(base, withPredicate(legacyPredicate))).toBe(true)
    expect(defsEqual(base, withPredicate({ ...emptyPredicate(), markers: {} }))).toBe(true)
    expect(defsEqual(base, withPredicate({ ...emptyPredicate(), markers: { focus: true } }))).toBe(false)
    expect(defsEqual(
      withPredicate({ ...emptyPredicate(), markers: { focus: true, urgent: true } }),
      withPredicate({ ...emptyPredicate(), markers: { urgent: true, focus: true } }),
    )).toBe(true)
    // Hot equals only Hot.
    expect(defsEqual(withPredicate({ ...emptyPredicate(), markers: 'hot' }), withPredicate({ ...emptyPredicate(), markers: 'hot' }))).toBe(true)
    expect(defsEqual(base, withPredicate({ ...emptyPredicate(), markers: 'hot' }))).toBe(false)
    expect(defsEqual(
      withPredicate({ ...emptyPredicate(), markers: 'hot' }),
      withPredicate({ ...emptyPredicate(), markers: { urgent: true, important: true, focus: true } }),
    )).toBe(false)
  })
})
