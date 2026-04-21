import type { TaskboardEntry } from './taskboard-entry'

/**
 * A singleton queue of tasks. Referenced by the dashboard card, rail slots,
 * and floating canvas widgets — each surface is a *view* of the same single
 * record. Entries live inline (rewritten per mutation) rather than in a
 * separate join table.
 */
export interface Taskboard {
  id?: number
  entries: TaskboardEntry[]
  createdAt: Date
  updatedAt: Date
}

export type PersistedTaskboard = Taskboard & { id: number }
