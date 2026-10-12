import type { Person, PersistedTodoItem } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { isHot } from '../../utils/hot'
import { idsByDate, openTasks, type StatsContext } from './stats-context'

/** One People row: open tasks, and the hot / follow-up-due ones among them. */
export interface PeopleRowStats {
  /** Open tasks, by due date then `sortOrder`. */
  ids: number[]
  /** Hot open tasks (Settings' Hot rule). */
  hotIds: number[]
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
  const { today, urgentRange, hotRule, assignedPeopleMap } = ctx
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

  const row = (rowTasks: readonly PersistedTodoItem[]): PeopleRowStats => ({
    ids: idsByDate(rowTasks, 'deadline'),
    hotIds: idsByDate(rowTasks.filter((t) => isHot(t, hotRule, today, urgentRange)), 'deadline'),
    followupDueIds: idsByDate(
      rowTasks.filter((t) => (daysUntil(t.nextFollowupAt, today) ?? 1) <= 0),
      'followup',
    ),
  })

  const rows = [...byPerson.values()]
    .sort((a, b) => b.tasks.length - a.tasks.length || a.person.name.localeCompare(b.person.name) || a.person.id - b.person.id)
    .map(({ person, tasks: personTasks }) => ({ person, ...row(personTasks) }))

  return { rows, unassigned: row(unassigned) }
}
