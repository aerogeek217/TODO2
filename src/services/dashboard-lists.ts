import type { PersistedTodoItem, TodoPredicate, ListSortBy } from '../models'
import type {
  ListMembership,
  ListSort,
  ListGrouping,
  PersistedListDefinition,
} from '../models/list-definition'
import { effectiveDate, isScheduledExpired, resolveScheduled } from '../utils/effective-date'
import { startOfDay, MS_PER_DAY } from '../utils/date'

export interface DashboardListsContext {
  today: Date
  /**
   * Evaluator for `{kind:'custom', predicate}` membership. The caller closes
   * over assignment maps + statuses so the interpreter can stay UI-agnostic.
   * The definition's own predicate (via this evaluator) is authoritative for
   * `showCompleted` / `showHiddenStatuses` — there is no ctx-level override.
   * Omitted when no custom definitions are in play — in that case an accidental
   * `{kind:'custom'}` definition is treated as matching no todos (with a
   * console warning once per build).
   */
  evalPredicate?: (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean
}

export interface DashboardListGroup {
  key: string
  label: string
  todos: PersistedTodoItem[]
}

export interface DashboardList {
  id: number
  key: string
  label: string
  todos: PersistedTodoItem[]
  groups?: DashboardListGroup[]
}

export function buildDashboardLists(
  definitions: PersistedListDefinition[],
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardList[] {
  const ordered = [...definitions].sort((a, b) => a.sortOrder - b.sortOrder)
  const result: DashboardList[] = []
  for (const def of ordered) {
    const members = todos.filter((t) => interpretMembership(def.membership, t, ctx))
    const sorted = [...members].sort((a, b) => interpretSort(def.sort, a, b, ctx))
    const groups = interpretGrouping(def.grouping, def.sort, sorted, ctx)
    result.push({
      id: def.id,
      key: `def-${def.id}`,
      label: def.name,
      todos: sorted,
      groups,
    })
  }
  return result
}

export function interpretMembership(
  m: ListMembership,
  t: PersistedTodoItem,
  ctx: DashboardListsContext,
): boolean {
  if (!ctx.evalPredicate) {
    warnOnceMissingEvaluator()
    return false
  }
  return ctx.evalPredicate(m.predicate, t)
}

let warnedMissingEvaluator = false
function warnOnceMissingEvaluator() {
  if (warnedMissingEvaluator) return
  warnedMissingEvaluator = true
  console.warn(
    'dashboard-lists: custom-membership list found but ctx.evalPredicate was not supplied; matching zero todos.',
  )
}

export function interpretSort(
  s: ListSort,
  a: PersistedTodoItem,
  b: PersistedTodoItem,
  ctx: DashboardListsContext,
): number {
  switch (s.kind) {
    case 'effective-date-asc':
      return compareEffectiveDateAsc(a, b, ctx)

    case 'scheduled-asc':
      return compareScheduledAsc(a, b, ctx)

    case 'deadline-asc':
      return compareDeadlineAsc(a, b)

    case 'sort-order':
      return compareSortOrder(a, b)

    case 'sortBy':
      return compareBySortBy(s.by, a, b, ctx)
  }
}

function compareEffectiveDateAsc(a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  const today = startOfDay(ctx.today)
  const aExpired = isScheduledExpired(a, today)
  const bExpired = isScheduledExpired(b, today)
  if (aExpired !== bExpired) return aExpired ? -1 : 1

  const ad = effectiveDate(a, today)
  const bd = effectiveDate(b, today)
  if (ad === null && bd === null) return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  if (ad === null) return 1
  if (bd === null) return -1
  const cmp = ad.getTime() - bd.getTime()
  if (cmp !== 0) return cmp
  return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
}

function compareDeadlineAsc(a: PersistedTodoItem, b: PersistedTodoItem): number {
  const ad = a.dueDate ? startOfDay(new Date(a.dueDate)).getTime() : null
  const bd = b.dueDate ? startOfDay(new Date(b.dueDate)).getTime() : null
  if (ad === null && bd === null) return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  if (ad === null) return 1
  if (bd === null) return -1
  const cmp = ad - bd
  if (cmp !== 0) return cmp
  return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
}

function compareSortOrder(a: PersistedTodoItem, b: PersistedTodoItem): number {
  const cmp = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  if (cmp !== 0) return cmp
  return a.id - b.id
}

function compareScheduledAsc(a: PersistedTodoItem, b: PersistedTodoItem, ctx: DashboardListsContext): number {
  const today = startOfDay(ctx.today)
  const as = a.scheduledDate ? resolveScheduled(a.scheduledDate, today) : null
  const bs = b.scheduledDate ? resolveScheduled(b.scheduledDate, today) : null
  if (as === null && bs === null) return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  if (as === null) return 1
  if (bs === null) return -1
  const cmp = as.getTime() - bs.getTime()
  if (cmp !== 0) return cmp
  return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
}

/**
 * Chronological `sortBy` values (date/scheduled/deadline) get proper
 * comparators. Categorical values (people/project/org/status) fall back to
 * sortOrder — the grouping node (`by-sortBy`) is where the categorical split
 * happens; a total order inside a single list for a categorical field is
 * ambiguous (multi-assignment).
 */
function compareBySortBy(
  by: ListSortBy,
  a: PersistedTodoItem,
  b: PersistedTodoItem,
  ctx: DashboardListsContext,
): number {
  switch (by) {
    case 'date':
      return compareEffectiveDateAsc(a, b, ctx)
    case 'scheduled':
      return compareScheduledAsc(a, b, ctx)
    case 'deadline':
      return compareDeadlineAsc(a, b)
    case 'people':
    case 'project':
    case 'org':
    case 'status':
    default:
      return compareSortOrder(a, b)
  }
}

export function interpretGrouping(
  g: ListGrouping,
  sort: ListSort,
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] | undefined {
  switch (g.kind) {
    case 'none':
      return undefined
    case 'relative-effective':
      return bucketByEffective(todos, ctx)
    case 'relative-deadline':
      return bucketByDeadline(todos, ctx)
    case 'by-sortBy': {
      if (sort.kind !== 'sortBy') return undefined
      return bucketByField(sort.by, todos, ctx)
    }
    case 'by-field':
      return bucketByField(g.by, todos, ctx)
  }
}

function bucketByField(
  by: ListSortBy,
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardListGroup[] | undefined {
  switch (by) {
    case 'date':
      return bucketByEffective(todos, ctx)
    case 'scheduled':
      return bucketByScheduled(todos, ctx)
    case 'deadline':
      return bucketByDeadline(todos, ctx)
    // Categorical buckets require assignment maps that the interpreter
    // doesn't receive yet — ListView handles them locally.
    default:
      return undefined
  }
}

function weekBoundaries(today: Date) {
  const base = startOfDay(today).getTime()
  const dow = startOfDay(today).getDay()
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow
  const thisWeekEnd = base + daysUntilSunday * MS_PER_DAY
  const nextWeekEnd = thisWeekEnd + 7 * MS_PER_DAY
  return { base, thisWeekEnd, nextWeekEnd }
}

function bucketByEffective(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const { base, thisWeekEnd, nextWeekEnd } = weekBoundaries(today)
  const tomorrowEnd = base + MS_PER_DAY
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime()
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0).getTime()

  const tomorrow: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const nextWeek: PersistedTodoItem[] = []
  const laterMonth: PersistedTodoItem[] = []
  const nextMonth: PersistedTodoItem[] = []
  const beyond: PersistedTodoItem[] = []

  for (const t of todos) {
    const eff = effectiveDate(t, today)
    if (eff === null) { beyond.push(t); continue }
    const ms = eff.getTime()
    if (ms <= tomorrowEnd) tomorrow.push(t)
    else if (ms <= thisWeekEnd) thisWeek.push(t)
    else if (ms <= nextWeekEnd) nextWeek.push(t)
    else if (ms <= thisMonthEnd) laterMonth.push(t)
    else if (ms <= nextMonthEnd) nextMonth.push(t)
    else beyond.push(t)
  }

  const groups: DashboardListGroup[] = []
  if (tomorrow.length > 0) groups.push({ key: 'tomorrow', label: 'Tomorrow', todos: tomorrow })
  if (thisWeek.length > 0) groups.push({ key: 'this-week', label: 'This week', todos: thisWeek })
  if (nextWeek.length > 0) groups.push({ key: 'next-week', label: 'Next week', todos: nextWeek })
  if (laterMonth.length > 0) groups.push({ key: 'later-month', label: 'Later this month', todos: laterMonth })
  if (nextMonth.length > 0) groups.push({ key: 'next-month', label: 'Next month', todos: nextMonth })
  if (beyond.length > 0) groups.push({ key: 'beyond', label: 'Beyond', todos: beyond })
  return groups
}

function bucketByDeadline(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const { base, thisWeekEnd, nextWeekEnd } = weekBoundaries(today)
  const tomorrowStart = base + MS_PER_DAY
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime()

  const overdue: PersistedTodoItem[] = []
  const dueToday: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const nextWeek: PersistedTodoItem[] = []
  const thisMonth: PersistedTodoItem[] = []
  const later: PersistedTodoItem[] = []

  for (const t of todos) {
    const d = t.dueDate ? startOfDay(new Date(t.dueDate)) : null
    if (d === null) continue
    const ms = d.getTime()
    if (ms < base) overdue.push(t)
    else if (ms < tomorrowStart) dueToday.push(t)
    else if (ms <= thisWeekEnd) thisWeek.push(t)
    else if (ms <= nextWeekEnd) nextWeek.push(t)
    else if (ms <= thisMonthEnd) thisMonth.push(t)
    else later.push(t)
  }

  const groups: DashboardListGroup[] = []
  if (overdue.length > 0) groups.push({ key: 'overdue', label: 'Overdue', todos: overdue })
  if (dueToday.length > 0) groups.push({ key: 'today', label: 'Today', todos: dueToday })
  if (thisWeek.length > 0) groups.push({ key: 'this-week', label: 'This week', todos: thisWeek })
  if (nextWeek.length > 0) groups.push({ key: 'next-week', label: 'Next week', todos: nextWeek })
  if (thisMonth.length > 0) groups.push({ key: 'this-month', label: 'This month', todos: thisMonth })
  if (later.length > 0) groups.push({ key: 'later', label: 'Later', todos: later })
  return groups
}

function bucketByScheduled(todos: PersistedTodoItem[], ctx: DashboardListsContext): DashboardListGroup[] {
  const today = startOfDay(ctx.today)
  const { base, thisWeekEnd, nextWeekEnd } = weekBoundaries(today)
  const tomorrowEnd = base + MS_PER_DAY
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime()
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0).getTime()

  const noDate: PersistedTodoItem[] = []
  const tomorrow: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const nextWeek: PersistedTodoItem[] = []
  const laterMonth: PersistedTodoItem[] = []
  const nextMonth: PersistedTodoItem[] = []
  const beyond: PersistedTodoItem[] = []

  for (const t of todos) {
    const resolved = t.scheduledDate ? resolveScheduled(t.scheduledDate, today) : null
    if (!resolved) { noDate.push(t); continue }
    const ms = resolved.getTime()
    if (ms <= tomorrowEnd) tomorrow.push(t)
    else if (ms <= thisWeekEnd) thisWeek.push(t)
    else if (ms <= nextWeekEnd) nextWeek.push(t)
    else if (ms <= thisMonthEnd) laterMonth.push(t)
    else if (ms <= nextMonthEnd) nextMonth.push(t)
    else beyond.push(t)
  }

  const groups: DashboardListGroup[] = []
  if (tomorrow.length > 0) groups.push({ key: 'tomorrow', label: 'Tomorrow', todos: tomorrow })
  if (thisWeek.length > 0) groups.push({ key: 'this-week', label: 'This week', todos: thisWeek })
  if (nextWeek.length > 0) groups.push({ key: 'next-week', label: 'Next week', todos: nextWeek })
  if (laterMonth.length > 0) groups.push({ key: 'later-month', label: 'Later this month', todos: laterMonth })
  if (nextMonth.length > 0) groups.push({ key: 'next-month', label: 'Next month', todos: nextMonth })
  if (beyond.length > 0) groups.push({ key: 'beyond', label: 'Beyond', todos: beyond })
  if (noDate.length > 0) groups.push({ key: 'no-date', label: 'No scheduled date', todos: noDate })
  return groups
}
