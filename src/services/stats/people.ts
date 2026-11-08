import type { Person, PersistedTodoItem } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { hasMarker } from '../../utils/markers'
import { MARKER_KEYS, type MarkerKey } from '../../models/filter-predicate'
import { idsByDate, openTasks, type StatsContext } from './stats-context'

/** One People row: open tasks, how many have each priority, and the follow-up-due ones. */
export interface PeopleRowStats {
  /** Open tasks, by due date then `sortOrder`. */
  ids: number[]
  /** How many open tasks have each priority (a task with two counts in both; Urgent = effective urgent). */
  priority: Record<MarkerKey, number>
  /** Open tasks whose next follow-up is today or earlier. */
  followupDueIds: number[]
}

export interface PeopleStats {
  /**
   * Everyone with at least one open task, by open count descending, ties by
   * name. A task with several people counts for each of them.
   */
  rows: Array<PeopleRowStats & { person: Person & { id: number } }>
  /** Open tasks with nobody assigned (the row that always comes last). */
  unassigned: PeopleRowStats
}

/**
 * The person (or tag) "is" picks that narrow the People (Tags) rows, one
 * list per filter — the top bar's chips and its lens
 * (`build-list.groupRestrictions`) —, as they narrow a list grouped by
 * People or Tag. Id `0` is the Unassigned (No tags) pick.
 */
export type RowRestrictions = ReadonlyArray<ReadonlyArray<number>>

/**
 * The rows a task with `ids` (its people or tags, each once) counts under,
 * as `list-sections` groups it: with no restriction, each of its own; else
 * only the picked ones — those every restriction picks when it has any,
 * else those any one picks —, so `@Alice` counts a task of Alice and Bob
 * under Alice alone. Empty: the task has only ids nothing picks.
 */
export function restrictedRows(ids: readonly number[], restrictions: RowRestrictions): number[] {
  const picks = restrictions.filter((r) => r.length > 0)
  if (picks.length === 0) return [...ids]
  const anyPicks = ids.filter((id) => picks.some((r) => r.includes(id)))
  const everyPicks = anyPicks.filter((id) => picks.every((r) => r.includes(id)))
  return everyPicks.length > 0 ? everyPicks : anyPicks
}

/** Whether a task with no person (tag) keeps its Unassigned (No tag) row under `restrictions`. */
export function keepsNoneRow(restrictions: RowRestrictions): boolean {
  return restrictions.filter((r) => r.length > 0).every((r) => r.includes(0))
}

export function computePeopleStats(tasks: readonly PersistedTodoItem[], ctx: StatsContext, restrictions: RowRestrictions = []): PeopleStats {
  const { assignedPeopleMap } = ctx
  const byPerson = new Map<number, { person: Person & { id: number }; tasks: PersistedTodoItem[] }>()
  const unassigned: PersistedTodoItem[] = []
  const keepNone = keepsNoneRow(restrictions)

  for (const t of openTasks(tasks)) {
    const people = new Map<number, Person>()
    for (const p of assignedPeopleMap.get(t.id) ?? []) if (p.id != null && !people.has(p.id)) people.set(p.id, p)
    if (people.size === 0) {
      if (keepNone) unassigned.push(t)
      continue
    }
    for (const id of restrictedRows([...people.keys()], restrictions)) {
      const p = people.get(id)
      if (!p) continue
      let entry = byPerson.get(id)
      if (!entry) {
        entry = { person: { ...p, id }, tasks: [] }
        byPerson.set(id, entry)
      }
      entry.tasks.push(t)
    }
  }

  const rows = [...byPerson.values()]
    .sort((a, b) => b.tasks.length - a.tasks.length || a.person.name.localeCompare(b.person.name) || a.person.id - b.person.id)
    .map(({ person, tasks: personTasks }) => ({ person, ...openRowStats(personTasks, ctx) }))

  return { rows, unassigned: openRowStats(unassigned, ctx) }
}

/** A row of open tasks (a person's, a tag's): all of them, the count by priority, the follow-up-due ones. */
export function openRowStats(
  rowTasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today' | 'urgentRange'>,
): PeopleRowStats {
  const { today, urgentRange } = ctx
  const priority = Object.fromEntries(MARKER_KEYS.map((k) => [
    k,
    rowTasks.filter((t) => hasMarker(t, k, today, urgentRange)).length,
  ])) as Record<MarkerKey, number>
  return {
    ids: idsByDate(rowTasks, 'deadline'),
    priority,
    followupDueIds: idsByDate(
      rowTasks.filter((t) => (daysUntil(t.nextFollowupAt, today) ?? 1) <= 0),
      'followup',
    ),
  }
}
