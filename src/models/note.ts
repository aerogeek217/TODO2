/**
 * The single "outside-tasks" global note, shown by every notes widget.
 */
export interface Note {
  id?: number
  content: string
  createdAt: Date
  modifiedAt: Date
}

export type PersistedNote = Note & { id: number }
