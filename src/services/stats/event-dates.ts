import type { TodoEvent } from '../../models'
import { FUZZY_TOKENS, type FuzzyToken } from '../../models/scheduled-value'
import type { WeekStart } from '../../utils/effective-date'
import { resolveFuzzy } from '../../utils/effective-date'

/**
 * Resolve a `TodoEvent` `fromValue` / `toValue` to a concrete Date.
 *
 * - ISO strings parse via `Date.parse` (UTC, lex-comparable to bucket epoch ms).
 * - `'fuzzy:<token>'` resolves through `resolveFuzzy(token, asOf, weekStartsOn)`,
 *   so a fuzzy `today` recorded last Tuesday resolves to *that Tuesday*, not
 *   today. Callers pass the event's `timestamp` as `asOf` so historical fuzzy
 *   values land in the bucket they actually meant at the time.
 * - Anything else (numbers, null, malformed strings, unknown fuzzy tokens)
 *   returns `null`.
 *
 * The `as-of-event-timestamp` semantic is the closest we can get to a true
 * retroactive resolve without a separately stored anchor date — close enough
 * because the user typed `today` *as of* their action, which the event records.
 */
export function resolveEventDateValue(
  v: TodoEvent['fromValue'] | TodoEvent['toValue'],
  asOf: Date,
  weekStartsOn: WeekStart,
): Date | null {
  if (typeof v !== 'string') return null
  if (v.startsWith('fuzzy:')) {
    const raw = v.slice('fuzzy:'.length)
    if (!(FUZZY_TOKENS as readonly string[]).includes(raw)) return null
    return resolveFuzzy(raw as FuzzyToken, asOf, weekStartsOn)
  }
  const t = Date.parse(v)
  return isNaN(t) ? null : new Date(t)
}

/**
 * True iff a scheduling event represents a future-shift (the user pushed the
 * date later). Both ends must resolve to concrete Dates and `to > from`. The
 * event's own `timestamp` anchors fuzzy resolution; an event at T with
 * `fromValue: 'fuzzy:today'` treats `today` as the day of T.
 */
export function isFutureShift(
  fromValue: TodoEvent['fromValue'],
  toValue: TodoEvent['toValue'],
  asOf: Date,
  weekStartsOn: WeekStart,
): boolean {
  const from = resolveEventDateValue(fromValue, asOf, weekStartsOn)
  const to = resolveEventDateValue(toValue, asOf, weekStartsOn)
  if (!from || !to) return false
  return to.getTime() > from.getTime()
}
