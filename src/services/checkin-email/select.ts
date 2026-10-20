/**
 * Which of a person's tasks a check-in email covers, split into the email's
 * two sections and ordered as the email lists them.
 */
import type { Person, PersistedTodoItem, Status, Tag } from '../../models'
import { createPredicateEvaluator } from '../../utils/filter-match'
import { checkinFilterOf, isNoCheckinFilter, type CheckinTaskFilter } from '../../utils/checkin-settings'
import { startOfDay } from '../../utils/date'
import { isDeadlinePast, type WeekStart } from '../../utils/effective-date'
import type { MarkerSettings } from '../../utils/markers'
import { bySortOrder } from '../../utils/sort-order'

export interface CheckinSelectContext {
  /** Every loaded task (completed ones are skipped here). */
  todos: readonly PersistedTodoItem[]
  /** Today, any time of day (only the day is used). */
  today: Date
  /** People per task id — who a task is assigned to. */
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>
  /** Tags per task id (the filter's tag clauses read it). */
  assignedTagsMap?: ReadonlyMap<number, readonly Tag[]>
  /** Statuses (the filter's status clauses and text search read them). */
  statuses?: readonly Status[]
  /** Urgent range + Hot rule (the filter's Priority clause). */
  markerSettings: MarkerSettings
  weekStartsOn: WeekStart
}

/** The email's sections, each in email order. */
export interface CheckinSections {
  /** Due date before today. */
  overdue: PersistedTodoItem[]
  /** Everything else in scope. */
  comingUp: PersistedTodoItem[]
}

/** Overdue in a check-in: the due date is before today (a late follow-up doesn't count). */
export const isCheckinOverdue = isDeadlinePast

function dayOf(d: Date | undefined): number | null {
  return d ? startOfDay(new Date(d)).getTime() : null
}

/** The earlier of a task's due day and next follow-up day; `null` when it has neither. */
function earliestDay(t: PersistedTodoItem): number | null {
  const due = dayOf(t.dueDate)
  const next = dayOf(t.nextFollowupAt)
  if (due == null) return next
  if (next == null) return due
  return Math.min(due, next)
}

/** Email order within a section: earliest of due / next follow-up first, undated last, then `sortOrder`. */
export function compareCheckinTasks(a: PersistedTodoItem, b: PersistedTodoItem): number {
  const ad = earliestDay(a)
  const bd = earliestDay(b)
  if (ad !== bd) {
    if (ad == null) return 1
    if (bd == null) return -1
    return ad - bd
  }
  return bySortOrder(a, b)
}

/**
 * The check-in filter as a test over a task assigned to the person, through
 * the same evaluator a List widget uses (without people: the check-in is
 * the person's). Its sort and grouping don't apply — the email has its own
 * order.
 */
function filterTest(filter: CheckinTaskFilter, ctx: CheckinSelectContext): (t: PersistedTodoItem) => boolean {
  if (isNoCheckinFilter(filter)) return () => true
  const predicate = checkinFilterOf(filter)
  const evalPredicate = createPredicateEvaluator(
    {
      assignedPeopleMap: ctx.assignedPeopleMap,
      assignedTagsMap: ctx.assignedTagsMap,
      statusesById: new Map((ctx.statuses ?? []).flatMap((s) => (s.id != null ? [[s.id, s] as const] : []))),
    },
    startOfDay(ctx.today),
    { ...ctx.markerSettings, weekStartsOn: ctx.weekStartsOn },
  )
  return (t) => evalPredicate(predicate, t)
}

/**
 * The open tasks assigned to `person` that `filter` picks, as the email's
 * sections: Overdue (due date before today) and Coming up (the rest), each
 * ordered by `compareCheckinTasks`.
 */
export function selectCheckinTasks(
  person: Person & { id: number },
  filter: CheckinTaskFilter,
  ctx: CheckinSelectContext,
): CheckinSections {
  const inScope = filterTest(filter, ctx)
  const overdue: PersistedTodoItem[] = []
  const comingUp: PersistedTodoItem[] = []
  for (const t of ctx.todos) {
    if (t.isCompleted) continue
    if (!(ctx.assignedPeopleMap.get(t.id) ?? []).some((p) => p.id === person.id)) continue
    if (!inScope(t)) continue
    if (isCheckinOverdue(t, ctx.today)) overdue.push(t)
    else comingUp.push(t)
  }
  overdue.sort(compareCheckinTasks)
  comingUp.sort(compareCheckinTasks)
  return { overdue, comingUp }
}

/** How many tasks the sections hold. */
export function checkinTaskCount(sections: CheckinSections): number {
  return sections.overdue.length + sections.comingUp.length
}
