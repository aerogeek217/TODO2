export interface Tag {
  id?: number
  name: string
  color: string
}

/** Tag with guaranteed id (post-insert from DB) */
export type PersistedTag = Tag & { id: number }
