export interface Person {
  id?: number
  name: string
  initials: string
  /** Avatar fill (hex). Absent = the neutral default. */
  color?: string
  /** Email address (trimmed; absent = none). Used for email check-ins. */
  email?: string
}

/** Person with guaranteed id (post-insert from DB) */
export type PersistedPerson = Person & { id: number }
