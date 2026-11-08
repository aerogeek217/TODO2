import type { Person, Tag } from '../../../models'
import type { MetricId } from '../../../models/glance-widgets'
import type { EisenhowerQuadrant } from '../../../models/workspace-layout'
import type { Change } from '../../../services/stats/changes'
import type { ClosedThisWeek } from '../../../services/stats/closed-this-week'
import type { StatsContext } from '../../../services/stats/stats-context'
import type { MetricStats } from '../../../services/stats/metrics'
import type { TaskDialogGroup } from '../../../stores/task-dialog-payload'
import { QUADRANT_COLOR, type EisenhowerPane } from '../../../utils/eisenhower-panes'
import { formatFollowupDay } from '../../../utils/followup'
import { STUCK_STATUS_DAYS } from '../../../utils/trend-window'
import { urgentRangeLabel, type UrgentDueWithinDays } from '../../../utils/urgency'
import { metricDescription, trendBucketLabel } from './glance-copy'
import type { GlanceDrill } from './glance-types'
import { NUMBER_DEFS, METRIC_DEFS } from './number-defs'

/**
 * What a glance widget's click opens in the task dialog (`GlanceDrill`):
 * every glance payload is built here (and the Neglect map's Slipping list),
 * from the ids and counts the pure statistics (`services/stats/*`) return.
 * The payloads other surfaces open too (a person's or a tag's tasks, the
 * screen filter's) stay in `services/task-dialog`.
 */

const todos = (todoIds: readonly number[]) => ({ kind: 'todos' as const, todoIds: [...todoIds] })

// ── Numbers ─────────────────────────────────────────────────────────────────

/** A metric's tasks (a Number, a section's count). */
export function metricDrill(id: MetricId, data: { metrics: { shown: MetricStats }; ctx: StatsContext }): GlanceDrill {
  const def = METRIC_DEFS[id]
  return { title: def.title, glyph: def.glyph, description: metricDescription(id, data.ctx), source: todos(data.metrics.shown[id].ids) }
}

/** Closed this week's tasks. */
export function closedThisWeekDrill(closed: ClosedThisWeek, today: Date): GlanceDrill {
  const def = NUMBER_DEFS.closedThisWeek
  return {
    title: def.title,
    glyph: def.glyph,
    description: `Tasks completed since ${formatFollowupDay(closed.weekStart, today)}.`,
    source: todos(closed.ids),
  }
}

/** One line of a Number's breakdown: its tasks among the metric's (`label` the person's or tag's, `key` `none` for the no-one / no-tag line). */
export function breakdownDrill(title: string, by: 'people' | 'tags', entry: { key: string; label: string; ids: readonly number[] }): GlanceDrill {
  const which = entry.key === 'none'
    ? (by === 'tags' ? 'with no tag' : 'with nobody assigned')
    : (by === 'tags' ? `tagged ${entry.label}` : `assigned to ${entry.label}`)
  return {
    title: `${title} · ${entry.label}`,
    glyph: by === 'tags' ? 'tag' : 'people',
    description: `${title}: the ones ${which}.`,
    source: todos(entry.ids),
  }
}

// ── Sections ────────────────────────────────────────────────────────────────

/** Needs follow-up's count: its groups (Late, Today, Next N days) under their headings. */
export function followupDrill(lookAhead: number, groups: readonly TaskDialogGroup[]): GlanceDrill {
  return {
    title: 'Needs follow-up',
    glyph: 'followup',
    description: `Open tasks whose next follow-up is late, today or in the next ${lookAhead} days.`,
    source: { kind: 'groups', groups },
  }
}

/** A Next 7 days column: its due and follow-up tasks. `date` `null` = the Late column; `index` 1 = today. */
export function nextDayDrill(date: Date | null, index: number, today: Date, ids: { due: readonly number[]; followup: readonly number[] }): GlanceDrill {
  let title: string
  let description: string
  if (date == null) {
    title = 'Late'
    description = 'Open tasks due, or to follow up, before today.'
  } else if (index === 1) {
    title = 'Today'
    description = 'Open tasks due, or to follow up, today.'
  } else {
    title = formatFollowupDay(date, today)
    description = `Open tasks due, or to follow up, on ${title}.`
  }
  return {
    title,
    glyph: 'calendar',
    description,
    source: {
      kind: 'groups',
      groups: [
        { key: 'due', label: 'Due', color: 'var(--color-overdue)', todoIds: ids.due },
        { key: 'followup', label: 'Follow-up', color: 'var(--color-followup)', todoIds: ids.followup },
      ],
    },
  }
}

/** Created vs completed's totals: the tasks completed, or created, in the range (`rangeWords`: `the last 14 days`). */
export function trendTotalDrill(which: 'completed' | 'created', rangeWords: string, ids: readonly number[]): GlanceDrill {
  return {
    title: which === 'completed' ? 'Completed' : 'Created',
    glyph: 'chart',
    description: `Tasks ${which} in ${rangeWords}.`,
    source: todos(ids),
  }
}

/** A trend bar (`Thu 8`, or `Week of Sep 28`): its completed and created tasks. */
export function trendBucketDrill(
  start: Date,
  granularity: 'day' | 'week',
  today: Date,
  ids: { completed: readonly number[]; created: readonly number[] },
): GlanceDrill {
  const day = formatFollowupDay(start, today)
  const week = trendBucketLabel(start, 'week')
  return {
    title: granularity === 'day' ? day : `Week of ${week}`,
    glyph: 'chart',
    description: granularity === 'day' ? `Tasks completed or created on ${day}.` : `Tasks completed or created in the week of ${week}.`,
    source: {
      kind: 'groups',
      groups: [
        { key: 'completed', label: 'Completed', color: 'var(--color-accent)', todoIds: ids.completed },
        { key: 'created', label: 'Created', color: 'var(--color-chart-created)', todoIds: ids.created },
      ],
    },
  }
}

/** Status's count: the open tasks under their status. */
export function statusDrill(groups: readonly TaskDialogGroup[]): GlanceDrill {
  return { title: 'Open tasks', glyph: 'status', description: 'Open tasks by status.', source: { kind: 'groups', groups } }
}

/** A Status row: its open tasks (an entry with no `id` = No status). */
export function statusRowDrill(entry: { id?: number | null; label: string }, ids: readonly number[]): GlanceDrill {
  return {
    title: entry.label,
    glyph: 'status',
    description: entry.id == null ? 'Open tasks with no status.' : `Status: ${entry.label}.`,
    source: todos(ids),
  }
}

/** A People row: the person's open tasks (`person` `null` = Unassigned); the dialog offers their check-in. */
export function personRowDrill(person: Pick<Person, 'id' | 'name'> | null, ids: readonly number[]): GlanceDrill {
  return {
    title: person ? person.name : 'Unassigned',
    glyph: 'people',
    description: person ? `Open tasks assigned to ${person.name}.` : 'Open tasks with nobody assigned.',
    source: todos(ids),
    ...(person?.id != null ? { personId: person.id } : {}),
  }
}

// Tags, Stale tasks, Recently completed, the Eisenhower summary and the
// Neglect map's Slipping list: the tasks it counted (screen-filtered), in its order.

/** A Tags row: that tag's open tasks; `null` = the No tag row. */
export function tagRowDrill(tag: Pick<Tag, 'id' | 'name'> | null, todoIds: readonly number[]): GlanceDrill {
  return {
    title: tag ? `#${tag.name}` : 'No tag',
    glyph: 'tag',
    description: tag ? `Open tasks tagged #${tag.name}.` : 'Open tasks with no tag.',
    source: { kind: 'todos', todoIds },
  }
}

/** The Tags count: every row under its own heading. */
export function tagsDrill(rows: ReadonlyArray<{ tag: Tag | null; todoIds: readonly number[] }>): GlanceDrill {
  return {
    title: 'Tagged tasks',
    glyph: 'tag',
    description: 'Open tasks by tag. A task with several tags shows under each.',
    source: {
      kind: 'groups',
      groups: rows.map(({ tag, todoIds }) => (tag
        ? { key: `tag-${tag.id}`, label: `#${tag.name}`, ...(tag.color ? { color: tag.color } : {}), todoIds }
        : { key: 'untagged', label: 'No tag', todoIds })),
    },
  }
}

/** A Neglect map's Slipping tasks (latest first), untouched for `days` or more. */
export function slippingDrill(todoIds: readonly number[], days: number): GlanceDrill {
  return {
    title: 'Slipping',
    glyph: 'stale',
    description: `Open tasks due soon or late and not changed in ${days} days or more, latest first.`,
    source: { kind: 'todos', todoIds },
  }
}

export function staleDrill(todoIds: readonly number[], days: number): GlanceDrill {
  return {
    title: 'Stale tasks',
    glyph: 'stale',
    description: `Open tasks not changed in ${days} days or more, oldest first.`,
    source: { kind: 'todos', todoIds },
  }
}

export function recentDrill(todoIds: readonly number[], days: number): GlanceDrill {
  return {
    title: 'Recently completed',
    glyph: 'done',
    description: `Tasks completed in the last ${days} days, newest first.`,
    source: { kind: 'todos', todoIds },
  }
}

const QUADRANT_WORDS: Record<EisenhowerQuadrant, string> = {
  do: 'urgent and important',
  schedule: 'important, not urgent',
  delegate: 'urgent, not important',
  drop: 'neither urgent nor important',
}

/** What the app-wide urgent range adds to Urgent, as a sentence (empty when it's off). */
function urgentIncludes(range: UrgentDueWithinDays): string {
  if (range == null) return ''
  if (range === 0) return ' Urgent includes tasks due today or earlier.'
  return ` Urgent includes tasks due within ${urgentRangeLabel(range)}.`
}

/** What the Eisenhower counts are taken from, for a dialog's description. */
export interface EisenhowerDrillSource {
  /** The app-wide urgent range (what Urgent includes). */
  urgentRange: UrgentDueWithinDays
  /** The Eisenhower's list's name while its filter narrows the tasks; `null` = every task. */
  listName: string | null
}

/** ` of “Team”` for a list source, else nothing. */
function ofList(listName: string | null): string {
  return listName == null ? '' : ` of “${listName}”`
}

/**
 * An Eisenhower summary pane: its open tasks. A default pane is described
 * by its quadrant (`Open tasks that are urgent and important.`), a custom
 * one by its filter in words (`subtitle`).
 */
export function eisenhowerPaneDrill(
  pane: EisenhowerPane,
  subtitle: string,
  todoIds: readonly number[],
  { urgentRange, listName }: EisenhowerDrillSource,
): GlanceDrill {
  const description = pane.customFilter
    ? `Open tasks${ofList(listName)} in “${pane.name}” (${subtitle}) — the first pane each matches.`
    : `Open tasks${ofList(listName)} that are ${QUADRANT_WORDS[pane.id]}.${urgentIncludes(urgentRange)}`
  return {
    title: pane.name,
    glyph: 'matrix',
    description,
    source: { kind: 'todos', todoIds },
  }
}

/** The Eisenhower summary's count: every pane under its heading. */
export function eisenhowerDrill(
  panes: readonly EisenhowerPane[],
  ids: Readonly<Record<EisenhowerQuadrant, readonly number[]>>,
  { urgentRange, listName }: EisenhowerDrillSource,
): GlanceDrill {
  const custom = panes.some((p) => p.customFilter)
  return {
    title: 'Eisenhower',
    glyph: 'matrix',
    description: custom
      ? `Open tasks${ofList(listName)} by pane, each in the first pane it matches.${urgentIncludes(urgentRange)}`
      : `Open tasks${ofList(listName)} by urgent × important.${urgentIncludes(urgentRange)}`,
    source: {
      kind: 'groups',
      groups: panes.map((p) => ({ key: p.id, label: p.name, color: QUADRANT_COLOR[p.id], todoIds: ids[p.id] })),
    },
  }
}

// ── What changed ────────────────────────────────────────────────────────────

/** A What changed sentence's tasks; `null` when it has none to open. */
export function changeDrill(change: Change): GlanceDrill | null {
  if (change.ids.length === 0) return null
  const source = todos(change.ids)
  switch (change.id) {
    case 'late':
      return {
        title: 'Went late since yesterday',
        glyph: 'overdue',
        description: 'Open tasks that are late now and weren’t at the end of yesterday (tasks added since aren’t counted).',
        source,
      }
    case 'followups':
      return { title: 'Follow-ups due', glyph: 'followup', description: 'Open tasks whose next follow-up is today or earlier.', source }
    case 'tag':
      return { title: `Late in #${change.subject}`, glyph: 'tag', description: `Open tasks tagged #${change.subject} that are late.`, source }
    case 'status':
      return {
        title: `Stuck in ${change.subject}`,
        glyph: 'status',
        description: `Open tasks whose status has been ${change.subject} for ${STUCK_STATUS_DAYS} days or more.`,
        source,
      }
    case 'dueToday':
      return { title: 'Due today', glyph: 'calendar', description: 'Open tasks due today.', source }
    case 'closed': {
      const weeks = change.averageWeeks
      return {
        title: 'Closed this week',
        glyph: 'done',
        description: weeks == null
          ? 'Tasks completed this week, newest first.'
          : `Tasks completed this week, newest first. The usual is the average of the last ${weeks === 1 ? 'week' : `${weeks} weeks`}.`,
        source,
      }
    }
  }
}
