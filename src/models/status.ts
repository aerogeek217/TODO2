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

export const STATUS_ICON_KEYS = [
  'person', 'message-bubble', 'circle', 'star', 'stop-sign', 'exclamation',
  'clock', 'check', 'question', 'flag', 'eye', 'bookmark', 'snooze', 'arrow',
  'calendar',
] as const
export type StatusIconKey = (typeof STATUS_ICON_KEYS)[number]
