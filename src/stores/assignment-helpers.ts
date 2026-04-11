import { undoable } from '../services/undoable'

/**
 * Factory that generates assign/unassign/bulk assignment actions for
 * entity stores (tag, person, org). Centralizes the duplicated pattern
 * so bug fixes apply once.
 */

interface AssignmentRepo<T> {
  assign(todoId: number, entityId: number): Promise<void>
  unassign(todoId: number, entityId: number): Promise<void>
  getForTodos(todoIds: number[]): Promise<Map<number, T[]>>
}

interface AssignmentConfig<T> {
  repo: AssignmentRepo<T>
  label: string
  getName: (entity: T) => string
}

export interface AssignmentActions {
  loadAssignments: (todoIds: number[]) => Promise<void>
  assign: (todoId: number, entityId: number) => Promise<void>
  unassign: (todoId: number, entityId: number) => Promise<void>
  bulkAssign: (todoIds: number[], entityId: number) => Promise<void>
  bulkUnassign: (todoIds: number[], entityId: number) => Promise<void>
}

export function createAssignmentActions<T extends { id?: number }>(
  config: AssignmentConfig<T>,
  getEntities: () => T[],
  getMap: () => Map<number, T[]>,
  setMap: (map: Map<number, T[]>) => void,
): AssignmentActions {
  const { repo, label, getName } = config

  const actions: AssignmentActions = {
    async loadAssignments(todoIds: number[]) {
      const currentMap = getMap()
      const todoIdSet = new Set(todoIds)
      // Only query IDs not already in the map
      const newIds = todoIds.filter(id => !currentMap.has(id))
      if (newIds.length === 0 && currentMap.size === todoIdSet.size) return

      // Prune stale entries + merge new ones
      const merged = new Map<number, T[]>()
      for (const id of todoIds) {
        const existing = currentMap.get(id)
        if (existing !== undefined) merged.set(id, existing)
      }
      if (newIds.length > 0) {
        const fetched = await repo.getForTodos(newIds)
        for (const [id, entities] of fetched) {
          if (todoIdSet.has(id)) merged.set(id, entities)
        }
      }
      // Always update map to evict stale entries for deleted todos
      if (merged.size !== currentMap.size || newIds.length > 0) {
        setMap(merged)
      }
    },

    async assign(todoId: number, entityId: number) {
      // Repo handles idempotency check
      await repo.assign(todoId, entityId)
      const entity = getEntities().find((e) => e.id === entityId)
      if (entity) {
        const current = getMap().get(todoId) ?? []
        if (!current.some((e) => e.id === entityId)) {
          const updated = new Map(getMap())
          updated.set(todoId, [...current, entity])
          setMap(updated)
        }
      }
      undoable(
        `Assign ${label} "${entity ? getName(entity) : label}"`,
        () => actions.assign(todoId, entityId),
        () => actions.unassign(todoId, entityId),
      )
    },

    async unassign(todoId: number, entityId: number) {
      const entity = getEntities().find((e) => e.id === entityId)
      await repo.unassign(todoId, entityId)
      const current = getMap().get(todoId) ?? []
      const updated = new Map(getMap())
      updated.set(todoId, current.filter((e) => e.id !== entityId))
      setMap(updated)

      undoable(
        `Unassign ${label} "${entity ? getName(entity) : label}"`,
        () => actions.unassign(todoId, entityId),
        () => actions.assign(todoId, entityId),
      )
    },

    async bulkAssign(todoIds: number[], entityId: number) {
      const entity = getEntities().find((e) => e.id === entityId)
      if (!entity) return
      const map = getMap()
      const toAssign: number[] = []
      for (const todoId of todoIds) {
        const current = map.get(todoId) ?? []
        if (!current.some((e) => e.id === entityId)) {
          toAssign.push(todoId)
        }
      }
      await Promise.all(toAssign.map((id) => repo.assign(id, entityId)))
      const updated = new Map(getMap())
      for (const todoId of toAssign) {
        const current = updated.get(todoId) ?? []
        updated.set(todoId, [...current, entity])
      }
      setMap(updated)

      if (toAssign.length > 0) {
        undoable(
          `Assign "${getName(entity)}" to ${toAssign.length} tasks`,
          () => actions.bulkAssign(todoIds, entityId),
          () => actions.bulkUnassign(toAssign, entityId),
        )
      }
    },

    async bulkUnassign(todoIds: number[], entityId: number) {
      const entity = getEntities().find((e) => e.id === entityId)
      const map = getMap()
      const toUnassign: number[] = []
      for (const todoId of todoIds) {
        const current = map.get(todoId) ?? []
        if (current.some((e) => e.id === entityId)) {
          toUnassign.push(todoId)
        }
      }
      await Promise.all(toUnassign.map((id) => repo.unassign(id, entityId)))
      const updated = new Map(getMap())
      for (const todoId of toUnassign) {
        const current = updated.get(todoId) ?? []
        updated.set(todoId, current.filter((e) => e.id !== entityId))
      }
      setMap(updated)

      if (toUnassign.length > 0) {
        undoable(
          `Unassign "${entity ? getName(entity) : label}" from ${toUnassign.length} tasks`,
          () => actions.bulkUnassign(todoIds, entityId),
          () => actions.bulkAssign(toUnassign, entityId),
        )
      }
    },
  }

  return actions
}
