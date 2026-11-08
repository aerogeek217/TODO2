import type { Person } from '../../../models'
import type { MetricId } from '../../../models/glance-widgets'
import type { Change } from '../../../services/stats/changes'
import type { ClosedThisWeek } from '../../../services/stats/closed-this-week'
import type { StatsContext } from '../../../services/stats/stats-context'
import type { MetricStats } from '../../../services/stats/metrics'
import type { TaskDialogGroup } from '../../../stores/task-dialog-payload'
import { formatFollowupDay } from '../../../utils/followup'
import { STUCK_STATUS_DAYS } from '../../../utils/trend-window'
import { metricDescription, trendBucketLabel } from './glance-copy'
import type { GlanceDrill } from './glance-types'
import { NUMBER_DEFS, METRIC_DEFS } from './number-defs'

/**
 * What a glance widget's click opens in the task dialog (`GlanceDrill`):
 * every glance payload is built here, from the ids and counts the pure
 * statistics (`services/stats/*`) return. The section payloads the task
 * dialog's other callers share stay in `services/task-dialog` and are
 * re-exported, so a widget asks this one module.
 */

export {
  eisenhowerQuadrantDialog,
  eisenhowerSummaryDialog,
  recentlyCompletedDialog,
  slippingTasksDialog,
  staleTasksDialog,
  tagSectionDialog,
  tagsSectionDialog,
} from '../../../services/task-dialog'

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
