import type {
  BreakdownColumn,
  BreakdownOldestBy,
  BreakdownShow,
  BreakdownSort,
  BreakdownSortKey,
  BreakdownSplit,
  BreakdownStyle,
} from '../../../models/chart-widgets'
import { columnCount, hasNaturalOrder, type BreakdownRow } from '../../../services/stats/breakdown'
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

/** A heading's name: the split's for `name`, Oldest for `open` while it shows the oldest, a count column's its name. */
export function sortHeading(by: BreakdownSortKey, split: BreakdownSplit, show: BreakdownShow, columns: readonly BreakdownColumn[] = []): string {
  switch (by) {
    case 'name': return SPLIT_ROW_LABELS[split]
    case 'open': return show === 'oldest' ? 'Oldest' : 'Open'
    default: {
      const column = columns.find((c) => c.id === by)
      return column ? columnHeading(column) : by
    }
  }
}

/** The split's own order, in words (people and tags: most counted across the count columns first). */
function defaultSortWords(split: BreakdownSplit, show: BreakdownShow, columns: readonly BreakdownColumn[]): string {
  if (!hasNaturalOrder(split)) return show === 'oldest' ? 'Oldest first' : columns.length > 0 ? 'Most counted first' : 'Most open first'
  switch (split) {
    case 'status': return 'Settings order'
    case 'priority': return 'Priority order'
    case 'due': return 'By due date'
    default: return 'Newest first'
  }
}

/** A sort in words, for the ⋯ menu's Sort (`Most Due first`, `A–Z`, `Fewest open first`); a sort by a column it no longer has reads as the default. */
export function sortWords(sort: BreakdownSort | undefined, split: BreakdownSplit, show: BreakdownShow, columns: readonly BreakdownColumn[] = []): string {
  const r = sort?.reversed === true
  switch (sort?.by) {
    case undefined: return defaultSortWords(split, show, columns)
    case 'name': return r ? 'Z–A' : 'A–Z'
    case 'open':
      if (show === 'oldest') return r ? 'Newest first' : 'Oldest first'
      return r ? 'Fewest open first' : 'Most open first'
    default: {
      const column = columns.find((c) => c.id === sort?.by)
      if (!column) return defaultSortWords(split, show, columns)
      return `${r ? 'Fewest' : 'Most'} ${columnHeading(column)} first`
    }
  }
}

/** `19 d` — an age in days. */
export function daysLabel(days: number): string {
  return `${days} d`
}

/** A row's figure: its task count, or its oldest's age (`–` without one). */
export function rowFigure(row: BreakdownRow, show: BreakdownShow): string {
  if (show === 'count') return String(row.ids.length)
  return row.oldest ? daysLabel(row.oldest.days) : '–'
}

/**
 * Copy: `People 12 open`, then a line per row with its count columns by
 * name, `Aisha 3 · Due 2 · Follow-up 1` (or its oldest age first); with
 * no count columns the rows on one line, `Aisha 3 · Ben 2 · Unassigned 1`.
 */
export function breakdownLines(
  title: string,
  total: number,
  totalWord: string,
  rows: readonly BreakdownRow[],
  show: BreakdownShow,
  columns: readonly BreakdownColumn[] = [],
): SummaryPart[][] {
  const head = [{ label: title, count: `${total} ${totalWord}` }]
  if (columns.length === 0) return [head, rows.map((r) => ({ label: rowHeading(r), count: rowFigure(r, show) }))]
  return [
    head,
    ...rows.map((r) => [
      { label: rowHeading(r), count: rowFigure(r, show) },
      ...columns.map((c) => ({ label: columnHeading(c), count: String(columnCount(r, c.id)) })),
    ]),
  ]
}
