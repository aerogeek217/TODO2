import { LINE_ICON_KEYS, LINE_ICON_LABELS, statusGlyphLabel, type DrawnIcon } from '../../models/icon'
import { STATUS_ICON_KEYS } from '../../models/status'

/** One choice in the Icons tab: the icon it picks and its name. */
export interface IconChoice {
  value: DrawnIcon
  label: string
}

/** The built-in line icons as choices (the Icons tab's default). */
export const LINE_ICON_CHOICES: readonly IconChoice[] = LINE_ICON_KEYS.map((key) => ({ value: { kind: 'line', key }, label: LINE_ICON_LABELS[key] }))

/** The status glyphs as choices (J17: the status editor's Icons tab). */
export const STATUS_GLYPH_CHOICES: readonly IconChoice[] = STATUS_ICON_KEYS.map((key) => ({ value: { kind: 'status', key }, label: statusGlyphLabel(key) }))

/** The emoji field's hint for the platform (J8): its emoji panel's shortcut; none on touch. */
export function emojiFieldHint(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): string {
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches
  if (!nav || coarse) return 'Paste an emoji'
  const platform = `${nav.platform} ${nav.userAgent}`
  if (/Win/i.test(platform)) return 'Win + . to pick an emoji, or paste one'
  if (/Mac/i.test(platform) && nav.maxTouchPoints < 2) return '⌃⌘Space to pick an emoji, or paste one'
  return 'Paste an emoji'
}
