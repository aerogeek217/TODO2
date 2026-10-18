import { HOT_MARKERS, MARKER_KEYS, type MarkerKey, type MarkerSet, type MarkersFilter } from '../models/filter-predicate'
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
 * The single markers a filter requires, in display order; empty for no
 * filter and for Hot (Hot is its own choice, not a set of ticked markers).
 */
export function activeMarkers(m: MarkersFilter | null | undefined): MarkerKey[] {
  if (m == null || isHotFilter(m)) return []
  return MARKER_KEYS.filter((k) => m[k] === true)
}

/** Whether a Markers filter narrows anything (Hot, or at least one ticked marker). */
export function hasMarkers(m: MarkersFilter | null | undefined): boolean {
  return isHotFilter(m) || activeMarkers(m).length > 0
}

/**
 * `m` with `key` ticked or unticked; `null` once nothing is ticked. While
 * Hot is on the single markers are disabled: `m` comes back unchanged.
 */
export function toggleMarker(m: MarkersFilter | null | undefined, key: MarkerKey): MarkersFilter | null {
  if (isHotFilter(m)) return m
  const next: MarkerSet = {}
  for (const k of activeMarkers(m)) if (k !== key) next[k] = true
  if (m?.[key] !== true) next[key] = true
  return activeMarkers(next).length > 0 ? next : null
}

/** Hot ticked (clearing any single markers) or unticked (no filter). */
export function toggleHot(m: MarkersFilter | null | undefined): MarkersFilter | null {
  return isHotFilter(m) ? null : HOT_MARKERS
}

/** Whether two Markers filters require the same (absent == null == `{}`; Hot only equals Hot). */
export function markersEqual(a: MarkersFilter | null | undefined, b: MarkersFilter | null | undefined): boolean {
  if (isHotFilter(a) || isHotFilter(b)) return a === b
  const x = activeMarkers(a)
  const y = activeMarkers(b)
  return x.length === y.length && x.every((k, i) => k === y[i])
}

/** `Hot`, `Urgent`, `Urgent +1` — the filter's value as a chip / button shows it. */
export function markersValue(m: MarkersFilter | null | undefined): string {
  if (isHotFilter(m)) return HOT_LABEL
  const keys = activeMarkers(m)
  const first = keys[0]
  if (first == null) return ''
  return keys.length > 1 ? `${MARKER_LABELS[first]} +${keys.length - 1}` : MARKER_LABELS[first]
}

/**
 * Whether `todo` passes the Markers filter: hot by `settings.hotRule`, or
 * having every ticked marker (strict AND; Urgent = effective urgent).
 */
export function matchesMarkers(
  todo: MarkerFields,
  m: MarkersFilter | null | undefined,
  today: Date,
  settings: MarkerSettings,
): boolean {
  if (isHotFilter(m)) return isHot(todo, settings.hotRule, today, settings.urgentRange)
  return activeMarkers(m).every((k) => hasMarker(todo, k, today, settings.urgentRange))
}
