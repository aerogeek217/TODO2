import type { TodoItem, PersistedTodoItem } from '../models'
import { buildChildMap, getFlatVisualOrder, bySortOrder } from '../utils/hierarchy'

// --- Types ---

export interface PlacementTarget {
  projectId: number
  parentId: number | undefined
  beforeTodoId: number | null // null = append at end
}

export interface TaskMutation {
  todoId: number
  changes: Partial<Pick<TodoItem, 'projectId' | 'parentId' | 'sortOrder'>>
}

// --- Helpers ---

/** Get siblings: tasks sharing the same parentId within a project */
function getSiblings(projectTodos: PersistedTodoItem[], parentId: number | undefined): PersistedTodoItem[] {
  return projectTodos
    .filter(t => (parentId == null ? t.parentId == null : t.parentId === parentId))
    .sort(bySortOrder)
}

// --- Core functions ---

/**
 * Compute sortOrder for inserting before a given sibling.
 * Uses midpoint between the target and its predecessor.
 * If beforeId is null, appends after the last sibling.
 */
export function computeInsertionSort(siblings: PersistedTodoItem[], beforeId: number | null): number {
  if (siblings.length === 0) return 1

  if (beforeId == null) {
    // Append at end
    return siblings[siblings.length - 1].sortOrder + 1
  }

  const idx = siblings.findIndex(t => t.id === beforeId)
  if (idx === -1) {
    // beforeId not found in siblings — append
    return siblings[siblings.length - 1].sortOrder + 1
  }

  if (idx === 0) {
    // Insert before first — use half of first item's sortOrder
    return siblings[0].sortOrder - 1
  }

  // Midpoint between predecessor and target
  return (siblings[idx - 1].sortOrder + siblings[idx].sortOrder) / 2
}

/**
 * Place a single task at a target position.
 * Returns mutations for the task itself plus any orphaned children.
 */
export function placeTaskAt(
  projectTodos: PersistedTodoItem[],
  task: PersistedTodoItem,
  target: PlacementTarget
): TaskMutation[] {
  const mutations: TaskMutation[] = []
  const isCrossProject = task.projectId !== target.projectId

  // Compute sortOrder among target siblings (excluding the task being moved)
  const targetSiblings = getSiblings(
    projectTodos.filter(t => t.id !== task.id),
    target.parentId
  )
  const sortOrder = computeInsertionSort(targetSiblings, target.beforeTodoId)

  const changes: TaskMutation['changes'] = { sortOrder }
  if (isCrossProject) changes.projectId = target.projectId
  if (target.parentId !== (task.parentId ?? undefined)) changes.parentId = target.parentId

  mutations.push({ todoId: task.id, changes })

  // Handle orphaned children when moving cross-project or changing parent
  if (isCrossProject || target.parentId !== (task.parentId ?? undefined)) {
    const orphans = findOrphans(projectTodos, task.id, task.projectId, new Set([task.id]))
    mutations.push(...orphans)
  }

  return mutations
}

/**
 * Place multiple tasks at a target position.
 * Preserves internal parent-child relationships when dropping at root level.
 * Flattens all under targetParent when dropping at child level.
 */
export function placeMultipleAt(
  allTodos: PersistedTodoItem[],
  taskIds: Set<number>,
  target: PlacementTarget
): TaskMutation[] {
  const mutations: TaskMutation[] = []

  // Get the tasks in visual order so they maintain relative position.
  // Group by source project first to prevent interleaving across projects.
  const projectTodos = allTodos.filter(t => t.projectId === target.projectId)
  const selected = allTodos.filter(t => taskIds.has(t.id))
    .sort((a, b) => {
      if (a.projectId !== b.projectId) return (a.projectId ?? 0) - (b.projectId ?? 0)
      return bySortOrder(a, b)
    })

  // Compute base sortOrder and step size
  const targetSiblings = getSiblings(
    projectTodos.filter(t => !taskIds.has(t.id)),
    target.parentId
  )
  const sortStart = computeInsertionSort(targetSiblings, target.beforeTodoId)

  // Find the ceiling (next sibling's sortOrder) to distribute evenly
  let sortCeiling: number
  if (target.beforeTodoId != null) {
    const beforeSibling = targetSiblings.find(t => t.id === target.beforeTodoId)
    sortCeiling = beforeSibling ? beforeSibling.sortOrder : sortStart + selected.length + 1
  } else {
    sortCeiling = sortStart + selected.length + 1
  }
  const rawStep = (sortCeiling - sortStart) / (selected.length + 1)
  const step = rawStep > 0 ? rawStep : 1

  let sort = sortStart
  for (const t of selected) {
    let newParentId: number | undefined
    if (target.parentId != null) {
      // Dropping at child level — flatten all under target parent
      newParentId = target.parentId
    } else {
      // Dropping at root level — preserve internal parent-child
      const keepParent = t.parentId != null && taskIds.has(t.parentId)
      newParentId = keepParent ? t.parentId : undefined
    }

    const changes: TaskMutation['changes'] = { sortOrder: sort }
    if (t.projectId !== target.projectId) changes.projectId = target.projectId
    if (newParentId !== (t.parentId ?? undefined)) changes.parentId = newParentId
    mutations.push({ todoId: t.id, changes })
    sort += step
  }

  // Handle orphans: children left behind when parents move cross-project
  for (const t of selected) {
    if (t.projectId !== target.projectId) {
      const orphans = findOrphans(allTodos, t.id, t.projectId, taskIds)
      mutations.push(...orphans)
    }
  }

  return mutations
}

/**
 * Indent tasks: make selected root tasks children of the root task above the group.
 * Returns empty array if indent is not possible (already children, no parent above, would create >2 levels).
 */
export function indentTasks(
  projectTodos: PersistedTodoItem[],
  taskIds: Set<number>
): TaskMutation[] {
  const selected = projectTodos
    .filter(t => taskIds.has(t.id) && t.parentId == null)
    .sort(bySortOrder)
  if (selected.length === 0) return []

  const childMap = buildChildMap(projectTodos)

  // Block if any selected root has children (would create >2 levels)
  if (selected.some(t => (childMap.get(t.id) ?? []).length > 0)) return []

  // Find the root task above the first selected task in visual order
  const flat = getFlatVisualOrder(projectTodos)
  const firstSelIdx = flat.findIndex(t => taskIds.has(t.id))
  if (firstSelIdx <= 0) return []

  let parentAbove: PersistedTodoItem | null = null
  for (let i = firstSelIdx - 1; i >= 0; i--) {
    if (flat[i].parentId == null && !taskIds.has(flat[i].id)) {
      parentAbove = flat[i]
      break
    }
  }
  if (!parentAbove) return []

  // Append after existing children of the parent
  const existingChildren = childMap.get(parentAbove.id) ?? []
  let maxSort = existingChildren.reduce((max, t) => Math.max(max, t.sortOrder), parentAbove.sortOrder)

  const mutations: TaskMutation[] = []
  for (const t of selected) {
    maxSort += 1
    mutations.push({
      todoId: t.id,
      changes: { parentId: parentAbove.id, sortOrder: maxSort },
    })
  }
  return mutations
}

/**
 * Outdent tasks: promote selected child tasks to root level.
 * Places them after their former parent's group in visual order.
 */
export function outdentTasks(
  projectTodos: PersistedTodoItem[],
  taskIds: Set<number>
): TaskMutation[] {
  const selected = projectTodos
    .filter(t => taskIds.has(t.id) && t.parentId != null)
    .sort(bySortOrder)
  if (selected.length === 0) return []

  const mutations: TaskMutation[] = []
  const promotingIds = new Set(selected.map(t => t.id))
  const childMap = buildChildMap(projectTodos)
  const roots = projectTodos.filter(t => t.parentId == null).sort(bySortOrder)

  // Group by parent to handle children from different parents
  const byParent = new Map<number, PersistedTodoItem[]>()
  for (const t of selected) {
    const list = byParent.get(t.parentId!) ?? []
    list.push(t)
    byParent.set(t.parentId!, list)
  }

  for (const [parentId, children] of byParent) {
    const parent = projectTodos.find(t => t.id === parentId)
    if (!parent) continue

    // Find sortOrder after the parent's group (parent + its remaining children)
    const parentChildren = childMap.get(parentId) ?? []
    const remaining = [parent, ...parentChildren].filter(t => !promotingIds.has(t.id))
    const maxGroupSort = remaining.reduce((max, t) => Math.max(max, t.sortOrder), -Infinity)

    // Find the next root after parent to compute midpoint
    const parentRootIdx = roots.findIndex(r => r.id === parentId)
    const nextRoot = parentRootIdx >= 0 ? roots[parentRootIdx + 1] : undefined
    const ceiling = nextRoot ? nextRoot.sortOrder : maxGroupSort + children.length + 1

    // Place promoted tasks between maxGroupSort and ceiling
    const step = (ceiling - maxGroupSort) / (children.length + 1)
    for (let i = 0; i < children.length; i++) {
      mutations.push({
        todoId: children[i].id,
        changes: { parentId: undefined, sortOrder: maxGroupSort + step * (i + 1) },
      })
    }
  }

  return mutations
}

/**
 * Move selected tasks up or down within a project.
 * Parents move with their children as a group.
 * Returns empty array if the move is not possible.
 */
export function moveTasksInDirection(
  projectTodos: PersistedTodoItem[],
  taskIds: Set<number>,
  direction: 'up' | 'down'
): TaskMutation[] {
  const flat = getFlatVisualOrder(projectTodos)
  if (flat.length === 0) return []

  const childMap = buildChildMap(projectTodos)

  // Expand selection to include children of selected parents
  const expandedIds = new Set(taskIds)
  for (const id of taskIds) {
    const children = childMap.get(id)
    if (children) {
      for (const c of children) expandedIds.add(c.id)
    }
  }

  // Find contiguous blocks of selected items in visual order
  const selectedIndices = flat.map((t, i) => expandedIds.has(t.id) ? i : -1).filter(i => i !== -1)
  if (selectedIndices.length === 0) return []

  const firstIdx = selectedIndices[0]
  const lastIdx = selectedIndices[selectedIndices.length - 1]

  if (direction === 'up') {
    if (firstIdx === 0) return []
    // Find the item above — if it's a child, we need to move above its parent group
    const above = flat[firstIdx - 1]
    let targetIdx = firstIdx - 1
    // If the item above is a child, find its parent to move above the whole group
    if (above.parentId != null) {
      const parentIdx = flat.findIndex(t => t.id === above.parentId)
      if (parentIdx !== -1) targetIdx = parentIdx
    }
    // Build new order: items before target, selected items, target group, gap, rest
    const targetGroup: PersistedTodoItem[] = []
    for (let i = targetIdx; i < firstIdx; i++) {
      if (!expandedIds.has(flat[i].id)) targetGroup.push(flat[i])
    }
    const selected = flat.filter(t => expandedIds.has(t.id))
    const before = flat.slice(0, targetIdx).filter(t => !expandedIds.has(t.id))
    const after = flat.slice(lastIdx + 1).filter(t => !expandedIds.has(t.id))
    // Non-selected tasks between first and last selected indices
    const gap: PersistedTodoItem[] = []
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (!expandedIds.has(flat[i].id)) gap.push(flat[i])
    }
    const newOrder = [...before, ...selected, ...targetGroup, ...gap, ...after]
    return buildReorderMutations(newOrder)
  } else {
    if (lastIdx >= flat.length - 1) return []
    // Find the item below — if it's a parent, include its children
    const below = flat[lastIdx + 1]
    let targetEndIdx = lastIdx + 1
    // If the item below is a parent with children, move below the whole group
    const belowChildren = childMap.get(below.id)
    if (belowChildren && belowChildren.length > 0) {
      const lastChild = belowChildren[belowChildren.length - 1]
      const lastChildIdx = flat.findIndex(t => t.id === lastChild.id)
      if (lastChildIdx !== -1) targetEndIdx = lastChildIdx
    }
    // Build new order: items before selected, gap, target group, selected items, rest
    const targetGroup: PersistedTodoItem[] = []
    for (let i = lastIdx + 1; i <= targetEndIdx; i++) {
      if (!expandedIds.has(flat[i].id)) targetGroup.push(flat[i])
    }
    const selected = flat.filter(t => expandedIds.has(t.id))
    const before = flat.slice(0, firstIdx).filter(t => !expandedIds.has(t.id))
    const after = flat.slice(targetEndIdx + 1).filter(t => !expandedIds.has(t.id))
    // Non-selected tasks between first and last selected indices
    const gap: PersistedTodoItem[] = []
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (!expandedIds.has(flat[i].id)) gap.push(flat[i])
    }
    const newOrder = [...before, ...gap, ...targetGroup, ...selected, ...after]
    return buildReorderMutations(newOrder)
  }
}

/** Build sortOrder mutations from a reordered flat list */
function buildReorderMutations(newOrder: PersistedTodoItem[]): TaskMutation[] {
  const mutations: TaskMutation[] = []
  for (let i = 0; i < newOrder.length; i++) {
    const newSort = i + 1
    if (newOrder[i].sortOrder !== newSort) {
      mutations.push({ todoId: newOrder[i].id, changes: { sortOrder: newSort } })
    }
  }
  return mutations
}

/**
 * Find children orphaned by moving a parent to a different project.
 * Returns mutations to clear their parentId.
 */
export function findOrphans(
  allTodos: PersistedTodoItem[],
  movedParentId: number,
  fromProjectId: number | undefined,
  excludeIds: Set<number>
): TaskMutation[] {
  return allTodos
    .filter(t =>
      t.parentId === movedParentId &&
      t.projectId === fromProjectId &&
      !excludeIds.has(t.id)
    )
    .map(t => ({
      todoId: t.id,
      changes: { parentId: undefined },
    }))
}

/**
 * Renumber sortOrders to clean integers preserving visual display order.
 * Returns mutations only for items that need updating.
 */
export function normalizeSortOrders(projectTodos: PersistedTodoItem[]): TaskMutation[] {
  const flat = getFlatVisualOrder(projectTodos)
  const mutations: TaskMutation[] = []
  for (let i = 0; i < flat.length; i++) {
    const order = i + 1
    if (flat[i].sortOrder !== order) {
      mutations.push({ todoId: flat[i].id, changes: { sortOrder: order } })
    }
  }
  return mutations
}

/**
 * Check if sortOrders have drifted enough to warrant normalization.
 * True when any fractional sortOrder exists or gap between consecutive items is extreme.
 */
export function shouldNormalize(projectTodos: PersistedTodoItem[]): boolean {
  if (projectTodos.length === 0) return false
  for (const t of projectTodos) {
    if (!Number.isInteger(t.sortOrder)) return true
  }
  const sorted = [...projectTodos].sort(bySortOrder)
  const max = sorted[sorted.length - 1].sortOrder
  // If max sortOrder is more than 3x the count, gaps are excessive
  return max > projectTodos.length * 3
}
