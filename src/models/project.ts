import type { TodoGroupBy } from './todo-sort-group'

/** Alias of the unified `TodoGroupBy` (post ui-consistency-2026-04-25 P4).
 *  `Project.groupBy` keeps `null` as the sentinel for "no grouping" — surfaces
 *  that need a string sentinel map `null ↔ 'none'` at their boundary. */
export type ProjectGroupBy = TodoGroupBy

export interface Project {
  id?: number
  name: string
  canvasId: number
  positionX: number
  positionY: number
  width?: number
  isCollapsed: boolean
  color?: string
  sortOrder: number
  createdAt: Date
  groupBy?: ProjectGroupBy | null
  groupOrder?: string[]
}
