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

/** How far ahead the "Overdue + next 2 weeks" filter looks, in days from today. */
export const CHECKIN_DUE_SOON_DAYS = 14

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

/** Due date overdue or within the next two weeks (a range open at the start, ending today + 14 days). */
export function dueSoonCheckinFilter(): CheckinTaskFilter {
  return {
    ...emptyPredicate(),
    dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: CHECKIN_DUE_SOON_DAYS } } },
  }
}

/** The quick picks of "Which tasks", in menu order. */
export const CHECKIN_QUICK_FILTERS: ReadonlyArray<{ filter: CheckinTaskFilter; label: string; hint: string }> = [
  { filter: emptyPredicate(), label: 'All open tasks', hint: 'Everything assigned to them that isn’t complete' },
  { filter: dueSoonCheckinFilter(), label: 'Overdue + next 2 weeks', hint: 'Due before today or in the next 14 days' },
  { filter: { ...emptyPredicate(), markers: 'hot' }, label: 'Hot', hint: 'Your Hot rule from Settings' },
]

/** The name of a filter that is no quick pick. */
export const CUSTOM_CHECKIN_FILTER_LABEL = 'Custom filter'

/** A filter's name as "Which tasks" shows it: a quick pick's label, else `Custom filter`. */
export function checkinFilterLabel(filter: CheckinTaskFilter): string {
  return CHECKIN_QUICK_FILTERS.find((q) => checkinFiltersEqual(q.filter, filter))?.label ?? CUSTOM_CHECKIN_FILTER_LABEL
}

/** The "How to open it" choices, as the check-in dialog and Settings show them. */
export const CHECKIN_OPEN_METHOD_OPTIONS: ReadonlyArray<{ method: CheckinOpenMethod; label: string; help: string }> = [
  { method: 'mailto', label: 'Open in mail app, then paste', help: 'To + Subject filled in; body copied. New and classic Outlook.' },
  { method: 'eml', label: 'Download draft (.eml)', help: 'Opens ready to send in classic Outlook. No paste.' },
]
