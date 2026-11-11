import type { DateField, PersistedTodoItem, TodoEvent } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { expressionAtoms } from '../../utils/filter-expression'
import type { FilterCriteria } from '../../utils/filter-criteria'
import { matchesFilter, readsText, type FilterSettings } from '../../utils/filter-match'
import { textMatchContextFor, type TodoNameLookups } from '../../utils/filter'
import { FILTER_HISTORY_EVENT_TYPES } from '../../utils/trend-window'
import { eventsByTask, taskAsOf, taskFieldReplay } from './task-history'

/**
 * Any filter's history (D26 P7, the history log H3): how many tasks it
 * kept at the end of each of some days, each task replayed to that day
 * (`task-history.taskFieldReplay`: its state, due date, status, follow-ups,
 * priority flags, people and tags then) and the filter evaluated with that
 * day as today — so `overdue` on a past day means late on that day. What
 * the log doesn't hold (titles, notes, status updates, subtasks, names,
 * `modifiedAt`) is read as it is now; `historyExactness` says when the
 * counts are exact.
 */

/** What a filter's history is evaluated with. */
export interface FilterHistoryOptions {
  /** The tasks' people and tags now (where their replay starts) and the names a text filter reads. */
  lookups: TodoNameLookups
  settings: FilterSettings
}

function stagesOf(filter: FilterCriteria | readonly FilterCriteria[]): readonly FilterCriteria[] {
  return Array.isArray(filter) ? filter : [filter as FilterCriteria]
}

/**
 * How many of `tasks` pass `filter` at the end of each of `days` (local
 * midnights, oldest first; the last may be today, whose count is the count
 * now). `filter` is one filter, or several stages a task must all pass — a
 * Number's filter composed with the screen filter is
 * `composeScreenFilter(screen, number)`'s two. `events` must hold every
 * event of `FILTER_HISTORY_EVENT_TYPES` since the first day (more is fine:
 * other tasks' and other types' events are ignored). Pure.
 */
export function filterHistory(
  filter: FilterCriteria | readonly FilterCriteria[],
  tasks: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  days: readonly Date[],
  { lookups, settings }: FilterHistoryOptions,
): number[] {
  const counts = new Array<number>(days.length).fill(0)
  const origin = days[0]
  if (!origin) return counts
  const stages = stagesOf(filter)
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
      if (!fields) continue
      const row = taskAsOf(task, fields)
      const personIds = [...fields.personIds]
      const tagIds = [...fields.tagIds]
      const searchCtx = text ? textMatchContextFor(row, lookups) : undefined
      if (stages.every((f) => matchesFilter(f, row, personIds, day, searchCtx, tagIds, settings))) {
        counts[i] = (counts[i] ?? 0) + 1
      }
    }
  }
  return counts
}

/**
 * What a filter reads, as the history log knows it:
 *
 * - `state` (open / done), `due`, `status`, `completed`, `created` — exact
 *   for as long as the log has run;
 * - `followup`, `lastFollowup`, `markers`, `people`, `tags` — the history log
 *   H3's: exact from the `historyLogSince` day on;
 * - `text`, `modified` — never logged: always read as they are now.
 */
export type HistoryField =
  | 'state' | 'due' | 'status' | 'completed' | 'created'
  | 'followup' | 'lastFollowup' | 'markers' | 'people' | 'tags'
  | 'text' | 'modified'

const DATE_FIELD_READS: Record<DateField, HistoryField> = {
  deadline: 'due',
  followup: 'followup',
  lastFollowup: 'lastFollowup',
  completed: 'completed',
  created: 'created',
  modified: 'modified',
}

/** The fields exact only from the history log H3's start. */
const H3_FIELDS: ReadonlySet<HistoryField> = new Set(['followup', 'lastFollowup', 'markers', 'people', 'tags'])
/** The fields no event logs. */
const UNLOGGED_FIELDS: ReadonlySet<HistoryField> = new Set(['text', 'modified'])

/** Every field `filter` (its clauses, its expression, its lens) reads; completion (`state`) always. */
export function filterHistoryFields(filter: FilterCriteria | readonly FilterCriteria[]): Set<HistoryField> {
  const out = new Set<HistoryField>(['state'])
  const visit = (f: FilterCriteria) => {
    if (f.personIds != null) out.add('people')
    if (f.statusIds != null) out.add('status')
    if (f.tags != null) out.add('tags')
    if (f.searchText.trim() !== '') out.add('text')
    // Urgent reads the due date too (urgent by its due date): exact anyway.
    if ((f.markers?.length ?? 0) > 0) out.add('markers').add('due')
    for (const [field, clause] of Object.entries(f.dates) as [DateField, unknown][]) {
      if (clause != null) out.add(DATE_FIELD_READS[field])
    }
    if (f.expression) {
      for (const atom of expressionAtoms(f.expression)) {
        switch (atom.kind) {
          case 'person': out.add('people'); break
          case 'tag': out.add('tags'); break
          case 'status': out.add('status'); break
          case 'priority': out.add('markers').add('due'); break
          case 'text': out.add('text'); break
          case 'date': out.add(DATE_FIELD_READS[atom.field]); break
        }
      }
    }
    if (f.lens) visit(f.lens)
  }
  for (const f of stagesOf(filter)) visit(f)
  return out
}

export interface HistoryExactness {
  /** Every past day's count is what the filter kept that day. */
  exact: boolean
  /** The fields read as they are now (or as they were when the log began) on some day of the window — why it isn't exact; empty when it is. */
  approximate: HistoryField[]
}

/**
 * Whether `filter`'s history over a window starting `firstDay` is exact: it
 * reads only fields the log held for the whole window — the history log
 * H3's fields only when `historyLogSince` is on or before `firstDay` (a day's
 * count needs every change after its end, so the log may begin during the
 * first day), never text or the modified date. A sparkline that isn't is
 * marked ≈.
 */
export function historyExactness(
  filter: FilterCriteria | readonly FilterCriteria[],
  firstDay: Date,
  historyLogSince: Date | null,
): HistoryExactness {
  const sinceDay = historyLogSince ? daysUntil(historyLogSince, firstDay) : null
  const h3Exact = sinceDay != null && sinceDay <= 0
  const approximate = [...filterHistoryFields(filter)]
    .filter((f) => UNLOGGED_FIELDS.has(f) || (H3_FIELDS.has(f) && !h3Exact))
  return { exact: approximate.length === 0, approximate }
}

/** From which day a filter's history over some days is exact, and what reads as now before it. */
export interface HistoryExactFrom {
  /** The index of the first of the days from which every count is exact (`days.length`: none is). */
  from: number
  /** The fields read as they are now (or as they were when the log began) before `from`; empty when `from` is 0. */
  approximate: HistoryField[]
}

/**
 * Day by day, `historyExactness`: a day's count is exact when the filter
 * reads only what the log held from that day's end on — the history log
 * H3's fields from the `historyLogSince` day on, never text or the
 * modified date (`from` is then `days.length`). Created vs completed marks
 * the days before `from` ≈.
 */
export function historyExactFrom(
  filter: FilterCriteria | readonly FilterCriteria[],
  days: readonly Date[],
  historyLogSince: Date | null,
): HistoryExactFrom {
  const fields = [...filterHistoryFields(filter)]
  const unlogged = fields.filter((f) => UNLOGGED_FIELDS.has(f))
  const h3 = fields.filter((f) => H3_FIELDS.has(f))
  if (unlogged.length > 0) return { from: days.length, approximate: [...unlogged, ...h3] }
  if (h3.length === 0) return { from: 0, approximate: [] }
  const first = historyLogSince
    ? days.findIndex((d) => {
      const since = daysUntil(historyLogSince, d)
      return since != null && since <= 0
    })
    : -1
  const from = first < 0 ? days.length : first
  return { from, approximate: from === 0 ? [] : h3 }
}
