import type { BreakdownRow } from '../../../services/stats/breakdown'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import type { GlanceDrill } from './glance-types'

/**
 * What a chart widget's click opens (D26 P8): a row, bar, segment, cell or
 * tile drills into the task dialog (`GlanceDrill`), built here from the ids
 * the pure statistics return. A Breakdown row's Review button and a count
 * column's count jump to a Review widget instead (`services/review`
 * `breakdownReviewFilter`), where there is one.
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

/** A count column's count opened in the task dialog (where there is no review): just those tasks. */
export function breakdownColumnDrill(chart: string, row: BreakdownRow, columnId: string, heading: string): GlanceDrill {
  return {
    ...breakdownRowDrill(chart, row),
    title: `${chart} · ${rowHeading(row)} · ${heading}`,
    source: { kind: 'todos', todoIds: [...(row.columns[columnId] ?? [])] },
  }
}

/** A chart's tasks under a heading of their own (a Pivot cell). */
export function chartDrill(title: string, glyph: GlanceGlyphName, description: string, ids: readonly number[]): GlanceDrill {
  return { title, glyph, description, source: { kind: 'todos', todoIds: [...ids] } }
}
