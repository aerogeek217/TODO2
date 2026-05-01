export const STATUS_ICON_KEYS = [
  'person', 'message-bubble', 'circle', 'star', 'stop-sign', 'exclamation',
  'clock', 'check', 'question', 'flag', 'eye', 'bookmark', 'snooze', 'arrow',
  'calendar',
] as const
export type StatusIconKey = (typeof STATUS_ICON_KEYS)[number]

/** Fallback icon when a Status row has none. Sites that read `status.icon` for
 *  rendering should default to this rather than re-stringing 'circle'. */
export const DEFAULT_STATUS_ICON: StatusIconKey = 'circle'

export interface Status {
  id?: number
  name: string
  color: string
  sortOrder: number
  icon?: StatusIconKey
  hideByDefault?: boolean
}

/** Status with guaranteed id (post-insert from DB) */
export type PersistedStatus = Status & { id: number }
