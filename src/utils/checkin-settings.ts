import { emptyPredicate, type TodoPredicate } from '../models/filter-predicate'
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

/** The check-in filter as it is kept: no people filter (nor its "is not" switch), completed tasks off. */
export function checkinFilterOf(predicate: TodoPredicate): CheckinTaskFilter {
  const { negate, ...rest } = predicate
  const out: TodoPredicate = { ...rest, showCompleted: false, personIds: null }
  if (negate) {
    const { personIds: _personIds, ...others } = negate
    void _personIds
    if (Object.keys(others).length > 0) out.negate = others
  }
  return out
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
