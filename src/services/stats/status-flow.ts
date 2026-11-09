import type { PersistedTodoItem, Status, TodoEvent } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { textMatchContextFor, type TodoNameLookups } from '../../utils/filter'
import type { FilterCriteria } from '../../utils/filter-criteria'
import { matchesFilter, readsText, type FilterSettings } from '../../utils/filter-match'
import { FILTER_HISTORY_EVENT_TYPES } from '../../utils/trend-window'
import { idsByDate } from './stats-context'
import { eventsByTask, taskAsOf, taskFieldReplay } from './task-history'

/**
 * A Status flow (D26 P8, board Z1), pure: at the end of each of some days
 * (each week's end), the open tasks a filter keeps then, by their status
 * then — every task replayed to that day (`task-history.taskFieldReplay`:
 * its state, its status and every field the filter reads) and the filter
 * evaluated with that day as today, as a Number's history is
 * (`filter-history`). The status log is exact for as long as it has run;
 * a filter reading the history log H3's fields is exact from its start
 * (`historyExactness`).
 */

/** One status's band: its id (`null` = no status, or one deleted since), name and colour. */
export interface StatusFlowBand {
  id: number | null
  label: string
  color: string
}

export interface StatusFlowWeek {
  /** The day it was counted at the end of. */
  end: Date
  /** Its open tasks by band id (`none` for no status), by due date. */
  byBand: ReadonlyMap<number | 'none', number[]>
  total: number
}

export interface StatusFlowStats {
  weeks: StatusFlowWeek[]
  /** The bands with a task in some week: the statuses in Settings order, No status last. */
  bands: StatusFlowBand[]
  /** The largest week's total. */
  max: number
}

export interface StatusFlowOptions {
  lookups: TodoNameLookups
  settings: FilterSettings
  statuses: readonly Status[]
}

export const NO_STATUS_BAND: StatusFlowBand = { id: null, label: 'No status', color: 'var(--color-text-muted)' }

/**
 * The open tasks `stages` keep at the end of each of `days` (local
 * midnights, oldest first; the last may be today) by status. `events` must
 * hold every event of `FILTER_HISTORY_EVENT_TYPES` since the first day.
 */
export function computeStatusFlow(
  stages: readonly FilterCriteria[],
  tasks: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  days: readonly Date[],
  { lookups, settings, statuses }: StatusFlowOptions,
): StatusFlowStats {
  const origin = days[0]
  const buckets = days.map(() => new Map<number | 'none', PersistedTodoItem[]>())
  if (origin) {
    const known = new Set(statuses.flatMap((s) => (s.id != null ? [s.id] : [])))
    const text = stages.some(readsText)
    const offsets = days.map((d) => daysUntil(d, origin) ?? 0)
    const byTask = eventsByTask(events, new Set(tasks.map((t) => t.id)), FILTER_HISTORY_EVENT_TYPES, origin)
    for (const task of tasks) {
      const assignments = {
        personIds: (lookups.assignedPeopleMap.get(task.id) ?? []).flatMap((p) => (p.id != null ? [p.id] : [])),
        tagIds: (lookups.assignedTagsMap.get(task.id) ?? []).flatMap((t) => (t.id != null ? [t.id] : [])),
      }
      const at = taskFieldReplay(task, byTask.get(task.id), assignments, origin)
      for (const [i, day] of days.entries()) {
        const fields = at(offsets[i] ?? 0)
        if (!fields || fields.state !== 'open') continue
        const row = taskAsOf(task, fields)
        const searchCtx = text ? textMatchContextFor(row, lookups) : undefined
        if (!stages.every((f) => matchesFilter(f, row, [...fields.personIds], day, searchCtx, [...fields.tagIds], settings))) continue
        const band = fields.statusId != null && known.has(fields.statusId) ? fields.statusId : 'none'
        const bucket = buckets[i]
        if (!bucket) continue
        const list = bucket.get(band) ?? []
        list.push(row)
        bucket.set(band, list)
      }
    }
  }
  const weeks = days.map((end, i): StatusFlowWeek => {
    const byBand = new Map<number | 'none', number[]>()
    let total = 0
    for (const [band, list] of buckets[i] ?? []) {
      byBand.set(band, idsByDate(list, 'deadline'))
      total += list.length
    }
    return { end, byBand, total }
  })
  const used = new Set(weeks.flatMap((w) => [...w.byBand.keys()]))
  const bands: StatusFlowBand[] = statuses
    .flatMap((s) => (s.id != null && used.has(s.id) ? [{ id: s.id, label: s.name, color: s.color }] : []))
  if (used.has('none')) bands.push(NO_STATUS_BAND)
  return { weeks, bands, max: Math.max(0, ...weeks.map((w) => w.total)) }
}
