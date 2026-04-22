import type { TodoItem, PersistedTodoItem } from '../models'
import { bySortOrder } from '../utils/hierarchy'

// --- Types ---

export interface PlacementTarget {
  projectId: number
  beforeTodoId: number | null // null = append at end
}

export interface TaskMutation {
  todoId: number
  changes: Partial<Pick<TodoItem, 'projectId' | 'sortOrder'>>
}

// --- Helpers ---

/** Get all tasks in a project, sorted. */
function getSiblings(projectTodos: PersistedTodoItem[]): PersistedTodoItem[] {
  return [...projectTodos].sort(bySortOrder)
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
    return siblings[siblings.length - 1].sortOrder + 1
  }

  const idx = siblings.findIndex(t => t.id === beforeId)
  if (idx === -1) {
    return siblings[siblings.length - 1].sortOrder + 1
  }

  if (idx === 0) {
    return siblings[0].sortOrder - 1
  }

  return (siblings[idx - 1].sortOrder + siblings[idx].sortOrder) / 2
}

/**
 * Place a single task at a target position.
 */
export function placeTaskAt(
  projectTodos: PersistedTodoItem[],
  task: PersistedTodoItem,
  target: PlacementTarget
): TaskMutation[] {
  const isCrossProject = task.projectId !== target.projectId
  const targetSiblings = getSiblings(projectTodos.filter(t => t.id !== task.id))
  const sortOrder = computeInsertionSort(targetSiblings, target.beforeTodoId)

  const changes: TaskMutation['changes'] = { sortOrder }
  if (isCrossProject) changes.projectId = target.projectId

  return [{ todoId: task.id, changes }]
}

/**
 * Place multiple tasks at a target position. The selected set is inserted in
 * visual order starting at the target index.
 */
export function placeMultipleAt(
  allTodos: PersistedTodoItem[],
  taskIds: Set<number>,
  target: PlacementTarget
): TaskMutation[] {
  const mutations: TaskMutation[] = []

  const projectTodos = allTodos.filter(t => t.projectId === target.projectId)
  const selected = allTodos.filter(t => taskIds.has(t.id))
    .sort((a, b) => {
      if (a.projectId !== b.projectId) return (a.projectId ?? 0) - (b.projectId ?? 0)
      return bySortOrder(a, b)
    })

  const targetSiblings = getSiblings(projectTodos.filter(t => !taskIds.has(t.id)))
  const sortStart = computeInsertionSort(targetSiblings, target.beforeTodoId)

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
    const changes: TaskMutation['changes'] = { sortOrder: sort }
    if (t.projectId !== target.projectId) changes.projectId = target.projectId
    mutations.push({ todoId: t.id, changes })
    sort += step
  }

  return mutations
}

/**
 * Renumber sortOrders to clean integers preserving visual display order.
 * Returns mutations only for items that need updating.
 */
export function normalizeSortOrders(projectTodos: PersistedTodoItem[]): TaskMutation[] {
  const sorted = [...projectTodos].sort(bySortOrder)
  const mutations: TaskMutation[] = []
  for (let i = 0; i < sorted.length; i++) {
    const order = i + 1
    if (sorted[i].sortOrder !== order) {
      mutations.push({ todoId: sorted[i].id, changes: { sortOrder: order } })
    }
  }
  return mutations
}

/**
 * Check if sortOrders have drifted enough to warrant normalization.
 */
export function shouldNormalize(projectTodos: PersistedTodoItem[]): boolean {
  if (projectTodos.length === 0) return false
  for (const t of projectTodos) {
    if (!Number.isInteger(t.sortOrder)) return true
  }
  const sorted = [...projectTodos].sort(bySortOrder)
  const max = sorted[sorted.length - 1].sortOrder
  return max > projectTodos.length * 3
}
