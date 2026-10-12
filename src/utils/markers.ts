import { MARKER_KEYS, type MarkerKey, type MarkersFilter } from '../models/filter-predicate'
import type { TodoItem } from '../models/todo-item'
import { isEffectivelyUrgent, type UrgentDueWithinDays } from './urgency'

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

/** The markers a filter requires, in display order; empty for no filter. */
export function activeMarkers(m: MarkersFilter | null | undefined): MarkerKey[] {
  if (m == null) return []
  return MARKER_KEYS.filter((k) => m[k] === true)
}

/** Whether a Markers filter narrows anything. */
export function hasMarkers(m: MarkersFilter | null | undefined): boolean {
  return activeMarkers(m).length > 0
}

/** `m` with `key` ticked or unticked; `null` once nothing is ticked. */
export function toggleMarker(m: MarkersFilter | null | undefined, key: MarkerKey): MarkersFilter | null {
  const next: MarkersFilter = {}
  for (const k of activeMarkers(m)) if (k !== key) next[k] = true
  if (m?.[key] !== true) next[key] = true
  return hasMarkers(next) ? next : null
}

/** Whether two Markers filters require the same markers (absent == null == `{}`). */
export function markersEqual(a: MarkersFilter | null | undefined, b: MarkersFilter | null | undefined): boolean {
  const x = activeMarkers(a)
  const y = activeMarkers(b)
  return x.length === y.length && x.every((k, i) => k === y[i])
}

/** `Urgent`, `Urgent +1` — the filter's value as a chip / button shows it. */
export function markersValue(m: MarkersFilter | null | undefined): string {
  const keys = activeMarkers(m)
  const first = keys[0]
  if (first == null) return ''
  return keys.length > 1 ? `${MARKER_LABELS[first]} +${keys.length - 1}` : MARKER_LABELS[first]
}

/** Whether `todo` has a marker (Urgent = effective urgent, flag or due date). */
export function hasMarker(
  todo: Pick<TodoItem, 'urgent' | 'important' | 'focus' | 'dueDate' | 'isCompleted'>,
  key: MarkerKey,
  today: Date,
  range: UrgentDueWithinDays,
): boolean {
  switch (key) {
    case 'urgent': return isEffectivelyUrgent(todo, today, range)
    case 'important': return todo.important === true
    case 'focus': return todo.focus === true
  }
}

/** Whether `todo` has every marker the filter requires (strict AND). */
export function matchesMarkers(
  todo: Pick<TodoItem, 'urgent' | 'important' | 'focus' | 'dueDate' | 'isCompleted'>,
  m: MarkersFilter | null | undefined,
  today: Date,
  range: UrgentDueWithinDays,
): boolean {
  return activeMarkers(m).every((k) => hasMarker(todo, k, today, range))
}
