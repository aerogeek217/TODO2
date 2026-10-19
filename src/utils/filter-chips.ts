import type { DateAnchor, DateFilters, DateMatch, FilterNegation, MarkersFilter, NegatableField, Person, Status, Tag, TodoPredicate } from '../models'
import type { DateField } from '../models/app-view'
import { RELATIVE_TOKEN_LABELS } from './date-anchor'
import { activeDateFields, hasDateFilters, withDateMatch } from './date-filters'
import { isNegated, withIdFilter, type IdList } from './filter-negation'
import { DATE_FIELD_LABELS_SHORT } from './filter-labels'
import { hasMarkers, MARKERS_LABEL, markersValue } from './markers'

/** The filter fields a chip stands for. */
export type FilterChipField = 'people' | 'tags' | 'dates' | 'status' | 'markers' | 'text' | 'completed'

/** The filter fields in display order: the top bar's buttons, a list's chips and its + Filter menu. */
export const FILTER_FIELD_ORDER: readonly FilterChipField[] = ['markers', 'tags', 'people', 'dates', 'status', 'text', 'completed']

export interface FilterChip {
  field: FilterChipField
  /** A date chip's date type (one chip per date type that filters). */
  dateField?: DateField
  /** Field name, e.g. `Due`, `Status` (list chips show it muted before the value). */
  label: string
  /** Value text, e.g. `within 14 days`, `Alice +2`, `#q4`, `not Waiting`. */
  value: string
  /** An "is not" People / Status / Tags chip: its value starts `not `. */
  negated?: true
  /** Spelled out for a tooltip (an "is not" chip: what it hides); absent when the chip says it all. */
  tooltip?: string
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
  personIds: IdList | null
  statusIds: IdList | null
  tags?: IdList | null
  searchText: string
  dates: DateFilters
  markers?: MarkersFilter | null
  negate?: FilterNegation
}

/** Every resolved name (ids with no row left out), `zeroName` for id 0. */
function allNames(ids: Iterable<number>, nameOf: (id: number) => string | undefined, zeroName: string, prefix = ''): string[] {
  return [...ids].flatMap((id) => {
    if (id === 0) return [zeroName]
    const n = nameOf(id)
    return n == null ? [] : [`${prefix}${n}`]
  })
}

/** `a, b or c`. */
function orList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/** What an "is not" chip hides, spelled out (its tooltip). */
function negatedTooltip(field: NegatableField, names: readonly string[]): string {
  switch (field) {
    case 'statusIds': return `Status: not ${orList(names)}\nHides tasks with ${names.length === 1 ? 'that status' : 'any of these statuses'}`
    case 'personIds': return `People: not ${orList(names)}\nHides tasks assigned to ${names.length === 1 ? 'them' : 'any of them'}`
    case 'tags': return `Tags: not ${orList(names)}\nHides tasks with ${names.length === 1 ? 'that tag' : 'any of these tags'}; untagged tasks stay`
  }
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

/** One chip per date type that filters, in tab order: `Due` `within 14 days`, `Created` `from start of month`. */
function dateChips(dates: DateFilters): FilterChip[] {
  return activeDateFields(dates).flatMap((f) => {
    const m = dates[f]
    return m ? [{ field: 'dates' as const, dateField: f, label: DATE_FIELD_LABELS_SHORT[f], value: describeDateMatch(m) }] : []
  })
}

/** A key unique among a filter's chips: the field, or `dates:<type>` for a date chip. */
export function chipKey(chip: FilterChip): string {
  return chip.dateField ? `${chip.field}:${chip.dateField}` : chip.field
}

/** Each date type that filters as `<Type> <clause>`: `Due within 14 days`. */
function dateClauses(dates: DateFilters): { field: DateField; text: string; words: string }[] {
  return activeDateFields(dates).flatMap((f) => {
    const m = dates[f]
    return m ? [{ field: f, text: `${DATE_FIELD_LABELS_SHORT[f]} ${describeDateMatch(m)}`, words: describeDateMatch(m) }] : []
  })
}

/**
 * The date filters as one value (the top bar's Dates button, the Filters
 * menu's and the phone sheet's Dates row): one type → its clause
 * (`Due within 14 days`); two → their short names (`Due + Created`); three
 * or four → the first + N (`Due + 2`). `null` when no date type filters.
 */
export function datesValue(dates: DateFilters): string | null {
  const clauses = dateClauses(dates)
  const [first, second] = clauses
  if (!first) return null
  if (!second) return first.text
  const name = (f: DateField) => DATE_FIELD_LABELS_SHORT[f]
  if (clauses.length === 2) return `${name(first.field)} + ${name(second.field)}`
  return `${name(first.field)} + ${clauses.length - 1}`
}

/**
 * The Dates button's tooltip from two date types on: a line per type
 * (`Due: within 14 days`), then how they combine. `null` below two.
 */
export function datesTooltip(dates: DateFilters): string | null {
  const clauses = dateClauses(dates)
  if (clauses.length < 2) return null
  const both = clauses.length === 2 ? 'both' : 'all'
  return [
    ...clauses.map((c) => `${DATE_FIELD_LABELS_SHORT[c.field]}: ${c.words}`),
    `Tasks must match ${both} · × clears ${both}`,
  ].join('\n')
}

/** Every date type's clause for a screen reader: `Due within 14 days; Created from start of month`. */
export function datesSpokenValue(dates: DateFilters): string | null {
  const clauses = dateClauses(dates)
  return clauses.length > 0 ? clauses.map((c) => c.text).join('; ') : null
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
  // An id chip: `Alice +2`, or — "is not" — `not Alice +2` with a tooltip saying what it hides.
  const idChip = (field: 'tags' | 'people' | 'status', key: NegatableField, label: string, ids: Iterable<number>, nameOf: (id: number) => string | undefined, zeroName: string, prefix = ''): FilterChip => {
    const value = namesValue(ids, nameOf, zeroName, prefix)
    if (!isNegated(c, key)) return { field, label, value }
    return { field, label, value: `not ${value}`, negated: true, tooltip: negatedTooltip(key, allNames(ids, nameOf, zeroName, prefix)) }
  }
  if (c.tags != null) chips.push(idChip('tags', 'tags', 'Tags', c.tags, byId(names.tags), 'Untagged', '#'))
  if (c.personIds != null) chips.push(idChip('people', 'personIds', 'People', c.personIds, byId(names.people), 'Unassigned'))
  chips.push(...dateChips(c.dates))
  if (c.statusIds != null) chips.push(idChip('status', 'statusIds', 'Status', c.statusIds, byId(names.statuses), 'No status'))
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

/**
 * The predicate without the clauses of one chip field — for `dates`, only
 * `dateField`'s clause when given (a date chip's ×), else every date type.
 * Clearing People / Status / Tags drops its "is not" switch too.
 */
export function clearChipField(p: TodoPredicate, field: FilterChipField, dateField?: DateField): TodoPredicate {
  switch (field) {
    case 'people': return withIdFilter(p, 'personIds', null, false)
    case 'tags': return withIdFilter(p, 'tags', null, false)
    case 'status': return withIdFilter(p, 'statusIds', null, false)
    case 'markers': return { ...p, markers: null }
    case 'text': return { ...p, searchText: '' }
    case 'dates': return { ...p, dates: dateField ? withDateMatch(p.dates, dateField, null) : {} }
    case 'completed': return { ...p, showCompleted: false }
  }
}
