import { DEFAULT_NUMBER_BREAKDOWN } from '../models/glance-widgets'
import type { LayoutTab } from '../models/workspace-layout'

/**
 * A widget's face (D25 R): how much of it a cell has room for, picked from
 * the cell body's measured size — never stored, never a setting.
 *
 * - `small` — a glance: a title and one number (a body at most
 *   `SMALL_FACE_MAX_HEIGHT_PX` tall or `SMALL_FACE_MAX_WIDTH_PX` wide).
 * - `medium` — the number with a little behind it (a body at most
 *   `MEDIUM_FACE_MAX_HEIGHT_PX` tall).
 * - `large` — the whole widget.
 */
export type WidgetFace = 'small' | 'medium' | 'large'

/** A body this tall or shorter shows the small face. */
export const SMALL_FACE_MAX_HEIGHT_PX = 90
/** A body this narrow or narrower shows the small face. */
export const SMALL_FACE_MAX_WIDTH_PX = 180
/** A body this tall or shorter (and not small) shows the medium face. */
export const MEDIUM_FACE_MAX_HEIGHT_PX = 160

/**
 * The face for a body of `size`. Unmeasured (0 × 0: before the first layout,
 * or without ResizeObserver) is `large`, so nothing flashes small first.
 */
export function widgetFaceFor(size: { width: number; height: number }): WidgetFace {
  const { width, height } = size
  if (width <= 0 && height <= 0) return 'large'
  if (height <= SMALL_FACE_MAX_HEIGHT_PX || width <= SMALL_FACE_MAX_WIDTH_PX) return 'small'
  if (height <= MEDIUM_FACE_MAX_HEIGHT_PX) return 'medium'
  return 'large'
}

/**
 * A Review widget's body this tall or shorter (and not small) shows its medium face. Above it the large
 * face — the queue beside the card — shows, and both scroll: under about 530px the card has no room
 * for its columns to scroll inside (the top line, the prompt row, the title, the fact band, a line of
 * each column with the update line, and the footer), so its band and columns scroll as one
 * (`Review.module.css`, `review-card`). At this height the top line, the prompt row, the title and the
 * footer leave about 110px of card.
 */
export const REVIEW_MEDIUM_MAX_HEIGHT_PX = 320
/** A Review widget's body this narrow or narrower (and not small) shows its medium face: the card's two columns need it. */
export const REVIEW_MEDIUM_MAX_WIDTH_PX = 640

/**
 * Under this width (a Review widget's body) the queue column folds away and the
 * Queue button opens it as a popover: the queue's narrowest (220px) beside the card's
 * narrowest two-column layout (600px). Unmeasured (0) never folds.
 */
export const REVIEW_QUEUE_FOLD_PX = 820

/** Whether a review of `width` folds its queue away (`REVIEW_QUEUE_FOLD_PX`). */
export function reviewQueueFolds(width: number): boolean {
  return width > 0 && width < REVIEW_QUEUE_FOLD_PX
}

/**
 * A Review widget's face (item 12): small as every widget's; medium — the
 * card's essentials — while the body is too narrow for the card's two
 * columns or too short for the queue and a scrolling card
 * (`REVIEW_MEDIUM_MAX_*`); else large. Unmeasured is `large`.
 */
export function reviewFaceFor(size: { width: number; height: number }): WidgetFace {
  const face = widgetFaceFor(size)
  if (face !== 'large') return face
  const { width, height } = size
  if (width <= 0 && height <= 0) return 'large'
  return height <= REVIEW_MEDIUM_MAX_HEIGHT_PX || width <= REVIEW_MEDIUM_MAX_WIDTH_PX ? 'medium' : 'large'
}

/**
 * Whether a widget offers **Open larger** (its popup, drawn at its large
 * face) while its cell shows it at `face`. Every kind does but a Number,
 * which offers it only where its large face draws something `face` leaves
 * out: a count's breakdown (only the large face draws it); Share of…'s ring
 * and `N of M`, Oldest's caption, title and foot, Against a goal's state
 * and bar, and a group's item names (all missing from the small face only).
 * A Number that follows a list never does — its click opens that list.
 */
export function tabOpensLarger(tab: LayoutTab, face: WidgetFace): boolean {
  if (tab.kind !== 'number') return true
  if (face === 'large') return false
  const config = tab.config
  switch (config.show) {
    case 'count': return (config.breakdown ?? DEFAULT_NUMBER_BREAKDOWN) !== 'none'
    case 'list': return false
    default: return face === 'small'
  }
}

/** A task map's (Work clusters') body this short or shorter (and not small) shows its medium face: under it the map is too small to read. */
const TASK_MAP_MEDIUM_MAX_HEIGHT_PX = 280
/** A task map's body this narrow or narrower (and not small) shows its medium face. */
const TASK_MAP_MEDIUM_MAX_WIDTH_PX = 340

/**
 * A task map's face (2026-11-18): small as every widget's; medium — its
 * figures as rows — while the body is too small for the map to read
 * (`TASK_MAP_MEDIUM_MAX_*`); else large. Unmeasured is `large`.
 */
export function taskMapFaceFor(size: { width: number; height: number }): WidgetFace {
  const face = widgetFaceFor(size)
  if (face !== 'large') return face
  const { width, height } = size
  if (width <= 0 && height <= 0) return 'large'
  return height <= TASK_MAP_MEDIUM_MAX_HEIGHT_PX || width <= TASK_MAP_MEDIUM_MAX_WIDTH_PX ? 'medium' : 'large'
}

/** A Planner's body narrower than this (and not small) shows its medium face, one column: its two panes of task rows need the width. */
const PLANNER_PANES_MIN_WIDTH_PX = 720
/** A Planner's body shorter than this (and not small) shows its medium face: under it the strip leaves the panes no room. */
const PLANNER_PANES_MIN_HEIGHT_PX = 300

/**
 * A Planner's face (2026-11-20): small as every widget's; medium — one
 * column: Today, the days ahead, Delayed, Unplanned — while the body is too
 * narrow or too short for its two panes (`PLANNER_PANES_MIN_*`); else
 * large. Unmeasured is `large`.
 */
export function plannerFaceFor(size: { width: number; height: number }): WidgetFace {
  const face = widgetFaceFor(size)
  if (face === 'small') return face
  const { width, height } = size
  if (width <= 0 && height <= 0) return 'large'
  return width < PLANNER_PANES_MIN_WIDTH_PX || height < PLANNER_PANES_MIN_HEIGHT_PX ? 'medium' : 'large'
}

/** A Planner's body at least this tall (and narrower than the panes need) can take the portrait layout. */
const PLANNER_PORTRAIT_MIN_HEIGHT_PX = 560
/** …when it is at least this many times as tall as it is wide. */
const PLANNER_PORTRAIT_MIN_RATIO = 1.4

/**
 * Whether a Planner of `size` draws its medium face in the **portrait
 * layout** (board R1, 2026-11-21): the days scrolling on top, the trays
 * docked under them. A tall, narrow cell — under the panes' width
 * (`PLANNER_PANES_MIN_WIDTH_PX`), at least 560px tall and 1.4 × as tall
 * as wide. Unmeasured, no.
 */
export function plannerPortrait(size: { width: number; height: number }): boolean {
  const { width, height } = size
  return width > 0 && width < PLANNER_PANES_MIN_WIDTH_PX && height >= PLANNER_PORTRAIT_MIN_HEIGHT_PX && height >= width * PLANNER_PORTRAIT_MIN_RATIO
}

/**
 * The narrowest a strip's tile may be: its weekday (`WED`, about 26px), its
 * date with a one-digit count beside it, and room for five of its ticks
 * inside its 6px padding — the portrait layout's narrow tiles at 320px of
 * widget (measured).
 */
const PLANNER_TILE_MIN_PX = 38
/**
 * What the narrow strip takes besides its tiles and arrows: its padding
 * (2 × 8px), six gaps of 4px, and the week rule (1px, 2 × 2px margins) with
 * its own gap.
 */
const PLANNER_STRIP_FRAME_PX = 49
/** The two week arrows in the strip: 24px each, with a gap each. */
const PLANNER_STRIP_ARROWS_PX = 56
/** The strip's height (a narrow one: its tiles, its padding, its rule). */
const PLANNER_STRIP_HEIGHT_PX = 63
/** The top line's height, alone in its cell. */
const PLANNER_TOP_LINE_PX = 30
/** Today's heading (28px) and one row under it (a Stacked row, 44px: the tallest a narrow widget draws). */
const PLANNER_TODAY_ROW_PX = 72

/**
 * Whether a Planner of `size` draws its **strip**: every one of its seven
 * tiles has room for its ticks (`PLANNER_TILE_MIN_PX`, beside the arrows
 * when they are in the strip, `arrows`), and the widget is tall enough for
 * the strip over Today's heading and one row (with its top line,
 * `topLine`). Else the strip is hidden and the week's range and arrows sit
 * in the top line, or in a slim row. Unmeasured (0), it fits.
 */
export function plannerStripFits(size: { width: number; height: number }, room: { arrows: boolean; topLine: boolean }): boolean {
  const { width, height } = size
  if (width > 0 && width - PLANNER_STRIP_FRAME_PX - (room.arrows ? PLANNER_STRIP_ARROWS_PX : 0) < 7 * PLANNER_TILE_MIN_PX) return false
  return height <= 0 || height >= (room.topLine ? PLANNER_TOP_LINE_PX : 0) + PLANNER_STRIP_HEIGHT_PX + PLANNER_TODAY_ROW_PX
}

/** A Shortcuts body narrower than this (and not small) shows its rows face: a row per list. */
const SHORTCUTS_ROWS_MAX_WIDTH_PX = 360

/**
 * A Shortcuts face (2026-11-23): small as every widget's; medium while the
 * body is narrower than `SHORTCUTS_ROWS_MAX_WIDTH_PX` (its rows) or no
 * taller than `MEDIUM_FACE_MAX_HEIGHT_PX` (its compact line of tiles);
 * else large, a grid of tiles. Unmeasured is `large`.
 */
export function shortcutsFaceFor(size: { width: number; height: number }): WidgetFace {
  const face = widgetFaceFor(size)
  if (face !== 'large') return face
  const { width, height } = size
  if (width <= 0 && height <= 0) return 'large'
  return width < SHORTCUTS_ROWS_MAX_WIDTH_PX ? 'medium' : 'large'
}

/** What a Shortcuts face draws: its name line (small), a row per list, one line of tiles, or the grid of tiles. */
export type ShortcutsShape = 'small' | 'rows' | 'compact' | 'large'

/**
 * What Shortcuts draws at `face` in a body `width` wide: the medium face is
 * rows while narrower than `SHORTCUTS_ROWS_MAX_WIDTH_PX`, else the compact
 * line of tiles (a short body).
 */
export function shortcutsShape(face: WidgetFace, width: number): ShortcutsShape {
  if (face !== 'medium') return face
  return width > 0 && width < SHORTCUTS_ROWS_MAX_WIDTH_PX ? 'rows' : 'compact'
}
