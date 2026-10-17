import type { DateAnchor, DateFilters, DateMatch, MarkersFilter, Person, Status, Tag, TodoPredicate } from '../models'
import { RELATIVE_TOKEN_LABELS } from './date-anchor'
import { activeDateFields, hasDateFilters } from './date-filters'
import { DATE_FIELD_LABELS_SHORT } from './filter-labels'
import { hasMarkers, MARKERS_LABEL, markersValue } from './markers'

/** The filter fields a chip stands for. */
export type FilterChipField = 'people' | 'tags' | 'dates' | 'status' | 'markers' | 'text' | 'completed'

/** The filter fields in display order: the top bar's buttons, a list's chips and its + Filter menu. */
export const FILTER_FIELD_ORDER: readonly FilterChipField[] = ['markers', 'tags', 'people', 'dates', 'status', 'text', 'completed']

export interface FilterChip {
  field: FilterChipField
  /** Field name, e.g. `Due`, `Status` (list chips show it muted before the value). */
  label: string
  /** Value text, e.g. `within 14 days`, `Alice +2`, `#q4`. */
  value: string
}

/** Entity registries the chip text resolves ids against. */
export interface FilterChipNames {
  people: readonly Person[]
  tags: readonly Tag[]
  statuses: readonly Status[]
}

/** Narrowing clauses of a filter, in the shape both predicates and screen criteria share. */
export interface FilterClauses {
  showCompleted: boolean
  personIds: Iterable<number> | null
  statusIds: Iterable<number> | null
  tags?: Iterable<number> | null
  searchText: string
  dates: DateFilters
  markers?: MarkersFilter | null
}

/** `first +N` over the resolved names; `none` when nothing is picked. */
function namesValue(
  ids: Iterable<number>,
  nameOf: (id: number) => string | undefined,
  zeroName: string,
  prefix = '',
): string {
  const names = [...ids].map((id) => (id === 0 ? zeroName : nameOf(id))).filter((n): n is string => n != null)
  const first = names[0]
  if (first == null) return 'none'
  const name = first === zeroName ? first : `${prefix}${first}`
  return names.length > 1 ? `${name} +${names.length - 1}` : name
}

function dayLabel(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

/** One endpoint in words: `Oct 15`, `today`, `end of week`, `in 3 days`, `2 days ago`. */
export function describeAnchor(anchor: DateAnchor): string {
  switch (anchor.kind) {
    case 'fixed':
      return new Date(anchor.iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    case 'relative':
      return RELATIVE_TOKEN_LABELS[anchor.token].toLowerCase()
    case 'offset':
      if (anchor.days === 0) return 'today'
      return anchor.days > 0 ? `in ${dayLabel(anchor.days)}` : `${dayLabel(-anchor.days)} ago`
  }
}

function isToday(a: DateAnchor | null): boolean {
  return a != null && ((a.kind === 'relative' && a.token === 'today') || (a.kind === 'offset' && a.days === 0))
}

/** A date range in words: `within 14 days`, `by end of week`, `from today`, `Oct 1 – Oct 15`. */
export function describeRange(start: DateAnchor | null, end: DateAnchor | null): string {
  if (isToday(start) && end?.kind === 'offset' && end.days > 0) return `within ${dayLabel(end.days)}`
  if (start && end) return `${describeAnchor(start)} – ${describeAnchor(end)}`
  if (end) return `by ${describeAnchor(end)}`
  if (start) return `from ${describeAnchor(start)}`
  return ''
}

/** One date clause in words: `within 14 days`, `by Oct 31, or none`, `has a date`, `no date`. */
export function describeDateMatch(m: DateMatch): string {
  if (m.match === 'set') return 'has a date'
  if (m.match === 'unset') return 'no date'
  const range = describeRange(m.start, m.end)
  return m.includeNoDate === true ? `${range}, or none` : range
}

/**
 * The date filters as one chip: one date type → its short name and clause
 * (`Due` `within 14 days`); several → `Dates` and each type's clause
 * (`Due within 14 days, Follow-up has a date`).
 */
function datesChip(c: FilterClauses): FilterChip | null {
  const fields = activeDateFields(c.dates)
  const only = fields.length === 1 ? fields[0] : undefined
  const onlyMatch = only ? c.dates[only] : undefined
  if (only && onlyMatch) return { field: 'dates', label: DATE_FIELD_LABELS_SHORT[only], value: describeDateMatch(onlyMatch) }
  const parts = fields.flatMap((f) => {
    const m = c.dates[f]
    return m ? [`${DATE_FIELD_LABELS_SHORT[f]} ${describeDateMatch(m)}`] : []
  })
  if (parts.length === 0) return null
  return { field: 'dates', label: 'Dates', value: parts.join(', ') }
}

/**
 * Chips for the narrowing clauses of a filter, in `FILTER_FIELD_ORDER` (markers, tags,
 * people, dates, status, text — the top bar's order). `showCompleted` adds a
 * trailing `completed` chip only when `includeCompleted` is set (screen filters show
 * it; a list's own filter keeps it in its options).
 */
export function filterChips(c: FilterClauses, names: FilterChipNames, includeCompleted = false): FilterChip[] {
  const chips: FilterChip[] = []
  const byId = <T extends { id?: number; name: string }>(rows: readonly T[]) => (id: number) => rows.find((r) => r.id === id)?.name
  if (hasMarkers(c.markers)) chips.push({ field: 'markers', label: MARKERS_LABEL, value: markersValue(c.markers) })
  if (c.tags != null) chips.push({ field: 'tags', label: 'Tags', value: namesValue(c.tags, byId(names.tags), 'Untagged', '#') })
  if (c.personIds != null) chips.push({ field: 'people', label: 'People', value: namesValue(c.personIds, byId(names.people), 'Unassigned') })
  const dates = datesChip(c)
  if (dates) chips.push(dates)
  if (c.statusIds != null) chips.push({ field: 'status', label: 'Status', value: namesValue(c.statusIds, byId(names.statuses), 'No status') })
  const text = (c.searchText ?? '').trim()
  if (text !== '') chips.push({ field: 'text', label: 'Text', value: `“${text}”` })
  if (includeCompleted && c.showCompleted) chips.push({ field: 'completed', label: 'Completed', value: 'Completed shown' })
  return chips
}

/** Whether a list predicate narrows anything (`showCompleted` doesn't). */
export function hasNarrowingFilters(p: TodoPredicate): boolean {
  return p.personIds != null
    || p.statusIds != null
    || (p.tags ?? null) != null
    || (p.searchText ?? '').trim() !== ''
    || hasDateFilters(p.dates)
    || hasMarkers(p.markers)
}

/** The filters in words, e.g. `Status Waiting · Due within 14 days`. */
export function describeFilters(chips: readonly FilterChip[]): string {
  return chips.map((c) => `${c.label} ${c.value}`).join(' · ')
}

/** The predicate without the clauses of one chip field. */
export function clearChipField(p: TodoPredicate, field: FilterChipField): TodoPredicate {
  switch (field) {
    case 'people': return { ...p, personIds: null }
    case 'tags': return { ...p, tags: null }
    case 'status': return { ...p, statusIds: null }
    case 'markers': return { ...p, markers: null }
    case 'text': return { ...p, searchText: '' }
    case 'dates': return { ...p, dates: {} }
    case 'completed': return { ...p, showCompleted: false }
  }
}
