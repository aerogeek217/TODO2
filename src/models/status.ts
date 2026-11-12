export const STATUS_ICON_KEYS = [
  'person', 'message-bubble', 'circle', 'star', 'stop-sign', 'exclamation',
  'clock', 'check', 'question', 'flag', 'eye', 'bookmark', 'snooze', 'arrow',
  'calendar', 'sparkle', 'lightbulb', 'person-arrow', 'pause-circle',
  'person-circle', 'pushpin',
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
  /** Its glyph (absent: `DEFAULT_STATUS_ICON`). Kept while an emoji is picked, so a build that knows no emoji still draws a glyph. */
  icon?: StatusIconKey
  /**
   * An emoji drawn instead of the glyph (widget feedback J17; one emoji, as
   * `models/icon.isEmoji` reads it). Absent: the glyph. Muted (drawn in the
   * status's color, as the glyph is) unless `emojiShow` is `'color'`.
   */
  emoji?: string
  /** `'color'`: the emoji in its own colors. Absent: muted. Only with `emoji`. */
  emojiShow?: 'color'
}

/** What a status is drawn with: its glyph, or the emoji that replaces it. */
export type StatusLook = Pick<Status, 'icon' | 'emoji' | 'emojiShow'>

/** Status with guaranteed id (post-insert from DB) */
export type PersistedStatus = Status & { id: number }
