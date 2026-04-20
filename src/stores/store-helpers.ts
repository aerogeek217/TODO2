/**
 * Shared helpers for Zustand store patterns.
 * DUP-1: loadWithState — loading/error boilerplate
 * DUP-2: updateEntityInMap — refresh entity references in assignment maps
 * DUP-3: captureJoinRows / restoreJoinRows — capture and restore join table rows for undo
 * DUP-4: captureAssignments — capture person/org IDs for undo
 * DUP-5: bulkUpdateField — shared bulk field update with undo
 */

import type { Table } from 'dexie'
import { db } from '../data/database'
import { personRepository } from '../data/person-repository'
import { orgRepository } from '../data/org-repository'
import { todoRepository } from '../data'
import type { PersistedTodoItem } from '../models'
import { undoable } from '../services/undoable'

export type SetFn = (partial: Record<string, unknown>) => void

/**
 * DUP-1: Execute a data-fetching function with loading/error state management.
 * Returns the fetched data, or undefined on error.
 */
export async function loadWithState<T>(
  set: SetFn,
  fetcher: () => Promise<T>,
  label: string,
): Promise<T | undefined> {
  set({ loading: true, error: null })
  try {
    const data = await fetcher()
    return data
  } catch (e) {
    console.error(`Failed to load ${label}:`, e)
    set({ error: `Failed to load ${label}` })
    return undefined
  } finally {
    set({ loading: false })
  }
}

/**
 * Wrap a store mutation with error handling: clears previous error, catches failures,
 * logs them, sets error state, and re-throws so callers can handle if needed.
 */
export async function mutate<T>(
  set: SetFn,
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  set({ error: null })
  try {
    return await fn()
  } catch (e) {
    console.error(`${label}:`, e)
    set({ error: label })
    throw e
  }
}

/**
 * Optimistic mutation: update UI state immediately, persist async, rollback on failure.
 * Uses item-level rollback (caller patches only affected items) to prevent concurrent
 * rollbacks from stomping each other's state.
 *
 * Undo is only registered after successful persist. Failed operations never enter the
 * undo stack.
 */
export async function optimistic(
  set: SetFn,
  apply: () => void,
  persist: () => Promise<void>,
  rollback: () => void,
  label: string,
  undo?: {
    description: string
    redo: () => void | Promise<void>
    undo: () => void | Promise<void>
    showSnackbar?: boolean
  },
): Promise<void> {
  set({ error: null })
  apply()
  try {
    await persist()
    if (undo) {
      undoable(undo.description, undo.redo, undo.undo, undo.showSnackbar)
    }
  } catch (e) {
    console.error(`${label}:`, e)
    rollback()
    set({ error: label })
    throw e
  }
}

/**
 * Shallow-merge `patch` into the item in `list` with matching `id`. Non-matching
 * items pass through by identity. Returns a new array. Used by floating-* and
 * list-inset stores to deduplicate the `.map(i => i.id === id ? {...i, ...} : i)`
 * pattern across optimistic update + rollback paths.
 */
export function updateItemInList<T extends { id?: number }>(
  list: T[],
  id: number,
  patch: Partial<T>,
): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item))
}

/**
 * DUP-2: Update an entity in an assignment map (Map<todoId, Entity[]>).
 * When an entity is edited, all references in the map must be refreshed.
 */
export function updateEntityInMap<E extends { id?: number }>(
  entity: E,
  map: Map<number, E[]>,
): Map<number, E[]> {
  const updated = new Map(map)
  for (const [key, list] of updated) {
    if (list.some((e) => e.id === entity.id)) {
      updated.set(key, list.map((e) => (e.id === entity.id ? { ...entity } : e)))
    }
  }
  return updated
}

/**
 * DUP-4: Capture current person/org assignment IDs for a todo (for undo).
 * Uses dynamic imports to avoid circular dependencies.
 */
export async function captureAssignments(todoId: number): Promise<{
  personIds: number[]
  orgIds: number[]
}> {
  const [people, orgsMap] = await Promise.all([
    personRepository.getAssignedPeople(todoId),
    orgRepository.getAssignedOrgsForTodos([todoId]),
  ])
  return {
    personIds: people.map((p) => p.id!),
    orgIds: (orgsMap.get(todoId) ?? []).map((o) => o.id!),
  }
}

/**
 * DUP-4: Capture assignments for multiple todos at once.
 */
export async function captureAssignmentsBulk(todoIds: number[]): Promise<
  Array<{ todoId: number; personIds: number[]; orgIds: number[] }>
> {
  const [pMap, oMap] = await Promise.all([
    personRepository.getAssignedPeopleForTodos(todoIds),
    orgRepository.getAssignedOrgsForTodos(todoIds),
  ])
  return todoIds.map((todoId) => ({
    todoId,
    personIds: (pMap.get(todoId) ?? []).map((p) => p.id!),
    orgIds: (oMap.get(todoId) ?? []).map((o) => o.id!),
  }))
}

/**
 * DUP-3: Capture join table rows for an entity being deleted (for undo restore).
 */
export interface JoinCapture { table: Table; rows: unknown[] }

export async function captureJoinRows(
  captures: Array<{ table: Table; key: string; id: number }>,
): Promise<JoinCapture[]> {
  return Promise.all(
    captures.map(async ({ table, key, id }) => ({
      table,
      rows: await table.where(key).equals(id).toArray(),
    })),
  )
}

/**
 * DUP-3: Restore an entity and its join table rows (undo of delete).
 */
export async function restoreEntityWithJoins(
  entityTable: Table,
  entity: unknown,
  joins: JoinCapture[],
): Promise<void> {
  await db.transaction('rw', [entityTable, ...joins.map(j => j.table)], async () => {
    await entityTable.add(entity)
    for (const { table, rows } of joins) {
      if (rows.length) await table.bulkAdd(rows)
    }
  })
}

/**
 * DUP-5: Bulk update a single field on multiple todos, with undo support.
 * Uses optimistic update: state changes immediately, DB write follows.
 */
export async function bulkUpdateField<K extends keyof PersistedTodoItem>(
  ids: number[],
  field: K,
  value: PersistedTodoItem[K],
  label: string,
  get: () => { todos: PersistedTodoItem[] },
  set: SetFn,
): Promise<void> {
  const prevValues = get().todos
    .filter((t) => ids.includes(t.id))
    .map((t) => ({ id: t.id, prev: t[field], modifiedAt: t.modifiedAt }))
  const idSet = new Set(ids)

  await optimistic(
    set,
    () => {
      const now = new Date()
      set({
        todos: get().todos.map((t) =>
          idSet.has(t.id) ? { ...t, [field]: value, modifiedAt: now } : t,
        ),
      })
    },
    () => todoRepository.bulkUpdate(ids.map((id) => ({ todoId: id, changes: { [field]: value } }))),
    () => {
      const prevMap = new Map(prevValues.map((s) => [s.id, { prev: s.prev, modifiedAt: s.modifiedAt }]))
      set({
        todos: get().todos.map((t) => {
          const saved = prevMap.get(t.id)
          return saved ? { ...t, [field]: saved.prev, modifiedAt: saved.modifiedAt } : t
        }),
      })
    },
    label,
    {
      description: label,
      redo: () => bulkUpdateField(ids, field, value, label, get, set),
      undo: async () => {
        const mutations = prevValues
          .filter((s) => s.prev !== value)
          .map((s) => ({ todoId: s.id, changes: { [field]: s.prev, modifiedAt: s.modifiedAt } }))
        if (mutations.length > 0) {
          await todoRepository.bulkUpdate(mutations)
          const prevMap = new Map(prevValues.map((s) => [s.id, { prev: s.prev, modifiedAt: s.modifiedAt }]))
          set({
            todos: get().todos.map((t) => {
              const saved = prevMap.get(t.id)
              return saved ? { ...t, [field]: saved.prev, modifiedAt: saved.modifiedAt } : t
            }),
          })
        }
      },
    },
  )
}
