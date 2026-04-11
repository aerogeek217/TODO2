import type { TodoItem, PersistedTodoItem } from '../models'

/** Sort comparator for sortOrder */
export const bySortOrder = (a: TodoItem, b: TodoItem) => a.sortOrder - b.sortOrder

/** Build a map of parentId → sorted children */
export function buildChildMap(todos: PersistedTodoItem[]): Map<number, PersistedTodoItem[]> {
  const map = new Map<number, PersistedTodoItem[]>()
  for (const t of todos) {
    if (t.parentId != null) {
      const list = map.get(t.parentId) ?? []
      list.push(t)
      map.set(t.parentId, list)
    }
  }
  for (const [, list] of map) list.sort(bySortOrder)
  return map
}

/**
 * Groups a flat todo list into parent/child hierarchy (max 2 levels).
 * Returns an ordered list of { parent, children } entries.
 * Root todos (no parentId) appear as parents sorted by sortOrder.
 * Orphaned children (whose parent is not in the list) are promoted to root level.
 */
export function buildHierarchy(todos: PersistedTodoItem[]) {
  const byId = new Map<number, PersistedTodoItem>()
  const childrenOf = new Map<number, PersistedTodoItem[]>()
  const roots: PersistedTodoItem[] = []

  for (const todo of todos) {
    byId.set(todo.id, todo)
  }

  for (const todo of todos) {
    if (todo.parentId != null && byId.has(todo.parentId)) {
      // Walk up to the nearest root ancestor to prevent invisible grandchildren.
      // If a task's parent is itself a child, promote to the root ancestor's children.
      let pid = todo.parentId
      const visited = new Set<number>()
      for (let d = 0; d < 10; d++) {
        if (visited.has(pid)) break
        visited.add(pid)
        const p = byId.get(pid)!
        if (p.parentId == null || !byId.has(p.parentId)) break
        pid = p.parentId
      }
      const list = childrenOf.get(pid) ?? []
      list.push(todo)
      childrenOf.set(pid, list)
    } else {
      roots.push(todo)
    }
  }

  roots.sort(bySortOrder)

  for (const [, children] of childrenOf) {
    children.sort(bySortOrder)
  }

  return roots.map((parent) => ({
    parent,
    children: childrenOf.get(parent.id) ?? [],
  }))
}

/** Returns tasks in visual display order (parent, children, parent, children, ...) */
export function getFlatVisualOrder(todos: PersistedTodoItem[]): PersistedTodoItem[] {
  const hierarchy = buildHierarchy(todos)
  const flat: PersistedTodoItem[] = []
  for (const { parent, children } of hierarchy) {
    flat.push(parent)
    for (const child of children) flat.push(child)
  }
  return flat
}

