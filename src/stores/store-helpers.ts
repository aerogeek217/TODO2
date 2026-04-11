/**
 * Shared helpers for Zustand store patterns.
 * DUP-1: loadWithState — loading/error boilerplate
 * DUP-2: updateEntityInMap — refresh entity references in assignment maps
 * DUP-3: captureJoinRows / restoreJoinRows — capture and restore join table rows for undo
 * DUP-4: captureAssignments — capture person/tag/org IDs for undo
 * DUP-5: bulkUpdateField — shared bulk field update with undo
 */

import type { Table } from 'dexie'
import { todoRepository } from '../data'
import type { PersistedTodoItem } from '../models'
import { undoable } from '../services/undoable'

type SetFn = (partial: Record<string, unknown>) => void

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
 * DUP-4: Capture current person/tag/org assignment IDs for a todo (for undo).
 * Uses dynamic imports to avoid circular dependencies.
 */
export async function captureAssignments(todoId: number): Promise<{
  personIds: number[]
  tagIds: number[]
  orgIds: number[]
}> {
  const { usePersonStore } = await import('./person-store')
  const { useTagStore } = await import('./tag-store')
  const { useOrgStore } = await import('./org-store')
  return {
    personIds: (usePersonStore.getState().assignedPeopleMap.get(todoId) ?? []).map((p) => p.id!),
    tagIds: (useTagStore.getState().assignedTagsMap.get(todoId) ?? []).map((t) => t.id!),
    orgIds: (useOrgStore.getState().assignedOrgsMap.get(todoId) ?? []).map((o) => o.id!),
  }
}

/**
 * DUP-4: Capture assignments for multiple todos at once.
 */
export async function captureAssignmentsBulk(todoIds: number[]): Promise<
  Array<{ todoId: number; personIds: number[]; tagIds: number[]; orgIds: number[] }>
> {
  const { usePersonStore } = await import('./person-store')
  const { useTagStore } = await import('./tag-store')
  const { useOrgStore } = await import('./org-store')
  const pMap = usePersonStore.getState().assignedPeopleMap
  const tMap = useTagStore.getState().assignedTagsMap
  const oMap = useOrgStore.getState().assignedOrgsMap
  return todoIds.map((todoId) => ({
    todoId,
    personIds: (pMap.get(todoId) ?? []).map((p) => p.id!),
    tagIds: (tMap.get(todoId) ?? []).map((t) => t.id!),
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
  await entityTable.add(entity)
  for (const { table, rows } of joins) {
    if (rows.length) await table.bulkAdd(rows)
  }
}

/**
 * DUP-5: Bulk update a single field on multiple todos, with undo support.
 * Works for fields updated via todoRepository.bulkUpdate (priority, dueDate).
 */
export async function bulkUpdateField<K extends keyof PersistedTodoItem>(
  ids: number[],
  field: K,
  value: PersistedTodoItem[K],
  label: string,
  get: () => { todos: PersistedTodoItem[] },
  set: (partial: { todos: PersistedTodoItem[] }) => void,
): Promise<void> {
  const prevValues = get().todos
    .filter((t) => ids.includes(t.id))
    .map((t) => ({ id: t.id, prev: t[field] }))

  await todoRepository.bulkUpdate(ids.map((id) => ({ todoId: id, changes: { [field]: value } })))
  const idSet = new Set(ids)
  const now = new Date()
  set({
    todos: get().todos.map((t) =>
      idSet.has(t.id) ? { ...t, [field]: value, modifiedAt: now } : t,
    ),
  })

  undoable(
    label,
    () => bulkUpdateField(ids, field, value, label, get, set),
    async () => {
      const mutations = prevValues
        .filter((s) => s.prev !== value)
        .map((s) => ({ todoId: s.id, changes: { [field]: s.prev } }))
      if (mutations.length > 0) {
        await todoRepository.bulkUpdate(mutations)
        const prevMap = new Map(prevValues.map((s) => [s.id, s.prev]))
        set({
          todos: get().todos.map((t) =>
            idSet.has(t.id) ? { ...t, [field]: prevMap.get(t.id), modifiedAt: new Date() } : t,
          ),
        })
      }
    },
  )
}
