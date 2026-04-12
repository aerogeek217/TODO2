export interface Org {
  id?: number
  name: string
  initials?: string
  color?: string
}

/** Org with guaranteed id (post-insert from DB) */
export type PersistedOrg = Org & { id: number }
