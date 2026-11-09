import type {
  BreakdownOldestBy,
  BreakdownShow,
  BreakdownSort,
  BreakdownSortKey,
  BreakdownSplit,
  BreakdownStyle,
} from '../../../models/chart-widgets'
import { hasNaturalOrder, type BreakdownRow } from '../../../services/stats/breakdown'
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

/** The name column's heading and the filter row's label, per split. */
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

/** A heading's name: the split's for `name`, Oldest for `open` while it shows the oldest. */
export function sortHeading(by: BreakdownSortKey, split: BreakdownSplit, show: BreakdownShow): string {
  switch (by) {
    case 'name': return SPLIT_ROW_LABELS[split]
    case 'open': return show === 'oldest' ? 'Oldest' : 'Open'
    case 'priority': return 'Priority'
    case 'due': return 'Due'
    case 'followup': return 'Follow-up'
  }
}

/** The split's own order, in words. */
function defaultSortWords(split: BreakdownSplit, show: BreakdownShow): string {
  if (!hasNaturalOrder(split)) return show === 'oldest' ? 'Oldest first' : 'Most due first'
  switch (split) {
    case 'status': return 'Settings order'
    case 'priority': return 'Priority order'
    case 'due': return 'By due date'
    default: return 'Newest first'
  }
}

/** The header's subtitle: the sort in words (`Most due first`, `A–Z`, `Fewest open first`). */
export function sortWords(sort: BreakdownSort | undefined, split: BreakdownSplit, show: BreakdownShow): string {
  if (!sort) return defaultSortWords(split, show)
  const r = sort.reversed === true
  switch (sort.by) {
    case 'name': return r ? 'Z–A' : 'A–Z'
    case 'open':
      if (show === 'oldest') return r ? 'Newest first' : 'Oldest first'
      return r ? 'Fewest open first' : 'Most open first'
    case 'priority': return r ? 'Least priority first' : 'Most priority first'
    case 'due': return r ? 'Fewest due first' : 'Most due first'
    case 'followup': return r ? 'Fewest follow-ups first' : 'Most follow-ups first'
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

/** Copy: `Waiting on 12 open`, then each row, `Aisha 3 · Ben 2 · Unassigned 1` (or each's oldest age). */
export function breakdownLines(title: string, total: number, totalWord: string, rows: readonly BreakdownRow[], show: BreakdownShow): SummaryPart[][] {
  return [
    [{ label: title, count: `${total} ${totalWord}` }],
    rows.map((r) => ({ label: rowHeading(r), count: rowFigure(r, show) })),
  ]
}

/**
 * The picks that still name a row: a pick whose row has gone (its last
 * task completed, the top bar narrowed) neither filters nor shows a chip,
 * so what is filtered is always what the chips say.
 */
export function livePicks(rows: readonly BreakdownRow[], picks: readonly string[]): readonly string[] {
  if (picks.length === 0) return picks
  const keys = new Set(rows.map((r) => r.key))
  const live = picks.filter((k) => keys.has(k))
  return live.length === picks.length ? picks : live
}

/** The rows the filter row leaves: those whose name holds the typed text, else the picked ones (`livePicks`), else all. */
export function filteredRows(rows: readonly BreakdownRow[], picks: readonly string[], text: string): readonly BreakdownRow[] {
  const query = text.trim().toLowerCase()
  if (query) return rows.filter((r) => r.label.toLowerCase().includes(query))
  const live = livePicks(rows, picks)
  if (live.length > 0) return rows.filter((r) => live.includes(r.key))
  return rows
}
