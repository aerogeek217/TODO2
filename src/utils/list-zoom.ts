import { LIST_ZOOMS, readListZoom, type ListZoom } from '../models/workspace-layout'
import type { TodoItem } from '../models/todo-item'
import { formatRowDate } from './date'
import { isDeadlinePast } from './effective-date'
import { isFollowupOverdue } from './followup'
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
 * picked one. It is stored in the `rowDensity` row, where the two densities
 * before it are read as levels: `comfortable` → `stacked`, `compact` → `rows`.
 * The phone's rows have one density.
 */

/** A tab that hasn't picked a zoom, with no Settings default stored. */
export const DEFAULT_LIST_ZOOM: ListZoom = 'rows'

/** The levels' names, as Settings and the tab menu show them. */
export const LIST_ZOOM_LABELS: Readonly<Record<ListZoom, string>> = {
  stacked: 'Stacked',
  rows: 'Rows',
  lines: 'Lines',
}

/** The stored densities before the zoom levels, read as levels. */
const LEGACY_DENSITY: Readonly<Record<string, ListZoom>> = { comfortable: 'stacked', compact: 'rows' }

/** The `rowDensity` row's value as a level: a level (`strips` as `lines`), or an old density; `undefined` for anything else. */
export function parseListZoomSetting(value: unknown): ListZoom | undefined {
  const zoom = readListZoom(value)
  if (zoom) return zoom
  return typeof value === 'string' ? LEGACY_DENSITY[value] : undefined
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
  rowDates: RowDates
  people: readonly string[]
  tags: readonly string[]
  count: SubtaskCount | null
  stale: boolean
}

/**
 * A Lines row's tooltip (it has no cells): the title, then what the Rows
 * cells would show — `Due 11/20 (late) · Follow-up Mon · 2 of 5 subtasks
 * done · Aisha, Ben · #docs` —, then a stale task's last-edited line.
 */
export function rowSummaryText(
  todo: Pick<TodoItem, 'title' | 'dueDate' | 'nextFollowupAt' | 'isCompleted' | 'modifiedAt'>,
  today: Date,
  { rowDates, people, tags, count, stale }: RowSummaryParts,
): string {
  const parts: string[] = []
  if (todo.dueDate) parts.push(`Due ${formatRowDate(todo.dueDate, today, rowDates)}${isDeadlinePast(todo, today) && !todo.isCompleted ? ' (late)' : ''}`)
  if (todo.nextFollowupAt) parts.push(`Follow-up ${formatRowDate(todo.nextFollowupAt, today, rowDates)}${isFollowupOverdue(todo, today) ? ' (late)' : ''}`)
  if (count) parts.push(describeSubtaskCount(count))
  if (people.length > 0) parts.push(people.join(', '))
  if (tags.length > 0) parts.push(tags.map((t) => `#${t}`).join(' '))
  return [todo.title, ...(parts.length > 0 ? [parts.join(' · ')] : []), ...(stale ? [staleTooltipLine(todo, today)] : [])].join('\n')
}
