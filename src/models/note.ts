/**
 * The single "outside-tasks" global note. Backs the dashboard Notes tile, the
 * rail Notes slot, and every canvas `FloatingNote` (which is a placement-only
 * widget that views this same content).
 */
export interface Note {
  id?: number
  content: string
  createdAt: Date
  modifiedAt: Date
}

export type PersistedNote = Note & { id: number }
