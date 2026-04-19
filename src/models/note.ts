export interface Note {
  id?: number
  content: string
  createdAt: Date
  modifiedAt: Date
  /**
   * When set, the note is a canvas-pinned floating note shown inside the
   * referenced canvas. When null/undefined, the note is the "outside-tasks"
   * global note backing the dashboard tile and rail Notes slot.
   */
  canvasId?: number
  x?: number
  y?: number
  width?: number
  height?: number
  color?: string
}

export type PersistedNote = Note & { id: number }
