import type { TaskboardEntry } from './taskboard-entry'

/**
 * A reusable queue of tasks. Referenced by rail slots, floating canvas
 * widgets, and (today, implicitly) the dashboard card by id. The shared
 * entries list means multiple surfaces can show the same queue live.
 *
 * Entries live inline rather than in a separate join table — every mutation
 * rewrites the row, which is cheap at the queue sizes we expect (tens).
 */
export interface Taskboard {
  id?: number
  name: string
  entries: TaskboardEntry[]
  createdAt: Date
  updatedAt: Date
}

export type PersistedTaskboard = Taskboard & { id: number }
