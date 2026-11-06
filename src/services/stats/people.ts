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

export function computePeopleStats(tasks: readonly PersistedTodoItem[], ctx: StatsContext): PeopleStats {
  const { assignedPeopleMap } = ctx
  const byPerson = new Map<number, { person: Person & { id: number }; tasks: PersistedTodoItem[] }>()
  const unassigned: PersistedTodoItem[] = []

  for (const t of openTasks(tasks)) {
    const people = assignedPeopleMap.get(t.id) ?? []
    const seen = new Set<number>()
    for (const p of people) {
      if (p.id == null || seen.has(p.id)) continue
      seen.add(p.id)
      let entry = byPerson.get(p.id)
      if (!entry) {
        entry = { person: { ...p, id: p.id }, tasks: [] }
        byPerson.set(p.id, entry)
      }
      entry.tasks.push(t)
    }
    if (seen.size === 0) unassigned.push(t)
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
