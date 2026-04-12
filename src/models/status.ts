export interface Status {
  id?: number
  name: string
  color: string
  sortOrder: number
}

/** Status with guaranteed id (post-insert from DB) */
export type PersistedStatus = Status & { id: number }
