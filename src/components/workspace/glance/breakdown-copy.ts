import type {
  BreakdownColumn,
  BreakdownOldestBy,
  BreakdownShow,
  BreakdownSort,
  BreakdownSortKey,
  BreakdownSplit,
  BreakdownStyle,
} from '../../../models/chart-widgets'
import { ageSortColumnId } from '../../../models/chart-widgets'
import type { TodoPredicate } from '../../../models'
import { columnCount, hasNaturalOrder, type BreakdownRow, type FollowupAge } from '../../../services/stats/breakdown'
import { admitsCompleted, predicateToCriteria } from '../../../utils/filter-criteria'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import { rowHeading } from './chart-drills'
import type { SummaryPart } from './glance-summary'

/** A Breakdown's words (D26 P8): its splits' names, its headings, its sorts, its Copy lines. Pure. */

/** Each split as a choice (the editor, the tab menu). */
export const SPLIT_CHOICE_LABELS: Record<BreakdownSplit, string> = {
  people: 'People',
  tags: 'Tags',
  status: 'Status',
  priority: 'Priority',
  due: 'Due date',
  age: 'Age',
}

/** The name column's heading, per split. */
export const SPLIT_ROW_LABELS: Record<BreakdownSplit, string> = {
  people: 'Person',
  tags: 'Tag',
  status: 'Status',
  priority: 'Priority',
  due: 'Due',
  age: 'Age',
}

/** The glyph a Breakdown's title takes, per split. */
export const SPLIT_GLYPHS: Record<BreakdownSplit, GlanceGlyphName> = {
  people: 'people',
  tags: 'tag',
  status: 'status',
  priority: 'focus',
  due: 'calendar',
  age: 'stale',
}

export const STYLE_LABELS: Record<BreakdownStyle, string> = {
  bars: 'Bars',
  donut: 'Donut',
  stacked: 'Stacked bar',
}

export const SHOW_LABELS: Record<BreakdownShow, string> = {
  count: 'Count',
  oldest: 'Oldest',
}

export const OLDEST_BY_LABELS: Record<BreakdownOldestBy, string> = {
  lastFollowup: 'Last follow-up',
  created: 'Created',
  modified: 'Last changed',
  due: 'Due date',
}

/** A count column's heading: its name (`Column` while blank). */
export function columnHeading(column: Pick<BreakdownColumn, 'name'>): string {
  return column.name.trim() || 'Column'
}

/**
 * What a chart's counts are of (cr34 G6): `open` — or `tasks` when its
 * filter lets completed tasks through (Show completed, a Completed range:
 * "completed this week by person"), since it then counts those too. One
 * rule for a Breakdown's and a Pivot's header, small face and Copy, the
 * Breakdown's figure heading and its ⋯ menu's Sort words.
 */
export type CountWord = 'open' | 'tasks'

/** A chart's count word by its filter (`CountWord`). */
export function countWordOf(filter: TodoPredicate): CountWord {
  return admitsCompleted(predicateToCriteria(filter)) ? 'tasks' : 'open'
}

/**
 * A heading's name: the split's for `name`; for `open`, Oldest while it
 * shows the oldest, else Open (Tasks while it counts completed ones); a
 * count column's its name; a column's follow-up age (`age:<id>`) its name
 * and `age` (`Follow-up age`).
 */
export function sortHeading(
  by: BreakdownSortKey,
  split: BreakdownSplit,
  show: BreakdownShow,
  columns: readonly BreakdownColumn[] = [],
  word: CountWord = 'open',
): string {
  switch (by) {
    case 'name': return SPLIT_ROW_LABELS[split]
    case 'open': return show === 'oldest' ? 'Oldest' : word === 'tasks' ? 'Tasks' : 'Open'
    default: {
      const ageOf = ageSortColumnId(by)
      if (ageOf != null) {
        const column = columns.find((c) => c.id === ageOf)
        return `${column ? columnHeading(column) : ageOf} age`
      }
      const column = columns.find((c) => c.id === by)
      return column ? columnHeading(column) : by
    }
  }
}

/** The split's own order, in words (people and tags: most counted across the count columns first). */
function defaultSortWords(split: BreakdownSplit, show: BreakdownShow, columns: readonly BreakdownColumn[], word: CountWord): string {
  if (!hasNaturalOrder(split)) return show === 'oldest' ? 'Oldest first' : columns.length > 0 ? 'Most counted first' : `Most ${word} first`
  switch (split) {
    case 'status': return 'Settings order'
    case 'priority': return 'Priority order'
    case 'due': return 'By due date'
    default: return 'Newest first'
  }
}

/** A sort in words, for the ⋯ menu's Sort (`Most Due first`, `A–Z`, `Fewest open first` — `Fewest tasks first` while it counts completed ones); a sort by a column it no longer has reads as the default. */
export function sortWords(
  sort: BreakdownSort | undefined,
  split: BreakdownSplit,
  show: BreakdownShow,
  columns: readonly BreakdownColumn[] = [],
  word: CountWord = 'open',
): string {
  const r = sort?.reversed === true
  switch (sort?.by) {
    case undefined: return defaultSortWords(split, show, columns, word)
    case 'name': return r ? 'Z–A' : 'A–Z'
    case 'open':
      if (show === 'oldest') return r ? 'Newest first' : 'Oldest first'
      return `${r ? 'Fewest' : 'Most'} ${word} first`
    default: {
      const by = sort?.by ?? ''
      const ageOf = ageSortColumnId(by)
      if (ageOf != null) {
        if (!columns.some((c) => c.id === ageOf && c.age)) return defaultSortWords(split, show, columns, word)
        return r ? 'Latest follow-up first' : 'Longest since follow-up first'
      }
      const column = columns.find((c) => c.id === by)
      if (!column) return defaultSortWords(split, show, columns, word)
      return `${r ? 'Fewest' : 'Most'} ${columnHeading(column)} first`
    }
  }
}

/** A follow-up age as a column's cell draws it after the count: `23d` (whole days, today 0). */
export function followupAgeLabel(days: number): string {
  return `${Math.max(0, days)}d`
}

const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`

/**
 * A follow-up age's tooltip (board V1): `Oldest: “Vendor contract renewal”
 * · 23 days since followed up · median 9 days` — the oldest open task, its
 * age, and the median over the row's open tasks; for a task never followed
 * up, `23 days since created, never followed up`.
 */
export function followupAgeTooltip(age: FollowupAge): string {
  const days = Math.max(0, age.oldest.days)
  const since = age.neverFollowedUp ? `${daysWord(days)} since created, never followed up` : `${daysWord(days)} since followed up`
  return `Oldest: “${age.oldest.title}” · ${since} · median ${daysWord(Math.max(0, age.medianDays))}`
}

/**
 * `19 d` — an age in days. By due date the age is how late the task is, so
 * one not yet due reads when it is due, `in 5 d`, never a negative age
 * (cr34 G10); due today is `0 d`.
 */
export function daysLabel(days: number, by?: BreakdownOldestBy): string {
  return by === 'due' && days < 0 ? `in ${-days} d` : `${days} d`
}

/** An oldest task's age in a row's accessible name: `oldest 19 days`; by due date `oldest 3 days overdue`, `oldest due today`, `oldest due in 5 days`. */
export function oldestWords(days: number, by: BreakdownOldestBy): string {
  const n = Math.abs(days)
  const unit = n === 1 ? 'day' : 'days'
  if (by !== 'due') return `oldest ${days} ${unit}`
  if (days === 0) return 'oldest due today'
  return days > 0 ? `oldest ${n} ${unit} overdue` : `oldest due in ${n} ${unit}`
}

/** A row's figure: its task count, or its oldest's age by `oldestBy` (`–` without one). */
export function rowFigure(row: BreakdownRow, show: BreakdownShow, oldestBy?: BreakdownOldestBy): string {
  if (show === 'count') return String(row.ids.length)
  return row.oldest ? daysLabel(row.oldest.days, oldestBy) : '–'
}

/**
 * Copy: `People 12 open`, then a line per row with its count columns by
 * name, `Aisha 3 · Due 2 · Follow-up 1` (or its oldest age first) — a
 * column with the follow-up age adds it after its count, `Follow-up 1 ·
 * 23d` (none without an open task); with no count columns the rows on one
 * line, `Aisha 3 · Ben 2 · Unassigned 1`.
 */
export function breakdownLines(
  title: string,
  total: number,
  totalWord: string,
  rows: readonly BreakdownRow[],
  show: BreakdownShow,
  columns: readonly BreakdownColumn[] = [],
  oldestBy?: BreakdownOldestBy,
): SummaryPart[][] {
  const head = [{ label: title, count: `${total} ${totalWord}` }]
  if (columns.length === 0) return [head, rows.map((r) => ({ label: rowHeading(r), count: rowFigure(r, show, oldestBy) }))]
  return [
    head,
    ...rows.map((r) => [
      { label: rowHeading(r), count: rowFigure(r, show, oldestBy) },
      ...columns.map((c) => {
        const count = String(columnCount(r, c.id))
        const age = c.age && r.followup ? ` · ${followupAgeLabel(r.followup.oldest.days)}` : ''
        return { label: columnHeading(c), count: `${count}${age}` }
      }),
    ]),
  ]
}
