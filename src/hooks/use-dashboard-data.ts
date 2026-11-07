import { useMemo } from 'react'
import type { PersistedTodoItem } from '../models'
import {
  DEFAULT_DASHBOARD_LOOK_AHEAD,
  DEFAULT_DASHBOARD_RECENT_DAYS,
  DEFAULT_DASHBOARD_STALE_DAYS,
  DEFAULT_DASHBOARD_TREND_RANGE,
  type DashboardSectionId,
  type DashboardSectionOptions,
  type DashboardTabConfig,
  type DashboardTrendRange,
} from '../models/dashboard-config'
import { computeFollowupGroups, type FollowupGroups } from '../services/stats/followup-groups'
import { computeListTileCounts, type ListTileCount } from '../services/stats/list-tiles'
import type { NextDaysColumn } from '../services/stats/next-seven-days'
import type { PeopleStats } from '../services/stats/people'
import type { RecentlyCompleted } from '../services/stats/recently-completed'
import { computeStaleTasks, type StaleTasks } from '../services/stats/stale'
import type { StatsContext } from '../services/stats/stats-context'
import type { StatusBreakdownEntry } from '../services/stats/status-breakdown'
import type { TagStats } from '../services/stats/tags'
import type { TileStats } from '../services/stats/tiles'
import type { TrendStats } from '../services/stats/trend'
import type { EisenhowerSummary } from '../services/stats/eisenhower-summary'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import type { LeavingRows } from './use-leaving-rows'
import {
  followupRowIds,
  lingeringRows,
  useEisenhowerStats,
  useFollowupStats,
  useNextDays,
  usePeopleStats,
  useRecentStats,
  useStaleStats,
  useStatsBase,
  useStatusStats,
  useTagStats,
  useTileStats,
  useTrendStats,
  type EisenhowerSetup,
  type ShownOfTotal,
} from './use-glance-data'

export type { EisenhowerSetup, ShownOfTotal } from './use-glance-data'

/**
 * Everything a dashboard shows, from the glance widgets' shared parts
 * (`use-glance-data`): each statistic over the tasks passing the screen
 * filter (completed ones included, for the trend) and over all tasks, so
 * counts can read `shown of total`.
 */
export interface DashboardData {
  ctx: StatsContext
  /** Tasks passing the screen filter (completed included). */
  shown: PersistedTodoItem[]
  /** The screen filter narrows the tasks (Show completed alone doesn't). */
  filtered: boolean
  todoById: ReadonlyMap<number, PersistedTodoItem>
  tiles: ShownOfTotal<TileStats>
  listTiles: ListTileCount[]
  followup: ShownOfTotal<FollowupGroups>
  nextDays: NextDaysColumn[]
  status: ShownOfTotal<StatusBreakdownEntry[]>
  people: PeopleStats
  tags: ShownOfTotal<TagStats>
  /** Open tasks not changed in `staleDays` days or more. */
  stale: ShownOfTotal<StaleTasks>
  staleDays: number
  /** Tasks completed in the last `recentDays` days. */
  recent: ShownOfTotal<RecentlyCompleted>
  recentDays: number
  eisenhower: ShownOfTotal<EisenhowerSummary>
  /** The app-wide Eisenhower panes and source the Eisenhower section counts with. */
  eisenhowerSetup: EisenhowerSetup
  /** `null` until the history has been read. */
  trend: TrendStats | null
  trendRange: DashboardTrendRange
  /** The task-row sections' rows (Needs follow-up, Stale). */
  rows: DashboardRows
}

/**
 * The rows of the task-row sections: `followup.shown` and
 * `stale.shown` — plus, while a just-completed task lingers (D19), that task
 * as it was before, in its place.
 */
export interface DashboardRows {
  followup: FollowupGroups
  stale: number[]
  /** The leaving tasks these rows keep as they were (they show as they are now, completed). */
  kept: ReadonlySet<number>
}

function sectionOption<K extends keyof DashboardSectionOptions>(config: DashboardTabConfig, id: DashboardSectionId, key: K) {
  return config.sections.find((s) => s.id === id)?.options?.[key]
}

type SectionRows = Omit<DashboardRows, 'kept'>

const sectionRowIds = (r: SectionRows): number[] => [...followupRowIds(r.followup), ...r.stale]

/**
 * `leaving` (a widget's `useLeavingRows`): just-completed tasks the task-row
 * sections keep in place, as they were, until they have folded away.
 */
export function useDashboardData(config: DashboardTabConfig, leaving?: LeavingRows): DashboardData {
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)

  const trendRange = sectionOption(config, 'trend', 'range') ?? DEFAULT_DASHBOARD_TREND_RANGE
  const lookAhead = sectionOption(config, 'followup', 'lookAhead') ?? DEFAULT_DASHBOARD_LOOK_AHEAD
  const staleDays = sectionOption(config, 'stale', 'staleDays') ?? DEFAULT_DASHBOARD_STALE_DAYS
  const recentDays = sectionOption(config, 'recent', 'recentDays') ?? DEFAULT_DASHBOARD_RECENT_DAYS

  const base = useStatsBase()
  const { ctx, shown, filtered, todoById, todos, screen, lookups, markerSettings } = base
  const tiles = useTileStats(base)
  const followup = useFollowupStats(base, lookAhead)
  const nextDays = useNextDays(base)
  const status = useStatusStats(base)
  const people = usePeopleStats(base)
  const tags = useTagStats(base)
  const stale = useStaleStats(base, staleDays)
  const recent = useRecentStats(base, recentDays)
  const { eisenhower, eisenhowerSetup } = useEisenhowerStats(base)
  const trend = useTrendStats(base, trendRange)

  const listTiles = useMemo(() => {
    if (config.listTiles.length === 0) return []
    // Unsaved list edits show on the tiles too, as in the list's widgets.
    const byId = new Map(listDefinitions.map((d) => [d.id, drafts[d.id] ?? d]))
    const defs = config.listTiles.flatMap((id) => {
      const def = byId.get(id)
      return def ? [def] : []
    })
    return computeListTileCounts(defs, todos, {
      screen,
      lookups,
      today: ctx.today,
      weekStartsOn: ctx.weekStartsOn,
      markerSettings,
    })
  }, [config.listTiles, listDefinitions, drafts, todos, screen, lookups, ctx, markerSettings])

  // Both task-row sections linger together: one rebuild as they were.
  const rows = useMemo<DashboardRows>(() => {
    const now: SectionRows = { followup: followup.shown, stale: stale.shown.ids }
    const asWas = (tasks: PersistedTodoItem[]): SectionRows => ({
      followup: computeFollowupGroups(tasks, ctx, lookAhead),
      stale: computeStaleTasks(tasks, ctx, staleDays).ids,
    })
    const { rows: r, kept } = lingeringRows(base, now, sectionRowIds, asWas, leaving)
    return { ...r, kept }
  }, [base, followup, stale, leaving, ctx, lookAhead, staleDays])

  return {
    ctx, shown, filtered, todoById, tiles, listTiles, followup, nextDays, status, people,
    tags, stale, staleDays, recent, recentDays, eisenhower, eisenhowerSetup, trend, trendRange, rows,
  }
}
