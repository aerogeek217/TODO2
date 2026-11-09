import type { BreakdownRow } from '../../../services/stats/breakdown'
import type { ReviewPayload } from '../../../services/review'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import type { ReviewSourceKind } from '../../../stores/review-store'
import type { GlanceDrill } from './glance-types'

/**
 * What a chart widget's click opens (D26 P8): a row, bar, segment, cell or
 * tile drills into the task dialog (`GlanceDrill`), and a Breakdown row's
 * Review ▸ or its Due / Follow-up count opens the review deck on just those
 * tasks (`ReviewPayload`). Built here from the ids the pure statistics
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

/** Which of a row's tasks a review takes: all of them, the due ones or the ones due for a follow-up. */
export type RowReviewPart = 'all' | 'due' | 'followup'

function reviewKind(row: Pick<BreakdownRow, 'entity'>): ReviewSourceKind {
  switch (row.entity.kind) {
    case 'person': return 'person'
    case 'tag': return 'tag'
    case 'status': return 'status'
    case 'priority': return 'priority'
    default: return 'chart'
  }
}

/** A Breakdown row's review: its tasks (Review ▸), or just its due ones or its follow-ups (a count's click). */
export function breakdownRowReview(chart: string, row: BreakdownRow, part: RowReviewPart): ReviewPayload {
  const ids = part === 'due' ? row.dueIds : part === 'followup' ? row.followupIds : row.ids
  const which = part === 'due' ? 'due' : part === 'followup' ? 'due for a follow-up' : ''
  const heading = rowHeading(row)
  return {
    kind: reviewKind(row),
    title: part === 'all' ? heading : `${heading} · ${part === 'due' ? 'Due' : 'Follow-up'}`,
    description: `${chart}: the tasks ${rowWords(row)}${which ? `, ${which}` : ''}.`,
    ids: [...ids],
  }
}

/** A chart's tasks under a heading of their own (a Pivot cell, a Status flow segment, a Tag map tile). */
export function chartDrill(title: string, glyph: GlanceGlyphName, description: string, ids: readonly number[]): GlanceDrill {
  return { title, glyph, description, source: { kind: 'todos', todoIds: [...ids] } }
}
