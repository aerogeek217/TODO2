import type { PersistedTodoItem, TodoPredicate } from '../models'
import { breakdownColumns, DEFAULT_BREAKDOWN_OLDEST_BY, type BreakdownColumn, type BreakdownConfig, type PivotConfig, type TagMapConfig } from '../models/chart-widgets'
import type { TabBadgeRanges } from '../models/list-definition'
import { groupRestrictions } from '../services/build-list'
import { computeBreakdown, type BreakdownColumnKeep, type BreakdownStats } from '../services/stats/breakdown'
import { computePivot, type PivotStats } from '../services/stats/pivot'
import { computeTagMap, type TagMapTile } from '../services/stats/tag-map'
import type { RowRestrictions } from '../services/stats/row-restrictions'
import type { StatsContext } from '../services/stats/stats-context'
import { useSettingsStore } from '../stores/settings-store'
import { predicateToCriteria, type FilterCriteria } from '../utils/filter-criteria'
import { matchesFilterWithLookups, type FilterSettings } from '../utils/filter-match'
import type { TodoNameLookups } from '../utils/filter'
import { sharedMemoByKey } from '../utils/shared-memo'
import { lookupsFor, numberCountOf, useNumberCount, type NumberCount, type StatsBase } from './use-glance-data'

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

/**
 * A Breakdown's count columns (`breakdownColumns`): its own, else the two
 * its old `badges` say — derived here, per config, so they are the same
 * objects while neither the config nor Settings' ranges change.
 */
const columnsMemo = sharedMemoByKey(function columnsOf(config: BreakdownConfig, app: TabBadgeRanges): readonly BreakdownColumn[] {
  return breakdownColumns(config, app)
})

/** Each column's filter as criteria (the same objects while the columns are). */
const columnCriteriaMemo = sharedMemoByKey(function columnCriteria(columns: readonly BreakdownColumn[]): FilterCriteria[] {
  return columns.map((c) => predicateToCriteria(c.filter))
})

/**
 * Each column's tasks among the chart's: its filter (as a Number's) over
 * them. Keyed on the lookups the filters need (`lookupsFor`), so a status
 * update or subtask write recomputes nothing unless a column reads text.
 */
const columnKeepsMemo = sharedMemoByKey(function columnKeeps(
  columns: readonly BreakdownColumn[],
  criteria: readonly FilterCriteria[],
  tasks: readonly PersistedTodoItem[],
  lookups: TodoNameLookups,
  ctx: StatsContext,
  settings: FilterSettings,
): BreakdownColumnKeep[] {
  return columns.map((c, i) => {
    const filter = criteria[i] ?? predicateToCriteria(c.filter)
    const keep = new Set<number>()
    for (const t of tasks) if (matchesFilterWithLookups(filter, t, lookups, ctx.today, settings)) keep.add(t.id)
    return { id: c.id, keep }
  })
})


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
  columns: readonly BreakdownColumnKeep[],
  restrictions: RowRestrictions,
): BreakdownStats {
  return computeBreakdown(tasks, ctx, {
    splitBy: config.splitBy,
    show: config.show,
    oldestBy: config.oldestBy ?? DEFAULT_BREAKDOWN_OLDEST_BY,
    columns,
    restrictions,
  })
})

/** What a Breakdown shows. */
export interface BreakdownData extends ChartTasks {
  stats: BreakdownStats
  /** Its count columns, in order (its own, or the two read from its old `badges`). */
  columns: readonly BreakdownColumn[]
}

/** A Breakdown's rows (`services/stats/breakdown`) over its filter's tasks, with its count columns. */
export function useBreakdownData(base: StatsBase, config: BreakdownConfig): BreakdownData {
  const appRanges = useSettingsStore((s) => s.tabBadges)
  return breakdownDataOf(base, config, appRanges)
}

/**
 * `useBreakdownData` outside a render (no hook inside): a Breakdown row's
 * tasks taken again over another base — the review deck's lens toggle
 * (item 10) on a row's review.
 */
export function breakdownDataOf(base: StatsBase, config: BreakdownConfig, appRanges: TabBadgeRanges): BreakdownData {
  const count = numberCountOf(base, { filter: config.filter })
  const chart: ChartTasks = { count, tasks: tasksOfMemo(count.ids.shown, base.todoById) }
  const columns = columnsMemo(config, appRanges)
  const criteria = columnCriteriaMemo(columns)
  const keeps = columnKeepsMemo(columns, criteria, chart.tasks, lookupsFor(base, ...criteria), base.ctx, base.markerSettings)
  const field = config.splitBy === 'people' ? 'personIds' : config.splitBy === 'tags' ? 'tags' : null
  const restrictions = restrictionsMemo(config.filter, field, chart.count.screen)
  const stats = breakdownMemo(config, chart.tasks, base.ctx, keeps, restrictions)
  return { ...chart, stats, columns }
}

// ── Pivot ───────────────────────────────────────────────────────────────────

const pivotMemo = sharedMemoByKey(function pivot(
  config: PivotConfig,
  tasks: readonly PersistedTodoItem[],
  ctx: StatsContext,
  people: RowRestrictions,
  tags: RowRestrictions,
  ranges: TabBadgeRanges,
): PivotStats {
  return computePivot(tasks, ctx, { rows: config.rows, cols: config.cols, restrictions: { people, tags }, ranges })
})

/** A Pivot's heat table (`services/stats/pivot`) over its filter's tasks; a people or tags axis narrows by the `@` / `#` picks. */
export function usePivotData(base: StatsBase, config: PivotConfig): ChartTasks & { stats: PivotStats } {
  // Its people / tags order by the tasks due and due a follow-up in Settings' ranges.
  const appRanges = useSettingsStore((s) => s.tabBadges)
  const chart = useChartTasks(base, config.filter)
  const people = restrictionsMemo(config.filter, 'personIds', chart.count.screen)
  const tags = restrictionsTagsMemo(config.filter, 'tags', chart.count.screen)
  return { ...chart, stats: pivotMemo(config, chart.tasks, base.ctx, people, tags, appRanges) }
}

// ── Tag map ─────────────────────────────────────────────────────────────────

const tagMapMemo = sharedMemoByKey(function tagMap(
  config: TagMapConfig,
  tasks: readonly PersistedTodoItem[],
  ctx: StatsContext,
  restrictions: RowRestrictions,
): TagMapTile[] {
  return computeTagMap(tasks, ctx, config.tagIds, restrictions)
})

/** A Tag map's tiles (`services/stats/tag-map`) over its filter's tasks, narrowed by the `#` picks as a Breakdown by tags. */
export function useTagMapData(base: StatsBase, config: TagMapConfig): ChartTasks & { tiles: TagMapTile[] } {
  const chart = useChartTasks(base, config.filter)
  const restrictions = restrictionsTagsMemo(config.filter, 'tags', chart.count.screen)
  return { ...chart, tiles: tagMapMemo(config, chart.tasks, base.ctx, restrictions) }
}
