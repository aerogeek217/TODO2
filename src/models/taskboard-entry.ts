/**
 * A single ordered slot within a `Taskboard`. Stored inline on the Taskboard
 * row (no separate table), so there is no row id — sortOrder + todoId together
 * uniquely locate an entry within a given board.
 */
export interface TaskboardEntry {
  todoId: number
  sortOrder: number
}
