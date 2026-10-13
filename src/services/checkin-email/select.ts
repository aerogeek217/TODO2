/**
 * Which of a person's tasks a check-in email covers, split into the email's
 * two sections and ordered as the email lists them.
 */
import type { Person, PersistedTodoItem, Status, Tag } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { createPredicateEvaluator } from '../../stores/filter-store'
import { resolveCheckinTaskScope, type CheckinTaskScope } from '../../utils/checkin-settings'
import { addDays, startOfDay } from '../../utils/date'
import { isDeadlinePast, type WeekStart } from '../../utils/effective-date'
import { isHot } from '../../utils/hot'
import type { MarkerSettings } from '../../utils/markers'
import { bySortOrder } from '../../utils/sort-order'
import { applyRuntimeFilter, interpretMembership } from '../dashboard-lists'

/** How far ahead "Overdue + next 2 weeks" looks, in days from today. */
export const CHECKIN_DUE_SOON_DAYS = 14

export interface CheckinSelectContext {
  /** Every loaded task (completed ones are skipped here). */
  todos: readonly PersistedTodoItem[]
  /** Today, any time of day (only the day is used). */
  today: Date
  /** People per task id — who a task is assigned to. */
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>
  /** Tags per task id (a saved list's tag clauses read it). */
  assignedTagsMap?: ReadonlyMap<number, readonly Tag[]>
  /** Statuses (a saved list's status clauses and search read them). */
  statuses?: readonly Status[]
  /** The saved lists; a list scope whose list is missing falls back to all open tasks. */
  listDefinitions: readonly PersistedListDefinition[]
  /** Urgent range + Hot rule (the Hot scope and a list's Markers clauses). */
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
 * "Overdue + next 2 weeks": overdue, or due / following up on or before
 * today + 14 days. A follow-up that is already late counts (it is due for a
 * follow-up now); a late follow-up never makes a task overdue, though.
 */
function isDueSoon(t: PersistedTodoItem, today: Date): boolean {
  const horizon = addDays(today, CHECKIN_DUE_SOON_DAYS).getTime()
  const due = dayOf(t.dueDate)
  const next = dayOf(t.nextFollowupAt)
  return (due != null && due <= horizon) || (next != null && next <= horizon)
}

/**
 * The scope as a test over a task assigned to the person. A saved list runs
 * its own filter through the same evaluator a List widget uses; a list that
 * prompts for a person gets this person, other prompts narrow nothing. The
 * list's sort and grouping are ignored — the email has its own order.
 */
function scopeTest(
  person: Person & { id: number },
  scope: CheckinTaskScope,
  ctx: CheckinSelectContext,
): (t: PersistedTodoItem) => boolean {
  const today = startOfDay(ctx.today)
  const resolved = resolveCheckinTaskScope(scope, ctx.listDefinitions.map((d) => d.id))
  switch (resolved.kind) {
    case 'all': return () => true
    case 'due-soon': return (t) => isDueSoon(t, today)
    case 'hot': {
      const { hotRule, urgentRange } = ctx.markerSettings
      return (t) => isHot(t, hotRule, today, urgentRange)
    }
    case 'list': {
      const def = ctx.listDefinitions.find((d) => d.id === resolved.listDefinitionId)
      if (!def) return () => true
      const membership = def.runtimeFilter
        ? {
            kind: 'custom' as const,
            predicate: applyRuntimeFilter(
              def.membership.predicate,
              def.runtimeFilter,
              def.runtimeFilter.field === 'person' ? [person.id] : [],
            ),
          }
        : def.membership
      const evalPredicate = createPredicateEvaluator(
        {
          assignedPeopleMap: ctx.assignedPeopleMap,
          assignedTagsMap: ctx.assignedTagsMap,
          statusesById: new Map((ctx.statuses ?? []).flatMap((s) => (s.id != null ? [[s.id, s] as const] : []))),
        },
        today,
        ctx.markerSettings,
      )
      const listCtx = { today, weekStartsOn: ctx.weekStartsOn, evalPredicate }
      return (t) => interpretMembership(membership, t, listCtx)
    }
  }
}

/**
 * The open tasks assigned to `person` that `scope` covers, as the email's
 * sections: Overdue (due date before today) and Coming up (the rest), each
 * ordered by `compareCheckinTasks`.
 */
export function selectCheckinTasks(
  person: Person & { id: number },
  scope: CheckinTaskScope,
  ctx: CheckinSelectContext,
): CheckinSections {
  const inScope = scopeTest(person, scope, ctx)
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
