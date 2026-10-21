import { optimistic } from './store-helpers'

/**
 * Factory that generates assign/unassign/bulk assignment actions for
 * entity stores (tag, person). Centralizes the duplicated pattern
 * so bug fixes apply once.
 */

interface AssignmentRepo<T> {
  assign(todoId: number, entityId: number): Promise<void>
  unassign(todoId: number, entityId: number): Promise<void>
  /** `assign` for several tasks in one transaction (all or none). */
  bulkAssign(todoIds: readonly number[], entityId: number): Promise<void>
  /** `unassign` for several tasks in one transaction. */
  bulkUnassign(todoIds: readonly number[], entityId: number): Promise<void>
  getForTodos(todoIds: number[]): Promise<Map<number, T[]>>
}

interface AssignmentConfig<T> {
  repo: AssignmentRepo<T>
  label: string
  getName: (entity: T) => string
}

export interface LoadAssignmentsOptions {
  /**
   * Re-read every id from the database instead of only the ids missing from
   * the map. Needed after the tables were replaced underneath the store
   * (import / restore), where cached entries describe the old data.
   */
  refetch?: boolean
}

export interface AssignmentActions {
  loadAssignments: (todoIds: number[], options?: LoadAssignmentsOptions) => Promise<void>
  assign: (todoId: number, entityId: number) => Promise<void>
  unassign: (todoId: number, entityId: number) => Promise<void>
  bulkAssign: (todoIds: number[], entityId: number) => Promise<void>
  bulkUnassign: (todoIds: number[], entityId: number) => Promise<void>
}

/**
 * `map` with `entity` added to each task in `todoIds` that doesn't have it.
 * Other tasks' entries are kept as they are (so a rollback touches only the
 * tasks its own write changed).
 */
function withEntity<T extends { id?: number }>(map: Map<number, T[]>, todoIds: readonly number[], entity: T): Map<number, T[]> {
  const next = new Map(map)
  for (const todoId of todoIds) {
    const current = next.get(todoId) ?? []
    if (!current.some((e) => e.id === entity.id)) next.set(todoId, [...current, entity])
  }
  return next
}

/** `map` with `entity` back in task `todoId`'s list at `index` (an undone unassign). */
function withEntityAt<T extends { id?: number }>(map: Map<number, T[]>, todoId: number, entity: T, index: number): Map<number, T[]> {
  const current = map.get(todoId) ?? []
  if (current.some((e) => e.id === entity.id)) return map
  const next = new Map(map)
  next.set(todoId, [...current.slice(0, index), entity, ...current.slice(index)])
  return next
}

/** `map` with the entity `entityId` removed from each task in `todoIds`. */
function withoutEntity<T extends { id?: number }>(map: Map<number, T[]>, todoIds: readonly number[], entityId: number): Map<number, T[]> {
  const next = new Map(map)
  for (const todoId of todoIds) {
    const current = next.get(todoId)
    if (current?.some((e) => e.id === entityId)) next.set(todoId, current.filter((e) => e.id !== entityId))
  }
  return next
}

/**
 * Entity id → number of loaded tasks (open and completed) carrying it, from
 * an assignment map (`assignedPeopleMap` / `assignedTagsMap`). Callers load
 * assignments for every task first, as the People and Tags editors do.
 */
export function countTodosByEntity<T extends { id?: number }>(assignedMap: ReadonlyMap<number, readonly T[]>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const entities of assignedMap.values()) {
    for (const entity of entities) {
      if (entity.id == null) continue
      counts.set(entity.id, (counts.get(entity.id) ?? 0) + 1)
    }
  }
  return counts
}

export function createAssignmentActions<T extends { id?: number }>(
  config: AssignmentConfig<T>,
  getEntities: () => T[],
  getMap: () => Map<number, T[]>,
  setMap: (map: Map<number, T[]>) => void,
): AssignmentActions {
  const { repo, label, getName } = config

  const actions: AssignmentActions = {
    async loadAssignments(todoIds: number[], options?: LoadAssignmentsOptions) {
      const refetch = options?.refetch === true
      const initialMap = getMap()
      const todoIdSet = new Set(todoIds)
      // Only query IDs not already in the map (all of them on a refetch)
      const newIds = refetch ? todoIds : todoIds.filter(id => !initialMap.has(id))
      if (newIds.length === 0 && initialMap.size === todoIdSet.size) return

      // Fetch missing IDs from DB. The await window here is the source of the
      // race the rebuild below guards against: a parallel `assign` /
      // `unassign` may write the map optimistically while we're awaiting,
      // and the post-fetch DB read can predate that write's commit. Using a
      // pre-await snapshot to rebuild the map would clobber the optimistic
      // entry (seen as a QuickAdd `@person` chip not appearing on the new row).
      const fetched = newIds.length > 0
        ? await repo.getForTodos(newIds)
        : new Map<number, T[]>()

      // Re-read AFTER the await so optimistic writes that landed during the
      // fetch survive: prefer the latest map entry over the (possibly stale)
      // DB result. For ids that have never been written either way, record an
      // empty array so the contract `loadAssignments(ids) ⇒ map.has(id)` for
      // every id holds and subsequent calls don't refetch.
      const latestMap = getMap()
      const merged = new Map<number, T[]>()
      for (const id of todoIds) {
        const latest = latestMap.get(id)
        if (refetch) {
          merged.set(id, fetched.get(id) ?? [])
        } else if (latest !== undefined) {
          merged.set(id, latest)
        } else {
          merged.set(id, fetched.get(id) ?? [])
        }
      }
      // Skip the write only when the merged result is structurally identical
      // to latestMap (same size + every entry's identity matched). Identity
      // check is enough because the only writer of these arrays is this
      // helper or the optimistic update path, and both produce fresh arrays.
      let identical = merged.size === latestMap.size
      if (identical) {
        for (const [id, list] of merged) {
          if (latestMap.get(id) !== list) { identical = false; break }
        }
      }
      if (!identical) setMap(merged)
    },

    async assign(todoId: number, entityId: number) {
      const entity = getEntities().find((e) => e.id === entityId)
      if (!entity) return
      if ((getMap().get(todoId) ?? []).some((e) => e.id === entityId)) return

      return optimistic(
        () => setMap(withEntity(getMap(), [todoId], entity)),
        () => repo.assign(todoId, entityId),
        () => setMap(withoutEntity(getMap(), [todoId], entityId)),
        `Failed to assign ${label}`,
        {
          description: `Assign ${label} "${getName(entity)}"`,
          redo: () => actions.assign(todoId, entityId),
          undo: () => actions.unassign(todoId, entityId),
        },
      )
    },

    async unassign(todoId: number, entityId: number) {
      const entity = getEntities().find((e) => e.id === entityId)
      const current = getMap().get(todoId) ?? []
      const index = current.findIndex((e) => e.id === entityId)
      const removed = current[index]
      return optimistic(
        () => setMap(withoutEntity(getMap(), [todoId], entityId)),
        () => repo.unassign(todoId, entityId),
        () => { if (removed) setMap(withEntityAt(getMap(), todoId, removed, index)) },
        `Failed to unassign ${label}`,
        {
          description: `Unassign ${label} "${entity ? getName(entity) : label}"`,
          redo: () => actions.unassign(todoId, entityId),
          undo: () => actions.assign(todoId, entityId),
        },
      )
    },

    async bulkAssign(todoIds: number[], entityId: number) {
      const entity = getEntities().find((e) => e.id === entityId)
      if (!entity) return
      const map = getMap()
      const toAssign = todoIds.filter((todoId) => !(map.get(todoId) ?? []).some((e) => e.id === entityId))
      if (toAssign.length === 0) return

      return optimistic(
        () => setMap(withEntity(getMap(), toAssign, entity)),
        // One transaction (all or none), so the rollback leaves the map as stored.
        () => repo.bulkAssign(toAssign, entityId),
        () => setMap(withoutEntity(getMap(), toAssign, entityId)),
        `Failed to assign ${label}`,
        {
          description: `Assign "${getName(entity)}" to ${toAssign.length} tasks`,
          redo: () => actions.bulkAssign(todoIds, entityId),
          undo: () => actions.bulkUnassign(toAssign, entityId),
        },
      )
    },

    async bulkUnassign(todoIds: number[], entityId: number) {
      const entity = getEntities().find((e) => e.id === entityId)
      const map = getMap()
      const removed = new Map<number, { entity: T; index: number }>()
      for (const todoId of todoIds) {
        const current = map.get(todoId) ?? []
        const index = current.findIndex((e) => e.id === entityId)
        const found = current[index]
        if (found) removed.set(todoId, { entity: found, index })
      }
      const toUnassign = [...removed.keys()]
      if (toUnassign.length === 0) return

      return optimistic(
        () => setMap(withoutEntity(getMap(), toUnassign, entityId)),
        // One transaction (all or none), so the rollback leaves the map as stored.
        () => repo.bulkUnassign(toUnassign, entityId),
        () => {
          let next = getMap()
          for (const [todoId, { entity: e, index }] of removed) next = withEntityAt(next, todoId, e, index)
          setMap(next)
        },
        `Failed to unassign ${label}`,
        {
          description: `Unassign "${entity ? getName(entity) : label}" from ${toUnassign.length} tasks`,
          redo: () => actions.bulkUnassign(todoIds, entityId),
          undo: () => actions.bulkAssign(toUnassign, entityId),
        },
      )
    },
  }

  return actions
}
