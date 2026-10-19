import { HOT_MARKERS, MARKER_KEYS, type MarkerConditions, type MarkerKey, type MarkersFilter } from '../models/filter-predicate'
import { hasMarker, isHot, type HotRule, type MarkerFields } from './hot'
import { urgentByDateReason, urgentMark, type UrgentDueWithinDays, type UrgentMark } from './urgency'

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

/** Display name of the Markers filter's Hot choice. */
export const HOT_LABEL = 'Hot'

/** The settings a Markers filter is evaluated with: the urgent range and the Hot rule. */
export interface MarkerSettings {
  urgentRange: UrgentDueWithinDays
  hotRule: HotRule
}

/** Whether the Markers filter is Hot. */
export function isHotFilter(m: MarkersFilter | null | undefined): m is typeof HOT_MARKERS {
  return m === HOT_MARKERS
}

/**
 * What a filter asks of `key`: `true` (Yes, must have it), `false` (No, must
 * not), `undefined` (Any) — also for no filter and for Hot (Hot is its own
 * choice, not a condition per marker).
 */
export function markerCondition(m: MarkersFilter | null | undefined, key: MarkerKey): boolean | undefined {
  if (m == null || isHotFilter(m)) return undefined
  const v = m[key]
  return typeof v === 'boolean' ? v : undefined
}

/**
 * The single markers a filter tests (Yes or No), in display order; empty for
 * no filter and for Hot.
 */
export function activeMarkers(m: MarkersFilter | null | undefined): MarkerKey[] {
  return MARKER_KEYS.filter((k) => markerCondition(m, k) !== undefined)
}

/**
 * The filter's conditions as a fresh object with the keys in display order,
 * `false` and `true` only (`{}` for no filter and for Hot).
 */
export function markerConditions(m: MarkersFilter | null | undefined): MarkerConditions {
  const out: MarkerConditions = {}
  for (const k of activeMarkers(m)) out[k] = markerCondition(m, k)
  return out
}

/** Whether a Markers filter narrows anything (Hot, or a Yes / No on at least one marker). */
export function hasMarkers(m: MarkersFilter | null | undefined): boolean {
  return isHotFilter(m) || activeMarkers(m).length > 0
}

/**
 * `m` with `key` set to Yes (`true`), No (`false`) or Any (`undefined`);
 * `null` once no marker is tested. While Hot is on the single markers are
 * disabled: `m` comes back unchanged.
 */
export function withMarkerCondition(
  m: MarkersFilter | null | undefined,
  key: MarkerKey,
  condition: boolean | undefined,
): MarkersFilter | null {
  if (isHotFilter(m)) return m
  const next: MarkerConditions = {}
  for (const k of MARKER_KEYS) {
    const v = k === key ? condition : markerCondition(m, k)
    if (v !== undefined) next[k] = v
  }
  return activeMarkers(next).length > 0 ? next : null
}

/** Hot ticked (clearing any single markers) or unticked (no filter). */
export function toggleHot(m: MarkersFilter | null | undefined): MarkersFilter | null {
  return isHotFilter(m) ? null : HOT_MARKERS
}

/** Whether two Markers filters ask the same (absent == null == `{}`; Hot only equals Hot). */
export function markersEqual(a: MarkersFilter | null | undefined, b: MarkersFilter | null | undefined): boolean {
  if (isHotFilter(a) || isHotFilter(b)) return a === b
  return MARKER_KEYS.every((k) => markerCondition(a, k) === markerCondition(b, k))
}

/**
 * `Hot`, `Urgent`, `Focus, Urgent, not Important` — the filter's value as a
 * chip / button shows it: every tested marker in display order, a No one as
 * `not <marker>`.
 */
export function markersValue(m: MarkersFilter | null | undefined): string {
  if (isHotFilter(m)) return HOT_LABEL
  return activeMarkers(m)
    .map((k) => (markerCondition(m, k) === false ? `not ${MARKER_LABELS[k]}` : MARKER_LABELS[k]))
    .join(', ')
}

/** `a`, `a or b`, `a, b or c`. */
function orNames(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/**
 * The tooltip of a Priority filter with a No: its value, then what it hides
 * (`Hides tasks that are Important`; for Urgent, `(flagged or due soon)`).
 * `null` when no marker is No.
 */
export function markersTooltip(m: MarkersFilter | null | undefined): string | null {
  const excluded = activeMarkers(m).filter((k) => markerCondition(m, k) === false)
  if (excluded.length === 0) return null
  const names = excluded.map((k) => (k === 'urgent' ? `${MARKER_LABELS[k]} (flagged or due soon)` : MARKER_LABELS[k]))
  return `${MARKERS_LABEL}: ${markersValue(m)}\nHides tasks that are ${orNames(names)}`
}

/**
 * Whether `todo` passes the Markers filter: hot by `settings.hotRule`, or
 * meeting every marker's condition — having each Yes marker and none of the
 * No ones (strict AND; Urgent = effective urgent).
 */
export function matchesMarkers(
  todo: MarkerFields,
  m: MarkersFilter | null | undefined,
  today: Date,
  settings: MarkerSettings,
): boolean {
  if (isHotFilter(m)) return isHot(todo, settings.hotRule, today, settings.urgentRange)
  return activeMarkers(m).every((k) => hasMarker(todo, k, today, settings.urgentRange) === markerCondition(m, k))
}
