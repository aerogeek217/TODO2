import type { BreakdownConfig } from '../../../models/chart-widgets'
import { breakdownDataOf } from '../../../hooks/use-chart-data'
import { currentStatsBase } from '../../../hooks/use-glance-data'
import type { BreakdownRow } from '../../../services/stats/breakdown'
import type { ReviewPayload, ReviewPayloadLens } from '../../../services/review'
import { useSettingsStore } from '../../../stores/settings-store'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import type { ReviewSourceKind } from '../../../stores/review-store'
import type { GlanceDrill } from './glance-types'

/**
 * What a chart widget's click opens (D26 P8): a row, bar, segment, cell or
 * tile drills into the task dialog (`GlanceDrill`), and a Breakdown row's
 * Review button or a count column's count opens the review deck on just
 * those tasks (`ReviewPayload`). Built here from the ids the pure statistics
 * return.
 */

/** A row's name as a heading: a tag's with its `#`. */
export function rowHeading(row: Pick<BreakdownRow, 'label' | 'entity'>): string {
  return row.entity.kind === 'tag' ? `#${row.label}` : row.label
}

/** The glyph a row's entity reads as. */
function rowGlyph(row: Pick<BreakdownRow, 'entity'>): GlanceGlyphName {
  switch (row.entity.kind) {
    case 'person': return 'people'
    case 'tag': return 'tag'
    case 'status': return 'status'
    case 'priority': return 'focus'
    case 'due': return 'calendar'
    default: return 'chart'
  }
}

/** A row's tasks in the chart's words: `Waiting on: assigned to Aisha.` */
function rowWords(row: Pick<BreakdownRow, 'label' | 'entity'>): string {
  const e = row.entity
  switch (e.kind) {
    case 'person': return `assigned to ${row.label}`
    case 'tag': return `tagged #${row.label}`
    case 'status': return `with the status ${row.label}`
    case 'priority': return `with the priority ${row.label}`
    case 'due': return `due ${row.label.toLowerCase()}`
    case 'age': return `created ${row.label.toLowerCase()} ago`
    case 'none': return row.label.toLowerCase()
  }
}

/** A Breakdown row (its name, its bar, its segment): its tasks; a person's dialog offers their check-in. */
export function breakdownRowDrill(chart: string, row: BreakdownRow): GlanceDrill {
  const personId = row.entity.kind === 'person' ? row.entity.person.id : undefined
  return {
    title: `${chart} · ${rowHeading(row)}`,
    glyph: rowGlyph(row),
    description: `${chart}: the tasks ${rowWords(row)}.`,
    source: { kind: 'todos', todoIds: [...row.ids] },
    ...(personId != null ? { personId } : {}),
  }
}

/** Which of a row's tasks a review takes: all of them, or the ones a count column counts (its id and heading). */
export type RowReviewPart = 'all' | { columnId: string; heading: string }

function reviewKind(row: Pick<BreakdownRow, 'entity'>): ReviewSourceKind {
  switch (row.entity.kind) {
    case 'person': return 'person'
    case 'tag': return 'tag'
    case 'status': return 'status'
    case 'priority': return 'priority'
    default: return 'chart'
  }
}

/** A Breakdown row's review: its tasks (its Review button), or just those a count column counts (a count's click). */
export function breakdownRowReview(chart: string, row: BreakdownRow, part: RowReviewPart, lens?: ReviewPayloadLens): ReviewPayload {
  const heading = rowHeading(row)
  const withLens = lens ? { lens } : {}
  if (part === 'all') return { kind: reviewKind(row), title: heading, description: `${chart}: the tasks ${rowWords(row)}.`, ids: [...row.ids], ...withLens }
  return {
    kind: reviewKind(row),
    title: `${heading} · ${part.heading}`,
    description: `${chart}: the tasks ${rowWords(row)} in ${part.heading}.`,
    ids: [...(row.columns[part.columnId] ?? [])],
    ...withLens,
  }
}

/**
 * A Breakdown row's review lens (item 10): taken as the widget took it
 * (`ignored`: its lens switch), and again on the deck's toggle — the
 * Breakdown computed afresh with / without the top bar's lens, the row
 * found by its key (gone: no tasks).
 */
export function breakdownRowLens(config: BreakdownConfig, ignored: boolean, rowKey: string, part: RowReviewPart): ReviewPayloadLens {
  return {
    ignored,
    requery: (ignoreLens) => {
      const data = breakdownDataOf(currentStatsBase(ignoreLens), config, useSettingsStore.getState().tabBadges)
      const row = data.stats.rows.find((r) => r.key === rowKey)
      if (!row) return { ids: [] }
      return { ids: part === 'all' ? row.ids : row.columns[part.columnId] ?? [] }
    },
  }
}

/** A count column's count opened in the task dialog (where there is no review): just those tasks. */
export function breakdownColumnDrill(chart: string, row: BreakdownRow, columnId: string, heading: string): GlanceDrill {
  return {
    ...breakdownRowDrill(chart, row),
    title: `${chart} · ${rowHeading(row)} · ${heading}`,
    source: { kind: 'todos', todoIds: [...(row.columns[columnId] ?? [])] },
  }
}

/** A chart's tasks under a heading of their own (a Pivot cell, a Tag map tile). */
export function chartDrill(title: string, glyph: GlanceGlyphName, description: string, ids: readonly number[]): GlanceDrill {
  return { title, glyph, description, source: { kind: 'todos', todoIds: [...ids] } }
}
