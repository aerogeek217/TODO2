import { HOT_MARKERS, MARKER_KEYS, type MarkerKey, type MarkerSet, type MarkersFilter } from '../models/filter-predicate'
import { hasMarker, isHot, type HotRule, type MarkerFields } from './hot'
import type { UrgentDueWithinDays } from './urgency'

/** Display names of the task markers. */
export const MARKER_LABELS: Record<MarkerKey, string> = {
  urgent: 'Urgent',
  important: 'Important',
  focus: 'Focus',
}

/** The colour token of each marker. */
export const MARKER_COLOR: Record<MarkerKey, string> = {
  urgent: 'var(--color-marker-urgent)',
  important: 'var(--color-marker-important)',
  focus: 'var(--color-marker-focus)',
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
