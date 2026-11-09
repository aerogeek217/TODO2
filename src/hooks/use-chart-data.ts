import type { PersistedTodoItem, TodoEvent, TodoPredicate } from '../models'
import { DEFAULT_BREAKDOWN_OLDEST_BY, STATUS_FLOW_WEEK_CHOICES, type BreakdownConfig, type PivotConfig, type StatusFlowConfig, type TagMapConfig } from '../models/chart-widgets'
import type { ListTabBadges, TabBadgeRanges } from '../models/list-definition'
import { groupRestrictions } from '../services/build-list'
import { computeBreakdown, type BreakdownStats } from '../services/stats/breakdown'
import { historyExactness, type HistoryExactness } from '../services/stats/filter-history'
import { numberStages } from '../services/stats/number-count'
import { computePivot, type PivotStats } from '../services/stats/pivot'
import { computeStatusFlow, type StatusFlowStats } from '../services/stats/status-flow'
import { computeTagMap, type TagMapTile } from '../services/stats/tag-map'
import type { RowRestrictions } from '../services/stats/row-restrictions'
import type { StatsContext } from '../services/stats/stats-context'
import { useSettingsStore } from '../stores/settings-store'
import type { FilterCriteria } from '../utils/filter-criteria'
import type { TodoNameLookups } from '../utils/filter'
import type { FilterSettings } from '../utils/filter-match'
import type { WeekStart } from '../utils/effective-date'
import { statusFlowDays } from '../utils/trend-window'
import { sharedMemo, sharedMemoByKey } from '../utils/shared-memo'
import { tabBadgeRangesFor } from '../utils/tab-badges'
import { useNumberCount, type NumberCount, type StatsBase } from './use-glance-data'
import { useTrendEvents } from './use-trend-events'

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
function restrictionsOf(filter: TodoPredicate, field: 'personIds' | 'tags' | null, screen: FilterCriteria): RowRestrictions {
  return field ? groupRestrictions(field, filter, screen) : []
}
const restrictionsMemo = sharedMemoByKey(restrictionsOf)
/** A second set keyed alike (a Pivot reads both its people and its tags picks). */
const restrictionsTagsMemo = sharedMemoByKey(restrictionsOf)

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

// ── Pivot ───────────────────────────────────────────────────────────────────

const pivotMemo = sharedMemoByKey(function pivot(
  config: PivotConfig,
  tasks: readonly PersistedTodoItem[],
  ctx: StatsContext,
  people: RowRestrictions,
  tags: RowRestrictions,
): PivotStats {
  return computePivot(tasks, ctx, { rows: config.rows, cols: config.cols, restrictions: { people, tags } })
})

/** A Pivot's heat table (`services/stats/pivot`) over its filter's tasks; a people or tags axis narrows by the `@` / `#` picks. */
export function usePivotData(base: StatsBase, config: PivotConfig): ChartTasks & { stats: PivotStats } {
  const chart = useChartTasks(base, config.filter)
  const people = restrictionsMemo(config.filter, 'personIds', chart.count.screen)
  const tags = restrictionsTagsMemo(config.filter, 'tags', chart.count.screen)
  return { ...chart, stats: pivotMemo(config, chart.tasks, base.ctx, people, tags) }
}

// ── Status flow ─────────────────────────────────────────────────────────────

const flowDaysMemo = sharedMemo(function flowDays(todayMs: number, weeks: number, weekStartsOn: WeekStart) {
  return statusFlowDays(new Date(todayMs), weeks, weekStartsOn)
}, STATUS_FLOW_WEEK_CHOICES.length)

/** A Status flow's weeks, and whether its past weeks are exact (`historyExactness`). */
export interface StatusFlowData {
  stats: StatusFlowStats
  exactness: HistoryExactness
}

const flowMemo = sharedMemoByKey(function flow(
  config: StatusFlowConfig,
  filter: FilterCriteria,
  screen: FilterCriteria,
  todos: readonly PersistedTodoItem[],
  events: readonly TodoEvent[],
  days: Date[],
  lookups: TodoNameLookups,
  settings: FilterSettings,
  statuses: StatsContext['statuses'],
  historyLogSince: Date | null,
): StatusFlowData {
  // Keyed by its config (one set per chart); computed from its parts.
  void config
  const stages = numberStages(screen, filter)
  return {
    stats: computeStatusFlow(stages, todos, events, days, { lookups, settings, statuses }),
    exactness: historyExactness(stages, days[0] ?? new Date(0), historyLogSince),
  }
})

/**
 * A Status flow's weeks (`services/stats/status-flow`): its filter under
 * the screen filter, every task replayed to each week's end; `null` until
 * the history has been read.
 */
export function useStatusFlowData(base: StatsBase, config: StatusFlowConfig): { count: NumberCount; flow: StatusFlowData | null } {
  const count = useNumberCount(base, { filter: config.filter })
  const events = useTrendEvents(`flow${config.weeks}`)
  const historyLogSince = useSettingsStore((s) => s.historyLogSince)
  const days = flowDaysMemo(base.ctx.today.getTime(), config.weeks, base.ctx.weekStartsOn)
  const flow = events
    ? flowMemo(config, count.filter, count.screen, base.todos, events, days, base.lookups, base.markerSettings, base.ctx.statuses, historyLogSince)
    : null
  return { count, flow }
}

// ── Tag map ─────────────────────────────────────────────────────────────────

const tagMapMemo = sharedMemoByKey(function tagMap(
  config: TagMapConfig,
  tasks: readonly PersistedTodoItem[],
  ctx: StatsContext,
): TagMapTile[] {
  return computeTagMap(tasks, ctx, config.tagIds)
})

/** A Tag map's tiles (`services/stats/tag-map`) over its filter's tasks. */
export function useTagMapData(base: StatsBase, config: TagMapConfig): ChartTasks & { tiles: TagMapTile[] } {
  const chart = useChartTasks(base, config.filter)
  return { ...chart, tiles: tagMapMemo(config, chart.tasks, base.ctx) }
}
