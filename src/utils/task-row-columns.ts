/**
 * The desktop task row's columns: one grid track per field, the same tracks
 * for every row of a list (pure layout math; the row list measures its width
 * and hands the result to its rows).
 *
 *   gutter · checkbox · title │ notes · people · tags · dates · status
 *
 * The **details width** D is the notes … status tracks plus the gaps between them;
 * the title takes the rest (D is capped by the list's width: the title keeps
 * its minimum). Notes and status never shrink; people and tags flex: F = P + T
 * is what is left of D after the fixed tracks. As D shrinks, people and tags
 * shrink to their split minimum (`SPLIT_MIN`), then the dates give way — the
 * widest of `DATES_TIERS` that still leaves people and tags that minimum: the
 * follow-up's date goes first (its flag stays), then the due date's (its
 * clock stays); a dropped date is in the part's tooltip — and only then do
 * the tags go (people takes their room), then people (below `PEOPLE_MIN`).
 * So a divider drag can change the dates as well as the people / tags.
 */

/**
 * The `MM/DD` text's width in the row's meta font (12px, tabular figures),
 * px: measured in the app font (34; the system fallbacks are narrower).
 */
const DATE_TEXT = 34
/** A date part's icon (1em of the meta font), px — the placeholder, or the repeat glyph before a repeating task's date. */
const DATE_ICON = 12
/** The padding each side of a part's date, px. */
const DATE_TEXT_PAD = 6
/** The gap between the due part and the follow-up part, px. */
const DATE_PARTS_GAP = 2

/**
 * One date part's width: the `MM/DD` text alone (6 + 34 + 6 = 46 — a set
 * date shows no clock / flag beside it), or an icon alone (the absent-date
 * placeholder, the icon-only tier). A repeating task's due part draws the
 * repeat glyph before its date and takes `REPEAT_DATE_PART` instead.
 */
function datePart(withDate: boolean): number {
  return withDate ? DATE_TEXT_PAD + DATE_TEXT + DATE_TEXT_PAD : 18
}

/**
 * A repeating task's due part with its date at its natural width: the
 * repeat glyph, the gap and the date (58). The tracks are the same for every
 * row of a list, so the part keeps `datePart(true)` (46): its glyph is drawn
 * smaller (10px) in the padding's room (`.dueRepeat`).
 */
export const REPEAT_DATE_PART = datePart(true) + DATE_ICON

/** Which dates the dates track shows beside their icons. */
export type DatesTier = 'both' | 'due' | 'icons'

/** The dates track per tier, widest first, px. */
export const DATES_TIERS: Readonly<Record<DatesTier, number>> = {
  both: datePart(true) + DATE_PARTS_GAP + datePart(true),
  due: datePart(true) + DATE_PARTS_GAP + datePart(false),
  icons: datePart(false) + DATE_PARTS_GAP + datePart(false),
}

const TIER_ORDER: readonly DatesTier[] = ['both', 'due', 'icons']

/** The due part's and the follow-up part's widths in a tier, and the gap between them, px. */
export function datesParts(tier: DatesTier): { due: number; followup: number; gap: number } {
  return { due: datePart(tier !== 'icons'), followup: datePart(tier === 'both'), gap: DATE_PARTS_GAP }
}

/** Track widths and spacing, px. */
export const TASK_ROW = {
  gutter: 5,
  checkbox: 18,
  /** The title never gets narrower than this while the details can give way. */
  titleMin: 80,
  notes: 16,
  status: 20,
  gap: 5,
  padLeft: 6,
  padRight: 8,
} as const

/** The details width nothing is stored for. */
export const DEFAULT_DETAILS_WIDTH = 300

/** F below this removes the tags track. */
const SPLIT_MIN = 56
/** The narrowest people track; below it people is removed too. */
const PEOPLE_MIN = 22
/** The widest people track while tags share F. */
const PEOPLE_MAX = 64
/** People's share of F while tags share it. */
const PEOPLE_SHARE = 0.4

/** Gutter + checkbox and the gaps after them and after the title. */
const LEAD = TASK_ROW.gutter + TASK_ROW.checkbox + 3 * TASK_ROW.gap

export interface TaskRowColumns {
  /** `grid-template-columns` for every row of the list. */
  template: string
  /** The details width in use: the stored (or default) value clamped to `minDetails` … `maxDetails`. */
  details: number
  /** The details width as laid out (smaller than `details` once people and tags are both removed). */
  laidOut: number
  minDetails: number
  maxDetails: number
  /** People track, px; 0 = removed. */
  people: number
  /** Tags track, px; 0 = removed. */
  tags: number
  /** The dates track, px. */
  dates: number
  /** Which dates show beside their icons. */
  datesTier: DatesTier
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Sum of tracks plus the gaps between them. */
function span(tracks: readonly number[]): number {
  return tracks.reduce((sum, t) => sum + t, 0) + TASK_ROW.gap * Math.max(0, tracks.length - 1)
}

/**
 * The columns for rows `listWidth` wide (the row's border box) with the
 * stored details width (`undefined` = the default). A stored value outside
 * the bounds is clamped here; the stored value itself is kept, so a list
 * that widens again gets it back.
 */
export function taskRowColumns(listWidth: number, stored?: number): TaskRowColumns {
  const inner = listWidth - TASK_ROW.padLeft - TASK_ROW.padRight
  /** The most the details can get in this list: the title keeps its minimum. */
  const room = inner - LEAD - TASK_ROW.titleMin
  // The narrowest details: the dates as icons, people and tags removed.
  const minDetails = span([TASK_ROW.notes, DATES_TIERS.icons, TASK_ROW.status])
  const maxDetails = Math.max(minDetails, room)
  const details = Math.round(clamp(stored ?? DEFAULT_DETAILS_WIDTH, minDetails, maxDetails))

  // The widest dates track that leaves people and tags their split at D.
  const datesTier = TIER_ORDER.find((tier) => flex(details, DATES_TIERS[tier]) >= SPLIT_MIN) ?? 'icons'
  const dates = DATES_TIERS[datesTier]
  let people = 0
  let tags = 0
  const f = flex(details, dates)
  if (f >= SPLIT_MIN) {
    people = clamp(Math.round(f * PEOPLE_SHARE), PEOPLE_MIN, PEOPLE_MAX)
    tags = f - people
  } else if (f + TASK_ROW.gap >= PEOPLE_MIN) {
    // Tags removed: people takes F plus the gap tags had.
    people = f + TASK_ROW.gap
  }

  const detailTracks = [TASK_ROW.notes, ...(people ? [people] : []), ...(tags ? [tags] : []), dates, TASK_ROW.status]
  const template = [`${TASK_ROW.gutter}px`, `${TASK_ROW.checkbox}px`, 'minmax(0, 1fr)', ...detailTracks.map((t) => `${t}px`)].join(' ')
  return { template, details, laidOut: span(detailTracks), minDetails, maxDetails, people, tags, dates, datesTier }
}

/** F: what people and tags share of details `d` beside a dates track `dates` wide (the gaps between the five tracks taken). */
function flex(d: number, dates: number): number {
  return d - fixedSum(dates) - TASK_ROW.gap * 4
}

/** The tracks that never flex (notes, the dates, status), without gaps. */
function fixedSum(dates: number): number {
  return TASK_ROW.notes + dates + TASK_ROW.status
}

/** Avatar size, the step between overlapping avatars and the `+N` text's width, px. */
export const AVATAR = { size: 16, step: 12, more: 16 } as const
/** A cell's horizontal padding (both sides), px. */
export const CELL_PADDING = 6

export interface PeopleFit {
  /** Avatars shown. */
  shown: number
  /** People not shown. */
  more: number
  /** The `+N` sits on the last avatar's corner (no room for it beside the avatars). */
  badge: boolean
}

/**
 * How many of `count` avatars fit a people track `track` px wide: as many
 * as fit, then `+N`; when only one avatar fits and `+N` doesn't, the count
 * becomes a badge on its corner. At least one avatar shows.
 */
export function peopleFit(count: number, track: number): PeopleFit {
  if (count <= 0) return { shown: 0, more: 0, badge: false }
  const room = track - CELL_PADDING
  const width = (n: number) => AVATAR.size + (n - 1) * AVATAR.step
  let shown = 1
  while (shown < count && width(shown + 1) + (shown + 1 < count ? AVATAR.more : 0) <= room) shown++
  const more = count - shown
  const badge = more > 0 && width(shown) + AVATAR.more > room
  return { shown, more, badge }
}

/** The gap between tags in the tags cell, px. */
export const TAG_GAP = 5

export interface TagsFit {
  /** Tags shown (the last may ellipsize). */
  shown: number
  /** Tags not shown (`+N`). */
  more: number
}

/**
 * How many tags fit a tags track `track` px wide, given each tag's text
 * width (`#name`) and the width of `+N` text: whole tags while they fit with
 * room for `+N` when more follow; at least one tag shows (ellipsized when it
 * doesn't fit).
 */
export function tagsFit(widths: readonly number[], track: number, moreWidth: (n: number) => number): TagsFit {
  const room = track - CELL_PADDING
  let used = 0
  let shown = 0
  for (let i = 0; i < widths.length; i++) {
    const w = (widths[i] ?? 0) + (shown > 0 ? TAG_GAP : 0)
    const rest = widths.length - i - 1
    const moreW = rest > 0 ? TAG_GAP + moreWidth(rest) : 0
    if (shown > 0 && used + w + moreW > room) break
    used += w
    shown++
  }
  return { shown, more: widths.length - shown }
}
