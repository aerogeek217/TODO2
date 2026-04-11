export interface Person {
  id?: number
  name: string
  initials: string
  color: string
}

/** Person with guaranteed id (post-insert from DB) */
export type PersistedPerson = Person & { id: number }
