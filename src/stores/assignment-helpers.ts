import { optimistic, type SetFn } from './store-helpers'

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
  set: SetFn,
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
      const entity = getEntities().find((e) => e.id === entityId)
      if (!entity) return
      const current = getMap().get(todoId) ?? []
      if (current.some((e) => e.id === entityId)) return

      const prevMap = new Map(getMap())
      return optimistic(
        set,
        () => {
          const updated = new Map(getMap())
          updated.set(todoId, [...current, entity])
          setMap(updated)
        },
        () => repo.assign(todoId, entityId),
        () => setMap(prevMap),
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
      const prevMap = new Map(getMap())
      return optimistic(
        set,
        () => {
          const current = getMap().get(todoId) ?? []
          const updated = new Map(getMap())
          updated.set(todoId, current.filter((e) => e.id !== entityId))
          setMap(updated)
        },
        () => repo.unassign(todoId, entityId),
        () => setMap(prevMap),
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
      const toAssign: number[] = []
      for (const todoId of todoIds) {
        const current = map.get(todoId) ?? []
        if (!current.some((e) => e.id === entityId)) {
          toAssign.push(todoId)
        }
      }
      if (toAssign.length === 0) return

      const prevMap = new Map(map)
      return optimistic(
        set,
        () => {
          const updated = new Map(getMap())
          for (const todoId of toAssign) {
            const current = updated.get(todoId) ?? []
            updated.set(todoId, [...current, entity])
          }
          setMap(updated)
        },
        () => Promise.all(toAssign.map((id) => repo.assign(id, entityId))).then(() => {}),
        () => setMap(prevMap),
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
      const toUnassign: number[] = []
      for (const todoId of todoIds) {
        const current = map.get(todoId) ?? []
        if (current.some((e) => e.id === entityId)) {
          toUnassign.push(todoId)
        }
      }
      if (toUnassign.length === 0) return

      const prevMap = new Map(map)
      return optimistic(
        set,
        () => {
          const updated = new Map(getMap())
          for (const todoId of toUnassign) {
            const current = updated.get(todoId) ?? []
            updated.set(todoId, current.filter((e) => e.id !== entityId))
          }
          setMap(updated)
        },
        () => Promise.all(toUnassign.map((id) => repo.unassign(id, entityId))).then(() => {}),
        () => setMap(prevMap),
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
