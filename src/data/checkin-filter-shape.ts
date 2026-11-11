import { emptyPredicate } from '../models/filter-predicate'
import { checkinFilterDrops, checkinFilterOf, type CheckinTaskFilter } from '../utils/checkin-settings'
import { checkPredicateShape, pickPredicate } from './predicate-shape'

/**
 * The stored `checkinTaskFilter` setting — JSON of a list predicate — read
 * and written the one way import validation (and so the audit), the
 * settings store's read and its writes use. Read leniently, as a list's
 * filter is: a malformed clause is dropped (`pickPredicate`), the people
 * filter goes — an expression's terms naming a person too — (a check-in is
 * per person), so does a Completed date range (a check-in takes open tasks
 * only; in an expression folded away where the term allows,
 * `checkinFilterOf`) and completed tasks stay off, each named in `fixes`
 * (`checkinFilterDrops`); text that isn't JSON, isn't a predicate or is over
 * `CHECKIN_FILTER_SETTING_MAX_LEN` reads as no filter.
 */

/** A check-in filter read from its stored text, and what was dropped on the way (empty when nothing). */
export interface ReadCheckinFilter {
  filter: CheckinTaskFilter
  fixes: string[]
}

/**
 * The longest `checkinTaskFilter` text read (a million characters, as the
 * lenses): a filter's id lists have no cap of their own below the
 * table size, so this bounds the whole value.
 */
export const CHECKIN_FILTER_SETTING_MAX_LEN = 1_000_000

const LABEL = 'check-in filter'

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

/** The stored text, read (see the module comment). */
export function readCheckinFilterSetting(value: string): ReadCheckinFilter {
  if (value.length > CHECKIN_FILTER_SETTING_MAX_LEN) return { filter: emptyPredicate(), fixes: [`${LABEL} too long — reset`] }
  const parsed = parseJson(value)
  if (parsed === undefined || checkPredicateShape(parsed) !== true) return { filter: emptyPredicate(), fixes: [`${LABEL} reset`] }
  const { predicate, fixes } = pickPredicate(parsed)
  return { filter: checkinFilterOf(predicate), fixes: [...fixes, ...checkinFilterDrops(predicate)] }
}

/** The stored text of `filter`: its known parts, without people or a Completed range, completed tasks off. */
export function formatCheckinFilterSetting(filter: CheckinTaskFilter): string {
  return JSON.stringify(checkinFilterOf(pickPredicate(filter).predicate))
}
