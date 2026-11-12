import { isListZoom, LIST_ZOOMS, type ListZoom } from '../models/workspace-layout'
import type { TodoItem } from '../models/todo-item'
import { formatRowDate } from './date'
import { isDeadlinePast } from './effective-date'
import { formatFollowupDate, isFollowupOverdue } from './followup'
import { dueState, followupState } from './row-date-state'
import type { RowDates } from './row-dates'
import { isStale, staleTooltipLine } from './stale'
import { describeSubtaskCount, type SubtaskCount } from './subtasks'
import type { UrgentDueWithinDays } from './urgency'

/**
 * A list tab's zoom (D25 C + I1; `models/workspace-layout.ListZoom`): the
 * step between levels, the Settings default and what the compact levels
 * draw for a task.
 *
 * Settings › Appearance › Default list zoom is the level of a tab that hasn't
 * picked one — Auto (the default, never stored) or a level. A level is stored in the `rowDensity` row (the two densities
 * before the levels, `comfortable` and `compact`, v79 wrote as `stacked` and `rows`).
 * The phone's rows have one density.
 */

/**
 * Settings › Appearance › Default list zoom: a level, or **Auto** — Stacked
 * in a narrow list, Rows in a wide one (`autoListZoom`). Auto is never
 * stored: it is the absent `rowDensity` row (the default), so an older build
 * reads it as Rows.
 */
export type ListZoomSetting = ListZoom | 'auto'

/** The Default list zoom's choices, as Settings offers them. */
export const LIST_ZOOM_SETTINGS: readonly ListZoomSetting[] = ['auto', 'stacked', 'rows', 'lines']

/** The Default list zoom with no `rowDensity` row stored. */
export const DEFAULT_LIST_ZOOM: ListZoomSetting = 'auto'

/** The level Auto shows while the list's width isn't measured (first paint, JSDOM). */
export const UNMEASURED_LIST_ZOOM: ListZoom = 'rows'

export function isListZoomSetting(v: unknown): v is ListZoomSetting {
  return v === 'auto' || isListZoom(v)
}

/** The levels' names, as Settings and the tab menu show them. */
export const LIST_ZOOM_LABELS: Readonly<Record<ListZoom, string>> = {
  stacked: 'Stacked',
  rows: 'Rows',
  lines: 'Lines',
}

/** The Default list zoom's choices' names. */
export const LIST_ZOOM_SETTING_LABELS: Readonly<Record<ListZoomSetting, string>> = { auto: 'Auto', ...LIST_ZOOM_LABELS }

/** Auto: a list narrower than this (its measured width, px) is Stacked, from it Rows. */
export const AUTO_ZOOM_BREAKPOINT = 480
/** Auto changes level only once the width is this far past the breakpoint (px), so a divider drag across it doesn't flicker. */
export const AUTO_ZOOM_HYSTERESIS = 16

/**
 * The level Auto shows in a list `width` px wide: Stacked under
 * `AUTO_ZOOM_BREAKPOINT`, Rows from it. With the level it showed last
 * (`previous`), it changes only once the width is `AUTO_ZOOM_HYSTERESIS`
 * past the breakpoint (Rows → Stacked under 464, Stacked → Rows from 496).
 * An unmeasured width (0) is Rows.
 */
export function autoListZoom(width: number, previous?: ListZoom): ListZoom {
  if (!(width > 0)) return UNMEASURED_LIST_ZOOM
  if (previous === 'stacked') return width >= AUTO_ZOOM_BREAKPOINT + AUTO_ZOOM_HYSTERESIS ? 'rows' : 'stacked'
  if (previous === 'rows') return width < AUTO_ZOOM_BREAKPOINT - AUTO_ZOOM_HYSTERESIS ? 'stacked' : 'rows'
  return width < AUTO_ZOOM_BREAKPOINT ? 'stacked' : 'rows'
}

/** The level a tab without its own zoom shows under the Default list zoom `setting` (Auto: by its `width`, `autoListZoom`). */
export function defaultListZoom(setting: ListZoomSetting, width = 0, previous?: ListZoom): ListZoom {
  return setting === 'auto' ? autoListZoom(width, previous) : setting
}


/** The `rowDensity` row's value as a level; `undefined` for anything else (v79 wrote the older values as levels). */
export function parseListZoomSetting(value: unknown): ListZoom | undefined {
  return isListZoom(value) ? value : undefined
}

/** Zooming in shows more of each task (towards Stacked); zooming out shows more tasks (towards Lines). */
export type ZoomDirection = 'in' | 'out'

/** The level one step `dir` from `zoom`, clamped at the ends (`stacked` in, `lines` out). */
export function stepListZoom(zoom: ListZoom, dir: ZoomDirection): ListZoom {
  const i = LIST_ZOOMS.indexOf(zoom)
  const next = dir === 'in' ? i - 1 : i + 1
  return LIST_ZOOMS[Math.max(0, Math.min(LIST_ZOOMS.length - 1, next))] ?? zoom
}

/** Whether `zoom` can step `dir` (it isn't already at that end). */
export function canStepListZoom(zoom: ListZoom, dir: ZoomDirection): boolean {
  return stepListZoom(zoom, dir) !== zoom
}

/**
 * A task's state as a Lines row's box fills with it (the box's ring is its
 * priority, as on a row's checkbox), the first that holds: `late` (due date
 * past), `soon` (due inside the Settings "due soon" range), `followup` (the
 * follow-up late), `stale` (untouched for the Settings threshold), else
 * `none` (a completed task too).
 */
export type RowTone = 'late' | 'soon' | 'followup' | 'stale' | 'none'

export interface RowToneSettings {
  urgentRange: UrgentDueWithinDays
  staleAfterDays: number
}

export function rowTone(
  todo: Pick<TodoItem, 'dueDate' | 'nextFollowupAt' | 'isCompleted' | 'modifiedAt'>,
  today: Date,
  { urgentRange, staleAfterDays }: RowToneSettings,
): RowTone {
  if (todo.isCompleted) return 'none'
  const due = dueState(todo, today, urgentRange)
  if (due.past) return 'late'
  if (due.soon) return 'soon'
  if (followupState(todo, today) === 'late') return 'followup'
  if (isStale(todo, today, staleAfterDays)) return 'stale'
  return 'none'
}

/**
 * The date at a Lines row's end, coloured as the Rows date cells colour it
 * (`tone`): `late` — the due date past (bold), `soon` — due inside the
 * Settings "due soon" range, `followup` — the follow-up today or late,
 * `plain` — any other. Which date: the follow-up while it is today or late
 * (it asks for action now), else the due date, else the next follow-up; a
 * completed task's, or none, is null.
 */
export interface LineDate {
  kind: 'due' | 'followup'
  text: string
  tone: 'late' | 'soon' | 'followup' | 'plain'
}

export function lineDate(
  todo: Pick<TodoItem, 'dueDate' | 'nextFollowupAt' | 'isCompleted'>,
  today: Date,
  { urgentRange, rowDates }: { urgentRange: UrgentDueWithinDays; rowDates: RowDates },
): LineDate | null {
  if (todo.isCompleted) return null
  const next = todo.nextFollowupAt
  const followup = followupState(todo, today)
  if (next && (followup === 'late' || followup === 'today')) return { kind: 'followup', text: formatRowDate(next, today, rowDates), tone: 'followup' }
  if (todo.dueDate) {
    const due = dueState(todo, today, urgentRange)
    return { kind: 'due', text: formatRowDate(todo.dueDate, today, rowDates), tone: due.past ? 'late' : due.soon ? 'soon' : 'plain' }
  }
  return next ? { kind: 'followup', text: formatRowDate(next, today, rowDates), tone: 'plain' } : null
}

/** What a Lines row's tooltip says beside the title. */
export interface RowSummaryParts {
  people: readonly string[]
  tags: readonly string[]
  count: SubtaskCount | null
  stale: boolean
}

/**
 * A Lines row's tooltip (it has no cells): the title, then what the Rows
 * cells would show, each date in full as their tooltips and names give it
 * (`formatFollowupDate`: the year when not this year) — `Due Fri 20 Nov
 * (late) · Follow-up Mon 16 Nov · 2 of 5 subtasks done · Aisha, Ben ·
 * #docs` —, then a stale task's last-edited line.
 */
export function rowSummaryText(
  todo: Pick<TodoItem, 'title' | 'dueDate' | 'nextFollowupAt' | 'isCompleted' | 'modifiedAt'>,
  today: Date,
  { people, tags, count, stale }: RowSummaryParts,
): string {
  const parts: string[] = []
  if (todo.dueDate) parts.push(`Due ${formatFollowupDate(todo.dueDate, today)}${isDeadlinePast(todo, today) && !todo.isCompleted ? ' (late)' : ''}`)
  if (todo.nextFollowupAt) parts.push(`Follow-up ${formatFollowupDate(todo.nextFollowupAt, today)}${isFollowupOverdue(todo, today) ? ' (late)' : ''}`)
  if (count) parts.push(describeSubtaskCount(count))
  if (people.length > 0) parts.push(people.join(', '))
  if (tags.length > 0) parts.push(tags.map((t) => `#${t}`).join(' '))
  return [todo.title, ...(parts.length > 0 ? [parts.join(' · ')] : []), ...(stale ? [staleTooltipLine(todo, today)] : [])].join('\n')
}
