/**
 * The desktop task row's columns: one grid track per field, the same tracks
 * for every row of a list (pure layout math; the row list measures its width
 * and hands the result to its rows).
 *
 *   gutter · checkbox · title │ notes · people · tags · due · follow-up · status · ⋯
 *
 * The **details width** D is the notes … ⋯ tracks plus the gaps between them;
 * the title takes the rest. Only people and tags flex: F = P + T is what is
 * left of D after the fixed tracks. Squeezed, tags give way first (removed
 * below `SPLIT_MIN`, people takes their room), then people (removed below
 * `PEOPLE_MIN`). Due, follow-up, status, notes and ⋯ never shrink.
 */

/** Track widths and spacing, px. */
export const TASK_ROW = {
  gutter: 5,
  checkbox: 18,
  /** The title never gets narrower than this while the details can give way. */
  titleMin: 80,
  notes: 16,
  due: 46,
  /** The due track in a list narrower than `NARROW_LIST_WIDTH`. */
  dueNarrow: 40,
  followup: 18,
  status: 20,
  more: 18,
  gap: 5,
  padLeft: 6,
  padRight: 8,
} as const

/** Below this list width the due track narrows to `TASK_ROW.dueNarrow`. */
export const NARROW_LIST_WIDTH = 360

/** The details width nothing is stored for. */
export const DEFAULT_DETAILS_WIDTH = 262

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
  due: number
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
  const due = listWidth < NARROW_LIST_WIDTH ? TASK_ROW.dueNarrow : TASK_ROW.due
  const fixed = [TASK_ROW.notes, due, TASK_ROW.followup, TASK_ROW.status, TASK_ROW.more]
  const fixedSum = fixed.reduce((sum, t) => sum + t, 0)
  const minDetails = span(fixed)
  const inner = listWidth - TASK_ROW.padLeft - TASK_ROW.padRight
  const maxDetails = Math.max(minDetails, inner - LEAD - TASK_ROW.titleMin)
  const details = Math.round(clamp(stored ?? DEFAULT_DETAILS_WIDTH, minDetails, maxDetails))

  let people = 0
  let tags = 0
  const f = details - fixedSum - TASK_ROW.gap * 6
  if (f >= SPLIT_MIN) {
    people = clamp(Math.round(f * PEOPLE_SHARE), PEOPLE_MIN, PEOPLE_MAX)
    tags = f - people
  } else if (f + TASK_ROW.gap >= PEOPLE_MIN) {
    // Tags removed: people takes F plus the gap tags had.
    people = f + TASK_ROW.gap
  }

  const detailTracks = [TASK_ROW.notes, ...(people ? [people] : []), ...(tags ? [tags] : []), due, TASK_ROW.followup, TASK_ROW.status, TASK_ROW.more]
  const template = [`${TASK_ROW.gutter}px`, `${TASK_ROW.checkbox}px`, 'minmax(0, 1fr)', ...detailTracks.map((t) => `${t}px`)].join(' ')
  return { template, details, laidOut: span(detailTracks), minDetails, maxDetails, people, tags, due }
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
