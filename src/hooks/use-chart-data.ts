import type { PersistedTodoItem, TodoPredicate } from '../models'
import { DEFAULT_BREAKDOWN_OLDEST_BY, type BreakdownConfig } from '../models/chart-widgets'
import type { ListTabBadges, TabBadgeRanges } from '../models/list-definition'
import { groupRestrictions } from '../services/build-list'
import { computeBreakdown, type BreakdownStats } from '../services/stats/breakdown'
import type { RowRestrictions } from '../services/stats/row-restrictions'
import type { StatsContext } from '../services/stats/stats-context'
import { useSettingsStore } from '../stores/settings-store'
import type { FilterCriteria } from '../utils/filter-criteria'
import { sharedMemo, sharedMemoByKey } from '../utils/shared-memo'
import { tabBadgeRangesFor } from '../utils/tab-badges'
import { useNumberCount, type NumberCount, type StatsBase } from './use-glance-data'

/**
 * The chart widgets' data (D26 P8), over the glance widgets' shared base
 * (`use-glance-data`): each chart's filter counts as a Number's does
 * (`useNumberCount`: its filter over the tasks the top bar shows), and its
 * statistic — a pure `services/stats/*` function — is memoized per chart
 * (`sharedMemoByKey`, keyed by its config), so any number of charts on
 * screen never evict one another.
 */

/** The tasks of `ids`, in that order (a Number's ids are in dialog order). */
const tasksOfMemo = sharedMemoByKey(function tasksOf(ids: readonly number[], byId: ReadonlyMap<number, PersistedTodoItem>) {
  return ids.flatMap((id) => {
    const t = byId.get(id)
    return t ? [t] : []
  })
})

/** The tasks a chart's filter keeps among the ones the top bar shows, and its count (as a Number's). */
export interface ChartTasks {
  count: NumberCount
  tasks: PersistedTodoItem[]
}

/** A chart's tasks: its filter over the screen-filtered tasks (`useNumberCount`). */
export function useChartTasks(base: StatsBase, filter: TodoPredicate): ChartTasks {
  const count = useNumberCount(base, { filter })
  const tasks = tasksOfMemo(count.ids.shown, base.todoById)
  return { count, tasks }
}

// ── Breakdown ───────────────────────────────────────────────────────────────

const OFF: TabBadgeRanges = { due: 'off', followup: 'off' }

/** The Due / Follow-up ranges: the Breakdown's own (`off` = both off), else Settings'. */
const rangesMemo = sharedMemo(function badgeRanges(own: ListTabBadges | undefined, app: TabBadgeRanges): TabBadgeRanges {
  return own === 'off' ? OFF : tabBadgeRangesFor(own, app)
}, 4)

/**
 * The `@` (people) or `#` (tags) picks narrowing a Breakdown's rows: its
 * own filter's and the top bar's (chips and lens), as a list grouped so
 * (`build-list.groupRestrictions`).
 */
const restrictionsMemo = sharedMemoByKey(function restrictions(
  filter: TodoPredicate,
  field: 'personIds' | 'tags' | null,
  screen: FilterCriteria,
): RowRestrictions {
  return field ? groupRestrictions(field, filter, screen) : []
})

const breakdownMemo = sharedMemoByKey(function breakdown(
  config: BreakdownConfig,
  tasks: readonly PersistedTodoItem[],
  ctx: StatsContext,
  ranges: TabBadgeRanges,
  restrictions: RowRestrictions,
): BreakdownStats {
  return computeBreakdown(tasks, ctx, {
    splitBy: config.splitBy,
    show: config.show,
    oldestBy: config.oldestBy ?? DEFAULT_BREAKDOWN_OLDEST_BY,
    ranges,
    restrictions,
  })
})

/** What a Breakdown shows. */
export interface BreakdownData extends ChartTasks {
  stats: BreakdownStats
  /** The ranges its Due and Follow-up columns count in. */
  ranges: TabBadgeRanges
}

/** A Breakdown's rows (`services/stats/breakdown`) over its filter's tasks. */
export function useBreakdownData(base: StatsBase, config: BreakdownConfig): BreakdownData {
  const appRanges = useSettingsStore((s) => s.tabBadges)
  const chart = useChartTasks(base, config.filter)
  const ranges = rangesMemo(config.badges, appRanges)
  const field = config.splitBy === 'people' ? 'personIds' : config.splitBy === 'tags' ? 'tags' : null
  const restrictions = restrictionsMemo(config.filter, field, chart.count.screen)
  const stats = breakdownMemo(config, chart.tasks, base.ctx, ranges, restrictions)
  return { ...chart, stats, ranges }
}
