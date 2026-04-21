import type { TodoItem, PersistedTodoItem } from '../models'

/**
 * Sort comparator for sortOrder, with id as a stable tiebreaker.
 * Id fallback of 0 is safe: persisted todos always have ids, and pre-insert
 * todos sharing sortOrder will keep the caller's insertion order (both sides get 0).
 */
export const bySortOrder = (a: TodoItem, b: TodoItem) =>
  (a.sortOrder - b.sortOrder) || ((a.id ?? 0) - (b.id ?? 0))

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
 * Root todos (no parentId) appear as parents sorted by sortOrder (or by `rootComparator` if provided).
 * Orphaned children (whose parent is not in the list) are promoted to root level.
 */
export function buildHierarchy(
  todos: PersistedTodoItem[],
  rootComparator: (a: PersistedTodoItem, b: PersistedTodoItem) => number = bySortOrder,
) {
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

  roots.sort(rootComparator)

  for (const [, children] of childrenOf) {
    children.sort(rootComparator)
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

/**
 * Expand a filter-pruned list by re-injecting any parents that are missing
 * from `visible` but have children in `visible`. The returned todos include
 * these "ghost parents" so callers render children under their real parent
 * instead of as orphaned roots, and so promote/demote logic sees the true
 * hierarchy. `ghostIds` identifies the injected items for dimmed styling /
 * interaction gating.
 *
 * `scope` should be the unfiltered list in the same logical scope (e.g. all
 * todos in the same project) — this is where missing parents are looked up.
 */
export function expandWithGhostParents(
  visible: PersistedTodoItem[],
  scope: PersistedTodoItem[],
): { todos: PersistedTodoItem[]; ghostIds: Set<number> } {
  const visibleIds = new Set<number>()
  for (const t of visible) visibleIds.add(t.id)

  const byId = new Map<number, PersistedTodoItem>()
  for (const t of scope) byId.set(t.id, t)

  const ghostIds = new Set<number>()
  const extras: PersistedTodoItem[] = []

  for (const t of visible) {
    let pid = t.parentId ?? null
    // Walk up the parent chain, injecting any hidden ancestor that still
    // exists in `scope`. Max 10 hops matches buildHierarchy's depth guard.
    for (let d = 0; d < 10 && pid != null; d++) {
      if (visibleIds.has(pid)) break
      const ancestor = byId.get(pid)
      if (!ancestor) break
      if (!ghostIds.has(ancestor.id)) {
        ghostIds.add(ancestor.id)
        extras.push(ancestor)
        visibleIds.add(ancestor.id)
      }
      pid = ancestor.parentId ?? null
    }
  }

  if (extras.length === 0) return { todos: visible, ghostIds }
  return { todos: [...visible, ...extras], ghostIds }
}

