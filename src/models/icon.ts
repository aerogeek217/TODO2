/**
 * An icon a user picks (widget feedback items 11 and 14): one of the app's
 * own line icons by key, an emoji, or none. Stored on a widget tab (and, from
 * phase 3B, on a layout and a status); drawn by `components/shared/AppIcon`,
 * picked in `components/shared/IconPicker`.
 *
 * An emoji is **muted** unless it says otherwise (decision 15): drawn in one
 * color like a line icon — gray at rest, the color around it where a line
 * icon would take one (the accent on a cell's active tab, a layout's hue on
 * its open tab). `show: 'color'` keeps the emoji's own colors everywhere.
 * Nothing about emoji is bundled (decision 16): an emoji is checked by the
 * Unicode emoji property, never against a list (`isEmoji`).
 */

/** The built-in line icons, in the picker's order: the widget kinds' glyphs first, then a generic set (the icons board). */
export const LINE_ICON_KEYS = [
  'list', 'calendar', 'notes', 'review', 'number', 'chart', 'ring', 'bars', 'table', 'scatter',
  'layout', 'flag', 'check', 'person', 'at', 'hash', 'envelope', 'search', 'file', 'lock',
  'funnel', 'glasses', 'repeat', 'checklist', 'link',
] as const

export type LineIconKey = (typeof LINE_ICON_KEYS)[number]

/** Each line icon's name (its picker cell's accessible name and tooltip). */
export const LINE_ICON_LABELS: Readonly<Record<LineIconKey, string>> = {
  list: 'List', calendar: 'Calendar', notes: 'Notes', review: 'Review', number: 'Number', chart: 'Chart',
  ring: 'Ring', bars: 'Bars', table: 'Table', scatter: 'Scatter plot', layout: 'Layout', flag: 'Flag',
  check: 'Check', person: 'Person', at: 'At', hash: 'Hash', envelope: 'Envelope', search: 'Search',
  file: 'File', lock: 'Lock', funnel: 'Funnel', glasses: 'Glasses', repeat: 'Repeat', checklist: 'Checklist',
  link: 'Link',
}

export function isLineIconKey(v: unknown): v is LineIconKey {
  return typeof v === 'string' && (LINE_ICON_KEYS as readonly string[]).includes(v)
}

/** How an emoji is drawn: muted (one color, the default) or in its own colors. */
export type EmojiShow = 'muted' | 'color'

/**
 * A picked icon. Absent where it is stored = never picked (a widget tab then
 * shows its kind's icon, J1); `{ kind: 'none' }` = No icon, picked.
 * An emoji's `show` is stored only as `'color'`; absent = muted.
 */
export type IconValue =
  | { kind: 'none' }
  | { kind: 'line'; key: LineIconKey }
  | { kind: 'emoji'; emoji: string; show?: 'color' }

/** The longest stored emoji (UTF-16 units): a family ZWJ sequence is about 11; anything near this isn't one grapheme of emoji. */
const EMOJI_MAX_LEN = 32

/** `\p{RGI_Emoji}` (a whole string) where the `v` flag is supported, else null. */
const RGI_EMOJI: RegExp | null = (() => {
  try {
    return new RegExp('^\\p{RGI_Emoji}$', 'v')
  } catch {
    return null
  }
})()

/** The fallback without the `v` flag: a pictograph, a flag (two regional indicators) or a keycap. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|⃣/u

/** The graphemes of `text` (user-perceived characters). */
export function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment)
  }
  return Array.from(text)
}

/** Whether one grapheme `g` is an emoji (J7): the Unicode emoji property, no list. */
function isEmojiGrapheme(g: string): boolean {
  if (RGI_EMOJI) return RGI_EMOJI.test(g)
  return PICTOGRAPHIC.test(g)
}

/**
 * `text` as a stored emoji (J7): exactly one grapheme that is an emoji —
 * with the emoji variation selector added when only that makes it one (a
 * text-style ☺ pasted bare) —, else null.
 */
export function asEmoji(text: string): string | null {
  if (text.length === 0 || text.length > EMOJI_MAX_LEN) return null
  const parts = graphemes(text)
  if (parts.length !== 1) return null
  if (isEmojiGrapheme(text)) return text
  const presented = `${text}️`
  return !text.endsWith('️') && isEmojiGrapheme(presented) ? presented : null
}

/** Whether `text` is one emoji as stored (`asEmoji` keeps it as it is). */
export function isEmoji(text: unknown): text is string {
  return typeof text === 'string' && asEmoji(text) === text
}

/**
 * What arrived in the emoji field (decision 16): the one emoji in it, the
 * rest of the text dropped (Windows' panel can leave the letters typed into
 * its search) — `{ emoji }`; `{ problem }` when it holds more than one emoji;
 * `null` when it holds none.
 */
export function emojiFromField(text: string): { emoji: string } | { problem: string } | null {
  const found = graphemes(text).flatMap((g) => {
    const e = asEmoji(g)
    return e ? [e] : []
  })
  if (found.length === 0) return null
  const [first] = found
  if (found.length > 1 || first == null) return { problem: 'Pick one emoji at a time.' }
  return { emoji: first }
}

/** An icon value as stored: a known kind, a known line key, one emoji and a known `show`. */
export function isIconValue(v: unknown): v is IconValue {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  switch (o.kind) {
    case 'none':
      return true
    case 'line':
      return isLineIconKey(o.key)
    case 'emoji':
      return isEmoji(o.emoji) && (o.show === undefined || o.show === 'muted' || o.show === 'color')
    default:
      return false
  }
}

/** A stored icon with only the model's keys (`show: 'muted'` dropped: it is the default); `undefined` for one that doesn't read. */
export function pickIconValue(v: unknown): IconValue | undefined {
  if (!isIconValue(v)) return undefined
  switch (v.kind) {
    case 'none':
      return { kind: 'none' }
    case 'line':
      return { kind: 'line', key: v.key }
    case 'emoji':
      return v.show === 'color' ? { kind: 'emoji', emoji: v.emoji, show: 'color' } : { kind: 'emoji', emoji: v.emoji }
  }
}

/** An emoji icon of `emoji`, shown as `show`. */
export function emojiIcon(emoji: string, show: EmojiShow = 'muted'): IconValue {
  return show === 'color' ? { kind: 'emoji', emoji, show: 'color' } : { kind: 'emoji', emoji }
}

/** How an emoji icon is shown (`muted` unless it says `color`). */
export function emojiShow(icon: Extract<IconValue, { kind: 'emoji' }>): EmojiShow {
  return icon.show === 'color' ? 'color' : 'muted'
}

/** Whether two icon values are the same (absent counts as its own value). */
export function sameIcon(a: IconValue | undefined, b: IconValue | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'line' && b.kind === 'line') return a.key === b.key
  if (a.kind === 'emoji' && b.kind === 'emoji') return a.emoji === b.emoji && emojiShow(a) === emojiShow(b)
  return true
}

/** An icon in words, for a control's label: `No icon`, `Flag icon`, `Emoji 📅, muted`. */
export function iconDescription(icon: IconValue): string {
  switch (icon.kind) {
    case 'none':
      return 'No icon'
    case 'line':
      return `${LINE_ICON_LABELS[icon.key]} icon`
    case 'emoji':
      return `Emoji ${icon.emoji}, ${emojiShow(icon)}`
  }
}

/** An icon's kind and style in a few words, beside its button (the board's `Emoji · Muted`). */
export function iconSummary(icon: IconValue): string {
  switch (icon.kind) {
    case 'none':
      return 'No icon'
    case 'line':
      return `Icon · ${LINE_ICON_LABELS[icon.key]}`
    case 'emoji':
      return `Emoji · ${emojiShow(icon) === 'color' ? 'Color' : 'Muted'}`
  }
}

/**
 * The emoji used in `icons` (J6, the picker's Recent): each once, in the
 * order first met, at most `limit`. Callers pass every icon the app's data
 * holds (widget tabs now; layouts and statuses from 3B).
 */
export function recentEmoji(icons: Iterable<IconValue | undefined>, limit = 24): string[] {
  const out: string[] = []
  for (const icon of icons) {
    if (icon?.kind !== 'emoji' || out.includes(icon.emoji)) continue
    out.push(icon.emoji)
    if (out.length >= limit) break
  }
  return out
}
