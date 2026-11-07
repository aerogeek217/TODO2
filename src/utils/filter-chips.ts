import { type DateAnchor, type DateFilters, type DateMatch, type FilterClauses, type FilterNegation, type MarkersFilter, type NegatableField, type Person, type Status, type Tag, type TodoPredicate } from '../models'
import type { DateField } from '../models/app-view'
import { startOfDay } from './date'
import { rollingDayLabel } from './date-anchor'
import { activeDateFields, hasDateFilters, withDateMatch } from './date-filters'
import { resolveDateAnchor, type WeekStart } from './effective-date'
import { isNegated, withIdFilter, type IdList } from './filter-negation'
import { DATE_FIELD_LABELS_SHORT, NO_STATUS_LABEL, NO_TAGS_LABEL, UNASSIGNED_LABEL } from './filter-labels'
import { formatFollowupDate } from './followup'
import { hasMarkers, MARKERS_LABEL, markerClauseNames, markersHideLine, withMarkerClause } from './markers'
import { printExpression, type ExpressionNames } from './filter-expression'

/** The filter fields a chip stands for. */
export type FilterChipField = 'people' | 'tags' | 'dates' | 'status' | 'markers' | 'text' | 'completed'

/** The filter fields in display order: the top bar's buttons, a list's chips and its + Filter menu. */
export const FILTER_FIELD_ORDER: readonly FilterChipField[] = ['markers', 'tags', 'people', 'dates', 'status', 'text', 'completed']

export interface FilterChip {
  field: FilterChipField
  /** A date chip's date type (one chip per date type that filters). */
  dateField?: DateField
  /** A Priority chip: which condition of the Priority filter it shows (Priority repeats). */
  markerIndex?: number
  /** Field name, e.g. `Due`, `Status` (list chips show it muted before the value). */
  label: string
  /** Value text, e.g. `within the next 14 days`, `Alice or Ben`, `#q4`, `not Waiting`, `Urgent, not Important`. */
  value: string
  /** An "is not" People / Status / Tags chip or date range: its value starts `not ` (or reads `has a tag`). */
  negated?: true
  /**
   * Spelled out for a tooltip — an "is not" chip (what it
   * hides), a multi-value "is" chip (every value, and that any of them
   * will do), a date range (its exact days, given `FilterChipNames.day`);
   * absent when the chip says it all.
   */
  tooltip?: string
}

/**
 * Entity registries the chip text resolves ids against, and the day a date
 * range chip's tooltip resolves its days against (absent: words only — the
 * summaries need no tooltip).
 */
export interface FilterChipNames {
  people: readonly Person[]
  tags: readonly Tag[]
  statuses: readonly Status[]
  day?: ChipDay
}

/**
 * Narrowing clauses of a filter, in the shape predicates, their or groups
 * and screen criteria share (an or group has no Show completed).
 */
export interface ChipClauses {
  showCompleted?: boolean
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

/** The most names an "is not" tooltip spells out; the rest are counted. */
export const TOOLTIP_NAMES_MAX = 10

/** `a, b or c`; past `TOOLTIP_NAMES_MAX` names, `a, b, … j and 5 more`. */
function orList(names: readonly string[]): string {
  if (names.length > TOOLTIP_NAMES_MAX) {
    return `${names.slice(0, TOOLTIP_NAMES_MAX).join(', ')} and ${names.length - TOOLTIP_NAMES_MAX} more`
  }
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/**
 * An id → name lookup over `rows`, built once per field that filters (a
 * stored list may hold many ids, each one a lookup); the first row with an
 * id wins, as a scan would.
 */
function namesById(rows: readonly { id?: number; name: string }[]): (id: number) => string | undefined {
  const names = new Map<number, string>()
  for (const r of rows) if (r.id != null && !names.has(r.id)) names.set(r.id, r.name)
  return (id) => names.get(id)
}

/** What an "is not" chip hides, spelled out (its tooltip). */
function negatedTooltip(field: NegatableField, names: readonly string[]): string {
  switch (field) {
    case 'statusIds': return `Status: not ${orList(names)}\nHides tasks with ${names.length === 1 ? 'that status' : 'any of these statuses'}`
    case 'personIds': return `People: not ${orList(names)}\nHides tasks assigned to ${names.length === 1 ? 'them' : 'any of them'}`
    case 'tags': {
      // No tags ticked: untagged tasks go too.
      const tags = names.filter((n) => n !== NO_TAGS_LABEL)
      if (tags.length === names.length) return `Tags: not ${orList(names)}\nHides tasks with ${names.length === 1 ? 'that tag' : 'any of these tags'}; untagged tasks stay`
      if (tags.length === 0) return `Tags: has a tag\nHides untagged tasks`
      return `Tags: not ${orList(names)}\nHides untagged tasks and tasks with ${tags.length === 1 ? 'that tag' : 'any of these tags'}`
    }
  }
}

/**
 * A chip's values joined with "or": `A`, `A or B`, `A, B or C`, past three
 * `A, B or 2 more`; `none` when nothing is picked.
 */
export function orValue(names: readonly string[]): string {
  const [first, second, third] = names
  if (first == null) return 'none'
  if (second == null) return first
  if (third == null) return `${first} or ${second}`
  if (names.length === 3) return `${first}, ${second} or ${third}`
  return `${first}, ${second} or ${names.length - 2} more`
}

/** What a multi-value "is" chip keeps, spelled out (its tooltip). */
function anyOfTooltip(label: string, field: 'tags' | 'people' | 'status', names: readonly string[]): string {
  return `${label}: ${orList(names)}
${field === 'status' ? 'Tasks in any of them' : 'Tasks with any of them'}`
}

function dayLabel(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

/**
 * One endpoint in words: `Oct 15`, `today`, `end of week`, `in 3 days`, `2
 * days ago` — one day either way as its name (`yesterday`, `tomorrow`), as
 * the tokens read.
 */
export function describeAnchor(anchor: DateAnchor): string {
  switch (anchor.kind) {
    case 'fixed':
      return new Date(anchor.iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    case 'relative':
      return rollingDayLabel(anchor.token)
    case 'offset':
      if (anchor.days === 0) return 'today'
      if (anchor.days === 1) return 'tomorrow'
      if (anchor.days === -1) return 'yesterday'
      return anchor.days > 0 ? `in ${dayLabel(anchor.days)}` : `${dayLabel(-anchor.days)} ago`
  }
}

/**
 * An anchor that names a day by its distance from today — a day offset, or
 * `yesterday` / `today` / `tomorrow` — as that distance; `null` for a fixed
 * date, a week or month token, or no anchor.
 */
function dayOffset(a: DateAnchor | null): number | null {
  if (a == null || a.kind === 'fixed') return null
  if (a.kind === 'offset') return a.days
  switch (a.token) {
    case 'yesterday': return -1
    case 'today': return 0
    case 'tomorrow': return 1
    default: return null
  }
}

/**
 * A date range in words that can't be misread (both ends are inclusive of
 * their whole day; an open end takes everything beyond):
 * - one day alone: `today`, `Oct 30`, `end of week`;
 * - today and a day offset: `within the next 14 days`, `within the last 7
 *   days` (`today or tomorrow`, `yesterday or today` for one day);
 * - a To alone: N or more days ago as `7+ days ago`, yesterday as `before
 *   today`, another day as `today or earlier` / `in 14 days or earlier`, a
 *   date or week / month token as `on or before Oct 26` / `on or before end
 *   of week`;
 * - a From alone: N or more days ahead as `7+ days ahead`, tomorrow as
 *   `after today`, another day as `today or later` / `30 days ago or later`,
 *   a date or token as `on or after Oct 26` / `on or after start of month`;
 * - two other ends: `Oct 1 – Oct 15`, `7 days ago – yesterday`.
 * Never `up to`, `by` or a bare `from`.
 */
export function describeRange(start: DateAnchor | null, end: DateAnchor | null): string {
  const s = dayOffset(start)
  const e = dayOffset(end)
  if (start && end) {
    if (JSON.stringify(start) === JSON.stringify(end) || (s != null && s === e)) return describeAnchor(start)
    if (s === 0 && e != null && e > 0) return e === 1 ? 'today or tomorrow' : `within the next ${dayLabel(e)}`
    if (e === 0 && s != null && s < 0) return s === -1 ? 'yesterday or today' : `within the last ${dayLabel(-s)}`
    return `${describeAnchor(start)} – ${describeAnchor(end)}`
  }
  if (end) {
    if (e == null) return `on or before ${describeAnchor(end)}`
    if (e === -1) return 'before today'
    if (e < -1) return `${-e}+ days ago`
    return `${describeAnchor(end)} or earlier`
  }
  if (start) {
    if (s == null) return `on or after ${describeAnchor(start)}`
    if (s === 1) return 'after today'
    if (s > 1) return `${s}+ days ahead`
    return `${describeAnchor(start)} or later`
  }
  return ''
}

/** How a type's clause names its tasks without the date: never followed up; no due date / next follow-up. */
function noDateWord(field: DateField): string {
  return field === 'lastFollowup' ? 'never' : 'none'
}

/**
 * One `field` clause in words: `within the next 14 days`, `on or before Oct
 * 31, or none` (Last follow-up: `, or never`); Show Any `any date`, None
 * `none` (Last follow-up: `never`); an "is not" range with `not` (`not
 * within the next 14 days`, `not within the last 7 days`).
 */
export function describeDateMatch(m: DateMatch, field: DateField): string {
  if (m.match === 'set') return 'any date'
  if (m.match === 'unset') return noDateWord(field)
  const range = describeRange(m.start, m.end)
  if (m.not === true) return `not ${range}`
  return m.includeNoDate === true ? `${range}, or ${noDateWord(field)}` : range
}

/** Today and the week start a date chip's tooltip resolves its range's days against. */
export interface ChipDay {
  today: Date
  weekStartsOn: WeekStart
}

/**
 * How a date type's tooltip names its tasks: the range's subject (`Last
 * followed up on or before …`), the tasks an "is not" range hides, and —
 * on the optional types — the tasks without the date (`, or never`; `tasks
 * never followed up stay`).
 */
const RANGE_WORDS: Record<DateField, { subject: string; tasks: string; orNone?: string; noneStay?: string }> = {
  deadline: { subject: 'Due', tasks: 'tasks due', orNone: 'or no due date', noneStay: 'tasks with no due date stay' },
  followup: { subject: 'Next follow-up', tasks: 'tasks with a next follow-up', orNone: 'or no next follow-up', noneStay: 'tasks with none stay' },
  lastFollowup: { subject: 'Last followed up', tasks: 'tasks last followed up', orNone: 'or never', noneStay: 'tasks never followed up stay' },
  completed: { subject: 'Completed', tasks: 'tasks completed' },
  created: { subject: 'Created', tasks: 'tasks created' },
  modified: { subject: 'Modified', tasks: 'tasks modified' },
}

/**
 * The days a range covers, resolved against `day`: `on Mon 2 Nov`, `on or
 * before Mon 26 Oct`, `on or after Sun 1 Nov`, `from Mon 2 Nov through Mon
 * 16 Nov` (both ends included).
 */
function rangeDaysWords(start: DateAnchor | null, end: DateAnchor | null, day: ChipDay): string {
  const resolve = (a: DateAnchor) => startOfDay(resolveDateAnchor(a, day.today, day.weekStartsOn))
  // No-break spaces: a tooltip wraps between the words, never inside a date.
  const words = (d: Date) => formatFollowupDate(d, day.today).replaceAll(' ', '\u00a0')
  const first = start ? resolve(start) : null
  const last = end ? resolve(end) : null
  if (first && last) {
    if (first.getTime() === last.getTime()) return `on ${words(first)}`
    const through = `from ${words(first)} through ${words(last)}`
    return first > last ? `${through} (no day: it starts after it ends)` : through
  }
  if (last) return `on or before ${words(last)}`
  return first ? `on or after ${words(first)}` : ''
}

/**
 * A date range chip's tooltip: its words, then the exact days — `Last
 * follow-up: 7+ days ago, or never` / `Last followed up on or before Mon 26
 * Oct, or never`; an "is not" range says what it hides (`Hides tasks with a
 * next follow-up from Mon 2 Nov through Mon 16 Nov; tasks with none stay`).
 * Without `day` only an "is not" range has one (`… in that range …`).
 */
function dateRangeTooltip(f: DateField, m: DateMatch, day: ChipDay | undefined): string | undefined {
  if (m.match !== 'range' || (m.start == null && m.end == null)) return undefined
  const head = `${DATE_FIELD_LABELS_SHORT[f]}: ${describeDateMatch(m, f)}`
  const w = RANGE_WORDS[f]
  const days = day ? rangeDaysWords(m.start, m.end, day) : null
  if (m.not === true) {
    return `${head}\nHides ${w.tasks} ${days ?? 'in that range'}${w.noneStay ? `; ${w.noneStay}` : ''}`
  }
  if (days == null) return undefined
  return `${head}\n${w.subject} ${days}${m.includeNoDate === true && w.orNone ? `, ${w.orNone}` : ''}`
}

/**
 * One chip per date type that filters, in tab order: `Due` `within the next
 * 14 days`, `Created` `on or after start of month`, a range's tooltip
 * spelling its days when `day` is given; an "is not" range is marked as an
 * "is not" id chip is — `not …`, `negated`, a tooltip saying what it hides.
 */
function dateChips(dates: DateFilters, day: ChipDay | undefined): FilterChip[] {
  return activeDateFields(dates).flatMap((f) => {
    const m = dates[f]
    if (!m) return []
    const label = DATE_FIELD_LABELS_SHORT[f]
    const value = describeDateMatch(m, f)
    const tooltip = dateRangeTooltip(f, m, day)
    const chip: FilterChip = { field: 'dates', dateField: f, label, value, ...(m.match === 'range' && m.not === true ? { negated: true as const } : {}) }
    return [tooltip ? { ...chip, tooltip } : chip]
  })
}

/** A key unique among a filter's chips: the field, `dates:<type>` for a date chip, `markers:<index>` for a Priority chip. */
export function chipKey(chip: Pick<FilterChip, 'field' | 'dateField' | 'markerIndex'>): string {
  if (chip.markerIndex !== undefined) return `${chip.field}:${chip.markerIndex}`
  return chip.dateField ? `${chip.field}:${chip.dateField}` : chip.field
}

/** Each date type that filters as `<Type> <clause>`: `Due within the next 14 days`. */
function dateClauses(dates: DateFilters): { field: DateField; match: DateMatch; text: string; words: string }[] {
  return activeDateFields(dates).flatMap((f) => {
    const m = dates[f]
    return m ? [{ field: f, match: m, text: `${DATE_FIELD_LABELS_SHORT[f]} ${describeDateMatch(m, f)}`, words: describeDateMatch(m, f) }] : []
  })
}

/**
 * The date filters as one value (the top bar's Dates button, the Filters
 * menu's and the phone sheet's Dates row): one type → its clause
 * (`Due within the next 14 days`); two → their short names (`Due + Created`); three
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
 * The Dates button's tooltip. One date type: given `day`, its range's chip
 * tooltip (its words, then its exact days); else `null`. From two on: a line
 * per type (`Due: within the next 14 days`; given `day`, a range's days
 * after a `·` — `· from Mon 2 Nov through Mon 16 Nov`, `· not from …`),
 * then how they combine.
 */
export function datesTooltip(dates: DateFilters, day?: ChipDay): string | null {
  const clauses = dateClauses(dates)
  const [first, second] = clauses
  if (!first) return null
  if (!second) return day ? dateRangeTooltip(first.field, first.match, day) ?? null : null
  const both = clauses.length === 2 ? 'both' : 'all'
  const days = (m: DateMatch) => {
    if (!day || m.match !== 'range') return ''
    return ` · ${m.not === true ? 'not ' : ''}${rangeDaysWords(m.start, m.end, day)}`
  }
  return [
    ...clauses.map((c) => `${DATE_FIELD_LABELS_SHORT[c.field]}: ${c.words}${days(c.match)}`),
    `Tasks must match ${both} · × clears ${both}`,
  ].join('\n')
}

/** Every date type's clause for a screen reader: `Due within the next 14 days; Created on or after start of month`. */
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
export function filterChips(c: ChipClauses, names: FilterChipNames, includeCompleted = false): FilterChip[] {
  const chips: FilterChip[] = []
  // Priority: a chip per condition, read as a Status chip (`Urgent or Important`, `not Focus`).
  ;(c.markers ?? []).forEach((clause, markerIndex) => {
    if (clause.values.length === 0) return
    const names = markerClauseNames(clause)
    const value = orValue(names)
    const base = { field: 'markers' as const, markerIndex, label: MARKERS_LABEL }
    if (clause.not) {
      chips.push({ ...base, value: `not ${value}`, negated: true, tooltip: `${MARKERS_LABEL}: not ${orList(names)}\n${markersHideLine(clause)}` })
    } else if (names.length > 1) {
      chips.push({ ...base, value, tooltip: `${MARKERS_LABEL}: ${orList(names)}\nTasks with any of them` })
    } else {
      chips.push({ ...base, value })
    }
  })
  // An id chip: `Alice or Ben` with a tooltip spelling every value, or —
  // "is not" — `not Alice or Ben` with a tooltip saying what it hides.
  const idChip = (field: 'tags' | 'people' | 'status', key: NegatableField, label: string, ids: Iterable<number>, nameOf: (id: number) => string | undefined, zeroName: string, prefix = ''): FilterChip => {
    const resolved = allNames(ids, nameOf, zeroName, prefix)
    const value = orValue(resolved)
    if (!isNegated(c, key)) return resolved.length > 1 ? { field, label, value, tooltip: anyOfTooltip(label, field, resolved) } : { field, label, value }
    const tooltip = negatedTooltip(key, resolved)
    // "Tags is not No tags" alone reads the way round it means.
    if (field === 'tags' && [...ids].every((id) => id === 0)) return { field, label, value: 'has a tag', negated: true, tooltip }
    return { field, label, value: `not ${value}`, negated: true, tooltip }
  }
  if (c.tags != null) chips.push(idChip('tags', 'tags', 'Tags', c.tags, namesById(names.tags), NO_TAGS_LABEL, '#'))
  if (c.personIds != null) chips.push(idChip('people', 'personIds', 'People', c.personIds, namesById(names.people), UNASSIGNED_LABEL))
  chips.push(...dateChips(c.dates, names.day))
  if (c.statusIds != null) chips.push(idChip('status', 'statusIds', 'Status', c.statusIds, namesById(names.statuses), NO_STATUS_LABEL))
  const text = (c.searchText ?? '').trim()
  if (text !== '') chips.push({ field: 'text', label: 'Text', value: `“${text}”` })
  if (includeCompleted && c.showCompleted === true) chips.push({ field: 'completed', label: 'Completed', value: 'Completed shown' })
  return chips
}

/** Whether a list predicate narrows anything (`showCompleted` doesn't; an or group that filters does). */
export function hasNarrowingFilters(p: TodoPredicate): boolean {
  return p.personIds != null
    || p.statusIds != null
    || (p.tags ?? null) != null
    || (p.searchText ?? '').trim() !== ''
    || hasDateFilters(p.dates)
    || hasMarkers(p.markers)
    || p.expression != null
}

/** The names an expression prints with (`printExpression`), read from the chips' names. */
export function expressionNamesOf(names: Pick<FilterChipNames, 'people' | 'tags' | 'statuses'>): ExpressionNames {
  const nameOf = (rows: readonly { id?: number; name: string }[], id: number) => rows.find((r) => r.id === id)?.name
  return {
    person: (id) => nameOf(names.people, id),
    tag: (id) => nameOf(names.tags, id),
    status: (id) => nameOf(names.statuses, id),
  }
}

/** A predicate's expression as text (`(/focus or /urgent) and @Aisha`), Show completed left out; `''` without one. */
export function expressionText(p: Pick<TodoPredicate, 'expression'>, names: Pick<FilterChipNames, 'people' | 'tags' | 'statuses'>): string {
  return p.expression ? printExpression(p.expression, false, expressionNamesOf(names)) : ''
}

/**
 * One item of a filter line: a chip of a Graphical filter, or a filter
 * written as an expression, as its text (a single item).
 */
export type LineItem =
  | { kind: 'chip'; chip: FilterChip }
  | { kind: 'expression'; text: string }

/** A line item of a Graphical filter: a chip. */
export type GraphicalLineItem = Exclude<LineItem, { kind: 'expression' }>

/** Whether `item` is a chip (not an expression). */
export function isGraphicalItem(item: LineItem): item is GraphicalLineItem {
  return item.kind !== 'expression'
}

/** A predicate's filter line: its chips in `FILTER_FIELD_ORDER`, or its expression. */
export function predicateLineItems(p: TodoPredicate, names: FilterChipNames): LineItem[] {
  if (p.expression) return [{ kind: 'expression', text: expressionText(p, names) }]
  return filterChips(p, names).map((chip) => ({ kind: 'chip', chip }))
}

/** One chip in words: `Status Waiting`. */
function chipWords(c: FilterChip): string {
  return `${c.label} ${c.value}`
}

/** The filters in words, e.g. `Status Waiting · Due within the next 14 days`; an expression as its text. */
export function describeFilters(items: readonly (FilterChip | LineItem)[]): string {
  return items.map((item) => {
    if (!('kind' in item)) return chipWords(item)
    return item.kind === 'expression' ? item.text : chipWords(item.chip)
  }).join(' · ')
}
/** One chip in a few words: `@Priya`, `#q4`, `Status: Waiting`. */
function chipHint(c: FilterChip): string {
  if (c.field === 'people') return `@${c.value}`
  if (c.field === 'tags') return c.value
  return `${c.label}: ${c.value}`
}

/**
 * A list's filters in a few words, for a hint under its name (a dashboard
 * list tile, Copy from's rows): `Status: Waiting`, `@Priya`, `#q4`, an
 * expression as its text; `All tasks` with none.
 */
export function listFilterHint(items: readonly (FilterChip | LineItem)[]): string {
  if (items.length === 0) return 'All tasks'
  return items.map((item) => {
    if (!('kind' in item)) return chipHint(item)
    return item.kind === 'expression' ? item.text : chipHint(item.chip)
  }).join(' · ')
}

/**
 * The clauses without those of one chip field — for `dates`, only
 * `dateField`'s clause when given (a date chip's ×), else every date type.
 * Clearing People / Status / Tags drops its "is not" switch too; clearing
 * `completed` turns Show completed off (clauses without it are returned as
 * they are).
 */
export function clearChipField<T extends ChipClauses & FilterClauses>(p: T, field: FilterChipField, dateField?: DateField, markerIndex?: number): T {
  switch (field) {
    case 'people': return withIdFilter(p, 'personIds', null, false)
    case 'tags': return withIdFilter(p, 'tags', null, false)
    case 'status': return withIdFilter(p, 'statusIds', null, false)
    case 'markers': return { ...p, markers: markerIndex === undefined ? null : withMarkerClause(p.markers, markerIndex, null) }
    case 'text': return { ...p, searchText: '' }
    case 'dates': return { ...p, dates: dateField ? withDateMatch(p.dates, dateField, null) : {} }
    case 'completed': return p.showCompleted === undefined ? p : { ...p, showCompleted: false }
  }
}

/** The predicate without one chip's clause. */
export function removeChip(p: TodoPredicate, chip: Pick<FilterChip, 'field' | 'dateField' | 'markerIndex'>): TodoPredicate {
  return clearChipField(p, chip.field, chip.dateField, chip.markerIndex)
}
