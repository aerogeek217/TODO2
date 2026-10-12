import { useMemo } from 'react'
import type { PersistedTodoItem } from '../../../models'
import {
  DEFAULT_DASHBOARD_LOOK_AHEAD,
  DEFAULT_DASHBOARD_TREND_RANGE,
  type DashboardTabConfig,
  type DashboardTrendRange,
} from '../../../models/dashboard-config'
import { useMarkerSettings } from '../../../hooks/use-marker-settings'
import { useToday } from '../../../hooks/use-today'
import { useTrendEvents } from '../../../hooks/use-trend-events'
import { computeFollowupGroups, type FollowupGroups } from '../../../services/stats/followup-groups'
import { computeListTileCounts, type ListTileCount } from '../../../services/stats/list-tiles'
import { computeNextSevenDays, type NextDaysColumn } from '../../../services/stats/next-seven-days'
import { computePeopleStats, type PeopleStats } from '../../../services/stats/people'
import { statsFilter, type StatsContext } from '../../../services/stats/stats-context'
import { selectStatusBreakdown, type StatusBreakdownEntry } from '../../../services/stats/status-breakdown'
import { computeTiles, type TileStats } from '../../../services/stats/tiles'
import { computeTrend, type TrendStats } from '../../../services/stats/trend'
import { applyFilter, countActiveFilters, useFilterStore } from '../../../stores/filter-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'

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
  /** `null` until the history has been read. */
  trend: TrendStats | null
  trendRange: DashboardTrendRange
}

function sectionOption<K extends 'lookAhead' | 'range'>(config: DashboardTabConfig, id: 'followup' | 'trend', key: K) {
  return config.sections.find((s) => s.id === id)?.options?.[key]
}

export function useDashboardData(config: DashboardTabConfig): DashboardData {
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const statuses = useStatusStore((s) => s.statuses)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const screen = useFilterStore((s) => s.filters)
  const markerSettings = useMarkerSettings()
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)

  const trendRange = sectionOption(config, 'trend', 'range') ?? DEFAULT_DASHBOARD_TREND_RANGE
  const lookAhead = sectionOption(config, 'followup', 'lookAhead') ?? DEFAULT_DASHBOARD_LOOK_AHEAD
  const events = useTrendEvents(trendRange)

  const ctx = useMemo<StatsContext>(() => ({
    today,
    weekStartsOn,
    urgentRange: markerSettings.urgentRange,
    hotRule: markerSettings.hotRule,
    assignedPeopleMap,
    statuses,
  }), [today, weekStartsOn, markerSettings, assignedPeopleMap, statuses])

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

  return { ctx, shown, filtered, todoById, tiles, listTiles, followup, nextDays, status, people, trend, trendRange }
}
