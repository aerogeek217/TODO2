import type { PersistedTodoItem } from '../models'
import type {
  ListMembership,
  ListSort,
  ListGrouping,
  PersistedListDefinition,
} from '../models/list-definition'
import { effectiveDate, isScheduledExpired } from '../utils/effective-date'
import { startOfDay, MS_PER_DAY } from '../utils/date'

/** Hardcoded today-bucket deadline warning window (README Q10). */
export const WARNING_WINDOW_DAYS = 3

export interface DashboardListsContext {
  today: Date
  hiddenStatusIds: Set<number>
  showHiddenStatuses: boolean
  showCompleted: boolean
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
    const groups = interpretGrouping(def.grouping, sorted, ctx)
    result.push({
      id: def.id,
      key: def.seededKey ?? `def-${def.id}`,
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
  if (t.isCompleted && !ctx.showCompleted) return false
  if (!ctx.showHiddenStatuses && t.statusId != null && ctx.hiddenStatusIds.has(t.statusId)) return false

  const today = startOfDay(ctx.today)

  switch (m.kind) {
    case 'today': {
      const eff = effectiveDate(t, today)
      if (eff !== null && eff.getTime() <= today.getTime()) return true
      if (t.dueDate !== undefined) {
        const due = startOfDay(new Date(t.dueDate)).getTime()
        const horizon = today.getTime() + WARNING_WINDOW_DAYS * MS_PER_DAY
        if (due <= horizon) return true
      }
      return false
    }

    case 'upcoming': {
      const hasSched = t.scheduledDate !== undefined
      const hasDue = t.dueDate !== undefined
      if (!hasSched && !hasDue) return false
      if (interpretMembership({ kind: 'today' }, t, ctx)) return false
      return true
    }

    case 'deadlines':
      return t.dueDate !== undefined

    case 'someday':
      return t.scheduledDate === undefined && t.dueDate === undefined
  }
}

export function interpretSort(
  s: ListSort,
  a: PersistedTodoItem,
  b: PersistedTodoItem,
  ctx: DashboardListsContext,
): number {
  switch (s.kind) {
    case 'effective-date-asc': {
      const today = startOfDay(ctx.today)
      const aExpired = isScheduledExpired(a, today)
      const bExpired = isScheduledExpired(b, today)
      if (aExpired !== bExpired) return aExpired ? -1 : 1

      const ad = effectiveDate(a, today)
      const bd = effectiveDate(b, today)
      if (ad === null && bd === null) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      if (ad === null) return 1
      if (bd === null) return -1
      const cmp = ad.getTime() - bd.getTime()
      if (cmp !== 0) return cmp
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    }

    case 'deadline-asc': {
      const ad = a.dueDate ? startOfDay(new Date(a.dueDate)).getTime() : null
      const bd = b.dueDate ? startOfDay(new Date(b.dueDate)).getTime() : null
      if (ad === null && bd === null) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      if (ad === null) return 1
      if (bd === null) return -1
      const cmp = ad - bd
      if (cmp !== 0) return cmp
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    }

    case 'sort-order': {
      const cmp = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      if (cmp !== 0) return cmp
      return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    }
  }
}

export function interpretGrouping(
  g: ListGrouping,
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
    if (!t.dueDate) continue
    const ms = startOfDay(new Date(t.dueDate)).getTime()
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
