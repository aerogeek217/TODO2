import { emptyPredicate, type FilterClauses, type TodoPredicate } from '../models/filter-predicate'
import { withNormalizedOrGroups } from './or-groups'
import { predicatesEqual } from './list-def-equal'

/**
 * Email check-in settings: how a check-in email is handed to the mail app,
 * and which of a person's open tasks it covers. Both are remembered in the
 * `settings` table (`checkinOpenMethod`, `checkinTaskFilter`).
 */

/**
 * `mailto`: open a `mailto:` link (To + Subject) and put the body on the
 * clipboard to paste. `eml`: download an unsent `.eml` draft.
 */
export type CheckinOpenMethod = 'mailto' | 'eml'

export const CHECKIN_OPEN_METHODS: readonly CheckinOpenMethod[] = ['mailto', 'eml']

export const DEFAULT_CHECKIN_OPEN_METHOD: CheckinOpenMethod = 'mailto'

export function isCheckinOpenMethod(value: unknown): value is CheckinOpenMethod {
  return (CHECKIN_OPEN_METHODS as readonly unknown[]).includes(value)
}

/**
 * Which of a person's open tasks a check-in covers: a list predicate,
 * evaluated as a List widget evaluates its filter, over the person's open
 * tasks. It has no people filter (a check-in is per person) and never
 * shows completed tasks; `emptyPredicate()` = all their open tasks.
 */
export type CheckinTaskFilter = TodoPredicate

/** Clauses without their people filter (nor its "is not" switch). */
function withoutPeople<T extends FilterClauses>(c: T): T {
  const out: T = { ...c, personIds: null }
  if (c.negate) {
    const { personIds: _personIds, ...others } = c.negate
    void _personIds
    if (Object.keys(others).length > 0) out.negate = others
    else delete out.negate
  }
  return out
}

/**
 * The check-in filter as it is kept: no people filter (nor its "is not"
 * switch) — in an or group either, an or group left with no clause dropped —,
 * completed tasks off.
 */
export function checkinFilterOf(predicate: TodoPredicate): CheckinTaskFilter {
  const out: TodoPredicate = { ...withoutPeople(predicate), showCompleted: false }
  return out.orGroups ? withNormalizedOrGroups({ ...out, orGroups: out.orGroups.map(withoutPeople) }) : out
}

/** Whether the check-in filter narrows nothing (all open tasks). */
export function isNoCheckinFilter(filter: CheckinTaskFilter): boolean {
  return predicatesEqual(checkinFilterOf(filter), emptyPredicate())
}

/** Whether two check-in filters pick the same tasks. */
export function checkinFiltersEqual(a: CheckinTaskFilter, b: CheckinTaskFilter): boolean {
  return predicatesEqual(checkinFilterOf(a), checkinFilterOf(b))
}

/** The "How to open it" choices, as the check-in dialog and Settings show them. */
export const CHECKIN_OPEN_METHOD_OPTIONS: ReadonlyArray<{ method: CheckinOpenMethod; label: string; help: string }> = [
  { method: 'mailto', label: 'Open in mail app, then paste', help: 'To + Subject filled in; body copied. New and classic Outlook.' },
  { method: 'eml', label: 'Download draft (.eml)', help: 'Opens ready to send in classic Outlook. No paste.' },
]
