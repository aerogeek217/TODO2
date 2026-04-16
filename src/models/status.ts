export interface Status {
  id?: number
  name: string
  color: string
  sortOrder: number
  icon?: string
  hideByDefault?: boolean
}

/** Status with guaranteed id (post-insert from DB) */
export type PersistedStatus = Status & { id: number }
