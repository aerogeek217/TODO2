import type { DateAnchor, Person, Project, Status, Tag, TodoPredicate } from '../models'
import type { DateField } from '../models/app-view'
import { RELATIVE_TOKEN_LABELS } from './date-anchor'
import { DATE_FIELD_LABELS_SHORT } from './filter-labels'

/** The filter fields a chip stands for, in chip order. */
export type FilterChipField = 'people' | 'tags' | 'dates' | 'status' | 'project' | 'text' | 'completed'

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
  projects: readonly Project[]
}

/** Narrowing clauses of a filter, in the shape both predicates and screen criteria share. */
export interface FilterClauses {
  showCompleted: boolean
  personIds: Iterable<number> | null
  projectIds: Iterable<number> | null
  statusIds: Iterable<number> | null
  tags?: Iterable<number> | null
  searchText: string
  dateField: DateField
  dateRangeStart: DateAnchor | null
  dateRangeEnd: DateAnchor | null
  hasDeadline: boolean | null
  hasFollowup?: boolean | null
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

function datesChip(c: FilterClauses): FilterChip | null {
  const parts: string[] = []
  const range = describeRange(c.dateRangeStart, c.dateRangeEnd)
  if (range) parts.push(range)
  if (c.hasDeadline != null) parts.push(c.hasDeadline ? 'has due date' : 'no due date')
  if (c.hasFollowup != null) parts.push(c.hasFollowup ? 'has follow-up' : 'no follow-up')
  if (parts.length === 0) return null
  return { field: 'dates', label: range ? DATE_FIELD_LABELS_SHORT[c.dateField] : 'Dates', value: parts.join(', ') }
}

/**
 * Chips for the narrowing clauses of a filter, in chip order (people, tags,
 * dates, status, project, text). `showCompleted` adds a trailing
 * `completed` chip only when `includeCompleted` is set (screen filters show
 * it; a list's own filter keeps it in its options).
 */
export function filterChips(c: FilterClauses, names: FilterChipNames, includeCompleted = false): FilterChip[] {
  const chips: FilterChip[] = []
  const byId = <T extends { id?: number; name: string }>(rows: readonly T[]) => (id: number) => rows.find((r) => r.id === id)?.name
  if (c.personIds != null) chips.push({ field: 'people', label: 'People', value: namesValue(c.personIds, byId(names.people), 'Unassigned') })
  if (c.tags != null) chips.push({ field: 'tags', label: 'Tags', value: namesValue(c.tags, byId(names.tags), 'Untagged', '#') })
  const dates = datesChip(c)
  if (dates) chips.push(dates)
  if (c.statusIds != null) chips.push({ field: 'status', label: 'Status', value: namesValue(c.statusIds, byId(names.statuses), 'No status') })
  if (c.projectIds != null) chips.push({ field: 'project', label: 'Project', value: namesValue(c.projectIds, byId(names.projects), 'No project') })
  const text = (c.searchText ?? '').trim()
  if (text !== '') chips.push({ field: 'text', label: 'Text', value: `“${text}”` })
  if (includeCompleted && c.showCompleted) chips.push({ field: 'completed', label: 'Completed', value: 'Completed shown' })
  return chips
}

/** Whether a list predicate narrows anything (`showCompleted` doesn't). */
export function hasNarrowingFilters(p: TodoPredicate): boolean {
  return p.personIds != null
    || p.projectIds != null
    || p.statusIds != null
    || (p.tags ?? null) != null
    || (p.searchText ?? '').trim() !== ''
    || p.dateRangeStart != null
    || p.dateRangeEnd != null
    || p.hasDeadline != null
    || (p.hasFollowup ?? null) != null
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
    case 'project': return { ...p, projectIds: null }
    case 'text': return { ...p, searchText: '' }
    case 'dates': return { ...p, dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: null, hasFollowup: null }
    case 'completed': return { ...p, showCompleted: false }
  }
}
