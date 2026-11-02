import type { DateAnchor, RelativeDateToken } from '../models/filter-predicate'
import { RELATIVE_DATE_TOKENS } from '../models/filter-predicate'

/**
 * Read a persisted date-range endpoint. Accepts the current `DateAnchor`
 * object shape and the legacy pre-DSL-extension ISO-string form, auto-upgrading
 * the latter to `{kind:'fixed', iso}`. Unknown shapes return `null` so callers
 * can treat garbage as "no filter" instead of crashing.
 *
 * Lives in `utils/` (not `stores/`) so the `data/` migration + restore paths
 * can call it without introducing a data→stores dependency.
 */
export function readDateAnchor(v: unknown): DateAnchor | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return { kind: 'fixed', iso: v }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.kind === 'fixed' && typeof o.iso === 'string') {
      return { kind: 'fixed', iso: o.iso }
    }
    if (o.kind === 'relative' && typeof o.token === 'string'
        && (RELATIVE_DATE_TOKENS as readonly string[]).includes(o.token)) {
      return { kind: 'relative', token: o.token as RelativeDateToken }
    }
    if (o.kind === 'offset' && typeof o.days === 'number' && Number.isFinite(o.days)) {
      return { kind: 'offset', days: Math.trunc(o.days) }
    }
  }
  return null
}

/** Labels of the relative date tokens, as the date inputs show them. */
export const RELATIVE_TOKEN_LABELS: Record<RelativeDateToken, string> = {
  'yesterday': 'Yesterday',
  'today': 'Today',
  'tomorrow': 'Tomorrow',
  'start-of-week': 'Start of week',
  'end-of-week': 'End of week',
  'start-of-next-week': 'Start of next week',
  'end-of-next-week': 'End of next week',
  'start-of-month': 'Start of month',
  'end-of-month': 'End of month',
  'start-of-next-month': 'Start of next month',
  'end-of-next-month': 'End of next month',
  'end-of-month-plus-3': 'End of (month + 3)',
}

/** Which end of a date range a date input authors. */
export type DateAnchorSide = 'from' | 'to'

/**
 * The named days each end's list offers, in order (labels from
 * `RELATIVE_TOKEN_LABELS`): a range starts at the start of a week and ends at
 * its end. Any other token a stored filter holds is still shown, as an extra
 * option, while it is the value.
 */
export const SIDE_RELATIVE_TOKENS: Record<DateAnchorSide, readonly RelativeDateToken[]> = {
  from: ['today', 'start-of-week'],
  to: ['today', 'end-of-week'],
}

/** A day offset the date inputs offer by name; picking one fills the days field. */
export interface OffsetPreset {
  days: number
  label: string
}

/** The day offsets both ends offer, past then future (a month is 30 days). */
export const OFFSET_PRESETS: readonly OffsetPreset[] = [
  { days: -7, label: '1 week ago' },
  { days: -14, label: '2 weeks ago' },
  { days: -30, label: '1 month ago' },
  { days: 7, label: 'In 1 week' },
  { days: 14, label: 'In 2 weeks' },
  { days: 30, label: 'In 1 month' },
]

/** The named offset for a number of days, if the lists offer one. */
export function offsetPresetFor(days: number): OffsetPreset | undefined {
  return OFFSET_PRESETS.find((p) => p.days === days)
}
