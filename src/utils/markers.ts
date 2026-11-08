import { MARKER_CLAUSES_MAX, MARKER_KEYS, NO_PRIORITY, type MarkerClause, type MarkerConditions, type MarkerKey, type MarkersFilter, type MarkerValue } from '../models/filter-predicate'
import type { TodoItem } from '../models/todo-item'
import { isEffectivelyUrgent, urgentByDateReason, urgentMark, type UrgentDueWithinDays, type UrgentMark } from './urgency'

/** Display names of the task markers. */
export const MARKER_LABELS: Record<MarkerKey, string> = {
  focus: 'Focus',
  urgent: 'Urgent',
  important: 'Important',
}

/** The colour token of each marker. */
export const MARKER_COLOR: Record<MarkerKey, string> = {
  focus: 'var(--color-marker-focus)',
  urgent: 'var(--color-marker-urgent)',
  important: 'var(--color-marker-important)',
}

/** The fields a marker check reads. */
export type MarkerFields = Pick<TodoItem, 'urgent' | 'important' | 'focus' | 'dueDate' | 'isCompleted'>

/** Whether `todo` has a marker (Urgent = effective urgent, flag or due date). */
export function hasMarker(todo: MarkerFields, key: MarkerKey, today: Date, range: UrgentDueWithinDays): boolean {
  switch (key) {
    case 'urgent': return isEffectivelyUrgent(todo, today, range)
    case 'important': return todo.important === true
    case 'focus': return todo.focus === true
  }
}

/** The name of the markers as a group (filters, menus, the task row's marker gutter). */
export const MARKERS_LABEL = 'Priority'

/** A task's markers as the row's gutter shows them. */
export interface MarkerSummary {
  focus: boolean
  /** `flag` = flagged, `date` = urgent only by its due date (the ring), `null` = not urgent. */
  urgent: UrgentMark
  important: boolean
  /** `Priority: Focus, Urgent (due soon)` / `No priority`. */
  label: string
  /** The label, plus why the due date makes it urgent. */
  tooltip: string
}

/** What the marker gutter shows for `todo`, in marker order (Focus › Urgent › Important). */
export function markerSummary(
  todo: MarkerFields,
  today: Date,
  range: UrgentDueWithinDays,
): MarkerSummary {
  const urgent = urgentMark(todo, today, range)
  const on: Record<MarkerKey, string | null> = {
    focus: todo.focus === true ? MARKER_LABELS.focus : null,
    urgent: urgent === 'flag' ? MARKER_LABELS.urgent : urgent === 'date' ? `${MARKER_LABELS.urgent} (due soon)` : null,
    important: todo.important === true ? MARKER_LABELS.important : null,
  }
  const names = MARKER_KEYS.flatMap((k) => on[k] ?? [])
  const label = names.length > 0 ? `${MARKERS_LABEL}: ${names.join(', ')}` : `No ${MARKERS_LABEL.toLowerCase()}`
  const reason = urgent === 'date' ? urgentByDateReason(todo, today, range) : ''
  return {
    focus: on.focus !== null,
    urgent,
    important: on.important !== null,
    label,
    tooltip: reason ? `${label}\n${reason}` : label,
  }
}

/**
 * How a task's checkbox draws its priority (D25 B), the same at every zoom:
 * Urgent and Important are outlines — one ring, or a split ring for both
 * (top-right urgent, bottom-left important), urgent only by its due date
 * dashed —, and Focus is never an outline but a glow around the box, with
 * a ring or without (the box keeping its plain border). A completed task
 * has neither.
 */
export interface PriorityRingSpec {
  kind: 'none' | 'urgent' | 'important' | 'split'
  /** The urgent ring (or the split's urgent half) is dashed: urgent only by the due date. */
  urgentDashed: boolean
  /** Focus: the glow around the box. */
  focusGlow: boolean
}

const NO_RING: PriorityRingSpec = { kind: 'none', urgentDashed: false, focusGlow: false }

/** The ring and glow for a task's markers (`markerSummary`); `completed` = the checked box, neither. */
export function priorityRing(summary: Pick<MarkerSummary, 'focus' | 'urgent' | 'important'>, completed: boolean): PriorityRingSpec {
  if (completed) return NO_RING
  const urgent = summary.urgent !== null
  const kind = urgent && summary.important ? 'split'
    : urgent ? 'urgent'
      : summary.important ? 'important'
        : 'none'
  return { kind, urgentDashed: summary.urgent === 'date', focusGlow: summary.focus }
}

/**
 * A task's place in the Priority sort, first to last: Focus, then Urgent and
 * Important, Urgent, Important, none. Urgent is effective urgent (flagged or
 * due within `range`, overdue included).
 */
export function priorityRank(todo: MarkerFields, today: Date, range: UrgentDueWithinDays): number {
  if (todo.focus === true) return 0
  const urgent = hasMarker(todo, 'urgent', today, range)
  const important = todo.important === true
  if (urgent && important) return 1
  if (urgent) return 2
  return important ? 3 : 4
}

/** The settings a Priority filter is evaluated with: the urgent range. */
export interface MarkerSettings {
  urgentRange: UrgentDueWithinDays
}

/** The name of a Priority filter's "none" choice, and of a list's trailing group. */
export const NO_PRIORITY_LABEL = 'No priority'

/** A Priority condition's values, in display order (Focus › Urgent › Important › No priority). */
export const MARKER_VALUES: readonly MarkerValue[] = [...MARKER_KEYS, NO_PRIORITY]

/** The display name of a value a Priority condition can name. */
export function markerValueLabel(v: MarkerValue): string {
  return v === NO_PRIORITY ? NO_PRIORITY_LABEL : MARKER_LABELS[v]
}

/** Whether a Priority filter narrows anything. */
export function hasMarkers(m: MarkersFilter | null | undefined): boolean {
  return (m ?? []).some((c) => c.values.length > 0)
}

/** A condition with its values once each, in display order; `null` when it names none. */
function normalizeMarkerClause(c: MarkerClause): MarkerClause | null {
  const values = MARKER_VALUES.filter((v) => c.values.includes(v))
  if (values.length === 0) return null
  return c.not ? { values, not: true } : { values }
}

/** The conditions that name something, each in its stored form (at most `MARKER_CLAUSES_MAX`); `null` when none is left. */
export function normalizeMarkersFilter(m: MarkersFilter | null | undefined): MarkersFilter | null {
  const clauses = (m ?? []).flatMap((c) => normalizeMarkerClause(c) ?? []).slice(0, MARKER_CLAUSES_MAX)
  return clauses.length > 0 ? clauses : null
}

/**
 * `m` with condition `index` replaced by `clause`, or removed by `null` (the
 * later ones move up); an index past the last adds one.
 */
export function withMarkerClause(m: MarkersFilter | null | undefined, index: number, clause: MarkerClause | null): MarkersFilter | null {
  const next = [...(m ?? [])]
  if (clause) next[Math.min(index, next.length)] = clause
  else next.splice(index, 1)
  return normalizeMarkersFilter(next)
}

function clauseKey(c: MarkerClause): string {
  return `${c.not ? '!' : ''}${MARKER_VALUES.filter((v) => c.values.includes(v)).join()}`
}

/** Whether two Priority filters ask the same, whatever order their conditions are in (absent == null == `[]`). */
export function markersEqual(a: MarkersFilter | null | undefined, b: MarkersFilter | null | undefined): boolean {
  const keys = (m: MarkersFilter | null | undefined) => (normalizeMarkersFilter(m) ?? []).map(clauseKey).sort().join(';')
  return keys(a) === keys(b)
}

/** The conditions a Priority filter's words read as, in order: `Urgent or Important`, `not Focus`. */
export function markerClauseNames(c: MarkerClause): string[] {
  return c.values.map(markerValueLabel)
}

/** The tooltip of a Priority chip's "is not": `Hides tasks that are Important`; for Urgent, `(flagged or due soon)`. */
export function markersHideLine(c: MarkerClause): string {
  const names = c.values.map((v) => {
    if (v === NO_PRIORITY) return 'without a priority'
    return v === 'urgent' ? `${MARKER_LABELS[v]} (flagged or due soon)` : MARKER_LABELS[v]
  })
  return `Hides tasks that are ${orNames(names)}`
}

/** `a`, `a or b`, `a, b or c`. */
function orNames(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/**
 * What a Priority filter implies for a task it should hold (a new task's
 * seeds, a pane's drop): a one-value `is` sets that flag, an `is not` clears
 * its flags. Several values or `No priority` imply nothing, as Status's. In
 * display order.
 */
export function markerConditions(m: MarkersFilter | null | undefined): MarkerConditions {
  const found: MarkerConditions = {}
  for (const c of m ?? []) {
    const [only] = c.values
    if (c.not) {
      for (const v of c.values) if (v !== NO_PRIORITY) found[v] = false
    } else if (c.values.length === 1 && only !== undefined && only !== NO_PRIORITY) {
      found[only] = true
    }
  }
  const out: MarkerConditions = {}
  for (const k of MARKER_KEYS) {
    const v = found[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

/** The markers `conditions` decide (Yes or No), in display order. */
export function activeMarkers(conditions: MarkerConditions | null | undefined): MarkerKey[] {
  return MARKER_KEYS.filter((k) => conditions?.[k] !== undefined)
}

/** Whether `todo` passes one Priority condition. */
export function matchesMarkerClause(todo: MarkerFields, c: MarkerClause, today: Date, settings: MarkerSettings): boolean {
  const held = (v: MarkerValue) => (v === NO_PRIORITY
    ? MARKER_KEYS.every((k) => !hasMarker(todo, k, today, settings.urgentRange))
    : hasMarker(todo, v, today, settings.urgentRange))
  return c.values.some(held) !== (c.not === true)
}

/** A Priority picker's rows, as the Status picker's entities: id 0 is its "none" row, `No priority`. */
export const MARKER_PICKER_ROWS: readonly { id: number; value: MarkerKey; name: string; color: string }[] =
  MARKER_KEYS.map((value, i) => ({ id: i + 1, value, name: MARKER_LABELS[value], color: MARKER_COLOR[value] }))

/** A Priority condition's values as the picker's row ids. */
export function markerPickerIds(c: MarkerClause | null | undefined): Set<number> {
  return new Set((c?.values ?? []).map((v) => (v === NO_PRIORITY ? 0 : MARKER_PICKER_ROWS.find((r) => r.value === v)?.id ?? 0)))
}

/** The condition the picker's ticked row ids make; `null` with nothing ticked (no condition). */
export function markerClauseOfIds(ids: Iterable<number>, not: boolean): MarkerClause | null {
  const values = [...ids].map((id): MarkerValue => MARKER_PICKER_ROWS.find((r) => r.id === id)?.value ?? NO_PRIORITY)
  if (values.length === 0) return null
  return not ? { values, not: true } : { values }
}
