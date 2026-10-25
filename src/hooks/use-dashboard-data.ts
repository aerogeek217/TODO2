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
import { useFilterSettings } from './use-filter-settings'
import { useToday } from './use-today'
import { useTrendEvents } from './use-trend-events'
import { computeFollowupGroups, type FollowupGroups } from '../services/stats/followup-groups'
import { computeListTileCounts, type ListTileCount } from '../services/stats/list-tiles'
import { computeNextSevenDays, type NextDaysColumn } from '../services/stats/next-seven-days'
import { computePeopleStats, type PeopleStats } from '../services/stats/people'
import { statsFilter, type StatsContext } from '../services/stats/stats-context'
import { selectStatusBreakdown, type StatusBreakdownEntry } from '../services/stats/status-breakdown'
import { computeTiles, type TileStats } from '../services/stats/tiles'
import { computeTrend, type TrendStats } from '../services/stats/trend'
import { computeTagStats, type TagStats } from '../services/stats/tags'
import { computeStaleTasks, type StaleTasks } from '../services/stats/stale'
import { computeRecentlyCompleted, type RecentlyCompleted } from '../services/stats/recently-completed'
import { computeEisenhowerSummary, eisenhowerSourceTasks, type EisenhowerSummary } from '../services/stats/eisenhower-summary'
import { resolvePanes, type EisenhowerPane } from '../utils/eisenhower-panes'
import { usePaneContext } from './use-pane-context'
import { useScreenFilter } from '../stores/screen-filter'
import { countActiveFilters } from '../utils/filter-criteria'
import { hasNarrowingFilters } from '../utils/filter-chips'
import { applyFilter } from '../utils/filter-match'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { usePersonStore } from '../stores/person-store'
import { useSettingsStore } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'

/** A statistic over the screen-filtered tasks, and over every task (the `of N`). */
export interface ShownOfTotal<T> {
  shown: T
  total: T
}

/**
 * Everything a dashboard shows, computed once per change from the stores:
 * each statistic over the tasks passing the screen filter (completed ones
 * included, for the trend) and over all tasks, so counts can read
 * `shown of total`.
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
}

/** The Eisenhower settings as the dashboard's Eisenhower section uses them. */
export interface EisenhowerSetup {
  /** The four panes, in position order. */
  panes: readonly EisenhowerPane[]
  /**
   * The Eisenhower's list's name (as edited) when its filter narrows the
   * tasks; `null` while it holds every task.
   */
  listName: string | null
}

function sectionOption<K extends keyof DashboardSectionOptions>(config: DashboardTabConfig, id: DashboardSectionId, key: K) {
  return config.sections.find((s) => s.id === id)?.options?.[key]
}

export function useDashboardData(config: DashboardTabConfig): DashboardData {
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const statuses = useStatusStore((s) => s.statuses)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const screen = useScreenFilter().filters
  const markerSettings = useFilterSettings()
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  const storedPanes = useSettingsStore((s) => s.eisenhowerPanes)
  const eisenhowerListId = useSettingsStore((s) => s.eisenhowerListId)
  const paneCtx = usePaneContext()

  const trendRange = sectionOption(config, 'trend', 'range') ?? DEFAULT_DASHBOARD_TREND_RANGE
  const lookAhead = sectionOption(config, 'followup', 'lookAhead') ?? DEFAULT_DASHBOARD_LOOK_AHEAD
  const staleDays = sectionOption(config, 'stale', 'staleDays') ?? DEFAULT_DASHBOARD_STALE_DAYS
  const recentDays = sectionOption(config, 'recent', 'recentDays') ?? DEFAULT_DASHBOARD_RECENT_DAYS
  const events = useTrendEvents(trendRange)

  const ctx = useMemo<StatsContext>(() => ({
    today,
    weekStartsOn,
    urgentRange: markerSettings.urgentRange,
    hotRule: markerSettings.hotRule,
    assignedPeopleMap,
    assignedTagsMap,
    statuses,
  }), [today, weekStartsOn, markerSettings, assignedPeopleMap, assignedTagsMap, statuses])

  const shown = useMemo(
    () => applyFilter(statsFilter(screen), todos, assignedPeopleMap, statuses, today, assignedTagsMap, markerSettings),
    [screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, markerSettings],
  )
  const todoById = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos])
  const filtered = countActiveFilters({ ...screen, showCompleted: false }) > 0

  const tiles = useMemo(() => ({ shown: computeTiles(shown, ctx), total: computeTiles(todos, ctx) }), [shown, todos, ctx])
  const followup = useMemo(
    () => ({ shown: computeFollowupGroups(shown, ctx, lookAhead), total: computeFollowupGroups(todos, ctx, lookAhead) }),
    [shown, todos, ctx, lookAhead],
  )
  const nextDays = useMemo(() => computeNextSevenDays(shown, ctx), [shown, ctx])
  const status = useMemo(
    () => ({ shown: selectStatusBreakdown(shown, statuses), total: selectStatusBreakdown(todos, statuses) }),
    [shown, todos, statuses],
  )
  const people = useMemo(() => computePeopleStats(shown, ctx), [shown, ctx])
  const tags = useMemo(() => ({ shown: computeTagStats(shown, ctx), total: computeTagStats(todos, ctx) }), [shown, todos, ctx])
  const stale = useMemo(
    () => ({ shown: computeStaleTasks(shown, ctx, staleDays), total: computeStaleTasks(todos, ctx, staleDays) }),
    [shown, todos, ctx, staleDays],
  )
  const recent = useMemo(
    () => ({ shown: computeRecentlyCompleted(shown, ctx, recentDays), total: computeRecentlyCompleted(todos, ctx, recentDays) }),
    [shown, todos, ctx, recentDays],
  )
  // The Eisenhower section: the Eisenhower's own list's members (its unsaved
  // draft included; every task until it is loaded) sorted by the app-wide panes.
  const eisenhowerPanes = useMemo(() => resolvePanes(storedPanes), [storedPanes])
  const eisenhowerList = useMemo(() => {
    const saved = eisenhowerListId != null ? listDefinitions.find((d) => d.id === eisenhowerListId) : undefined
    return saved ? (drafts[saved.id] ?? saved) : undefined
  }, [eisenhowerListId, listDefinitions, drafts])
  const eisenhowerSetup = useMemo<EisenhowerSetup>(() => {
    const savedName = listDefinitions.find((d) => d.id === eisenhowerListId)?.name
    const narrows = eisenhowerList != null && hasNarrowingFilters(eisenhowerList.membership.predicate)
    return {
      panes: eisenhowerPanes,
      listName: narrows ? (eisenhowerList.name.trim() || savedName || '') : null,
    }
  }, [eisenhowerPanes, eisenhowerList, eisenhowerListId, listDefinitions])
  const eisenhower = useMemo(() => {
    const source = eisenhowerSourceTasks(todos, shown, eisenhowerList, {
      screen: statsFilter(screen),
      lookups: { assignedPeopleMap, assignedTagsMap, statusesById: new Map(statuses.map((st) => [st.id!, st])) },
      today,
      settings: markerSettings,
    })
    return {
      shown: computeEisenhowerSummary(source.shown, eisenhowerPanes, paneCtx),
      total: computeEisenhowerSummary(source.total, eisenhowerPanes, paneCtx),
    }
  }, [eisenhowerList, todos, shown, screen, assignedPeopleMap, assignedTagsMap, statuses, today, markerSettings, eisenhowerPanes, paneCtx])
  const trend = useMemo(
    () => (events ? computeTrend(shown, events, ctx, trendRange) : null),
    [shown, events, ctx, trendRange],
  )

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
      lookups: {
        assignedPeopleMap,
        assignedTagsMap,
        statusesById: new Map(statuses.map((s) => [s.id!, s])),
      },
      today,
      weekStartsOn,
      markerSettings,
    })
  }, [config.listTiles, listDefinitions, drafts, todos, screen, assignedPeopleMap, assignedTagsMap, statuses, today, weekStartsOn, markerSettings])

  return {
    ctx, shown, filtered, todoById, tiles, listTiles, followup, nextDays, status, people,
    tags, stale, staleDays, recent, recentDays, eisenhower, eisenhowerSetup, trend, trendRange,
  }
}
