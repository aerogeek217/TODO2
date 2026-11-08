import { useMemo } from 'react'
import type { PersistedTodoItem, Tag, TodoEvent } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
import type { LookAhead, TrendRange } from '../models/glance-widgets'
import { groupRestrictions } from '../services/build-list'
import { computeChanges, type Change } from '../services/stats/changes'
import { computeClosedThisWeek, type ClosedThisWeek } from '../services/stats/closed-this-week'
import { computeEisenhowerSummary, eisenhowerSourceTasks, type EisenhowerSummary } from '../services/stats/eisenhower-summary'
import { computeFollowupGroups, type FollowupGroups } from '../services/stats/followup-groups'
import { computeMetricHistory, type MetricHistory } from '../services/stats/metric-history'
import { computeNextSevenDays, type NextDaysColumn } from '../services/stats/next-seven-days'
import { computePeopleStats, type PeopleStats } from '../services/stats/people'
import { computePulse, type PulseCard } from '../services/stats/pulse'
import { computeRecentlyCompleted, type RecentlyCompleted } from '../services/stats/recently-completed'
import { computeStaleTasks, type StaleTasks } from '../services/stats/stale'
import { statsFilter, type StatsContext } from '../services/stats/stats-context'
import { selectStatusBreakdown, type StatusBreakdownEntry } from '../services/stats/status-breakdown'
import { computeTagStats, type TagStats } from '../services/stats/tags'
import { computeMetrics, type MetricStats } from '../services/stats/metrics'
import { computeTodayPicks, openFocusIds, type TodayPicks } from '../services/stats/today-picks'
import { computeTrend, type TrendStats } from '../services/stats/trend'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { usePersonStore } from '../stores/person-store'
import { useScreenFilter } from '../stores/screen-filter'
import { useSettingsStore } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useStatusUpdateStore } from '../stores/status-update-store'
import { useSubtaskStore } from '../stores/subtask-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import type { PaneContext } from '../utils/eisenhower'
import { resolvePanes, type EisenhowerPane } from '../utils/eisenhower-panes'
import { todoNameLookups, type TodoNameLookups } from '../utils/filter'
import { hasNarrowingFilters } from '../utils/filter-chips'
import { countActiveFilters, type FilterCriteria } from '../utils/filter-criteria'
import { applyFilter, type FilterSettings } from '../utils/filter-match'
import type { UrgentDueWithinDays } from '../utils/urgency'
import type { WeekStart } from '../utils/effective-date'
import { sameElements, sharedMemo } from '../utils/shared-memo'
import { keptOf, restoreLeaving, type LeavingRows } from './use-leaving-rows'
import { useToday } from './use-today'
import { useTrendEvents } from './use-trend-events'

/**
 * The glance widgets' data, a hook per part over one
 * shared base: the screen-filtered tasks are filtered once for every widget
 * on screen, and each statistic computed once per set of inputs, however
 * many widgets show it (`utils/shared-memo` — each part's inputs are store
 * values or other shared parts, so they compare by identity). The
 * statistics themselves are the pure `services/stats/*` functions.
 */

/** A statistic over the screen-filtered tasks, and over every task (the `of N`). */
export interface ShownOfTotal<T> {
  shown: T
  total: T
}

/** What every part is computed from. */
export interface StatsBase {
  ctx: StatsContext
  /** Every task. */
  todos: readonly PersistedTodoItem[]
  /** Tasks passing the screen filter (completed included). */
  shown: PersistedTodoItem[]
  /** The screen filter narrows the tasks (Show completed alone doesn't). */
  filtered: boolean
  todoById: ReadonlyMap<number, PersistedTodoItem>
  /** The screen filter (with the lens). */
  screen: FilterCriteria
  lookups: TodoNameLookups
  markerSettings: FilterSettings
}

const ctxMemo = sharedMemo((
  todayMs: number,
  weekStartsOn: WeekStart,
  urgentRange: UrgentDueWithinDays,
  assignedPeopleMap: StatsContext['assignedPeopleMap'],
  assignedTagsMap: StatsContext['assignedTagsMap'],
  statuses: StatsContext['statuses'],
): StatsContext => ({ today: new Date(todayMs), weekStartsOn, urgentRange, assignedPeopleMap, assignedTagsMap, statuses }))

const settingsMemo = sharedMemo((urgentRange: UrgentDueWithinDays, weekStartsOn: WeekStart): FilterSettings => ({ urgentRange, weekStartsOn }))

const lookupsMemo = sharedMemo((
  assignedPeopleMap: TodoNameLookups['assignedPeopleMap'],
  assignedTagsMap: TodoNameLookups['assignedTagsMap'],
  statuses: StatsContext['statuses'],
  statusUpdatesByTodo: TodoNameLookups['statusUpdatesByTodo'],
  subtasksByTodo: TodoNameLookups['subtasksByTodo'],
) => todoNameLookups({ assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo, subtasksByTodo }))

// The same tasks as last time (a status update or subtask write the text
// search doesn't change the outcome of) keep the same array, so no part keyed on it recomputes.
const shownMemo = sharedMemo((
  screen: FilterCriteria,
  todos: readonly PersistedTodoItem[],
  lookups: TodoNameLookups,
  ctx: StatsContext,
  settings: FilterSettings,
) => applyFilter(statsFilter(screen), todos, lookups, ctx.today, settings), 8, sameElements)

const byIdMemo = sharedMemo((todos: readonly PersistedTodoItem[]) => new Map(todos.map((t) => [t.id, t])))

/** The shared base: the context and the screen-filtered tasks, the same objects in every widget. */
export function useStatsBase(): StatsBase {
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const statuses = useStatusStore((s) => s.statuses)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statusUpdatesByTodo = useStatusUpdateStore((s) => s.byTodo)
  const subtasksByTodo = useSubtaskStore((s) => s.byTodo)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const screen = useScreenFilter().filters

  const ctx = ctxMemo(today.getTime(), weekStartsOn, urgentRange, assignedPeopleMap, assignedTagsMap, statuses)
  const markerSettings = settingsMemo(urgentRange, weekStartsOn)
  const lookups = lookupsMemo(assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo, subtasksByTodo)
  const shown = shownMemo(screen, todos, lookups, ctx, markerSettings)
  const todoById = byIdMemo(todos)
  const filtered = countActiveFilters({ ...screen, showCompleted: false }) > 0
  return useMemo(
    () => ({ ctx, todos, shown, filtered, todoById, screen, lookups, markerSettings }),
    [ctx, todos, shown, filtered, todoById, screen, lookups, markerSettings],
  )
}

// ── The parts ───────────────────────────────────────────────────────────────

type Tasks = readonly PersistedTodoItem[]

/**
 * A statistic over the screen-filtered tasks and over every task, each half
 * memoized on its own tasks: a screen filter change recomputes only the
 * shown half, and the pair keeps its identity while both halves do.
 */
function shownOfTotalMemo<O extends readonly unknown[], T>(compute: (tasks: Tasks, ...opts: O) => T) {
  const shownHalf = sharedMemo((tasks: Tasks, ...opts: O) => compute(tasks, ...opts))
  const totalHalf = sharedMemo((tasks: Tasks, ...opts: O) => compute(tasks, ...opts))
  const pair = sharedMemo((shown: T, total: T): ShownOfTotal<T> => ({ shown, total }))
  return (shown: Tasks, todos: Tasks, ...opts: O): ShownOfTotal<T> => pair(shownHalf(shown, ...opts), totalHalf(todos, ...opts))
}

const metricsMemo = shownOfTotalMemo((tasks: Tasks, ctx: StatsContext) => computeMetrics(tasks, ctx))
/** The counted metrics (every Number metric but Closed this week). */
export function useMetricStats(base: StatsBase): ShownOfTotal<MetricStats> {
  return metricsMemo(base.shown, base.todos, base.ctx)
}

const closedMemo = shownOfTotalMemo((tasks: Tasks, ctx: StatsContext) => computeClosedThisWeek(tasks, ctx))
export function useClosedThisWeek(base: StatsBase): ShownOfTotal<ClosedThisWeek> {
  return closedMemo(base.shown, base.todos, base.ctx)
}

const followupMemo = shownOfTotalMemo((tasks: Tasks, ctx: StatsContext, lookAhead: LookAhead) => computeFollowupGroups(tasks, ctx, lookAhead))
export function useFollowupStats(base: StatsBase, lookAhead: LookAhead): ShownOfTotal<FollowupGroups> {
  return followupMemo(base.shown, base.todos, base.ctx, lookAhead)
}

const nextDaysMemo = sharedMemo((shown: Tasks, ctx: StatsContext): NextDaysColumn[] => computeNextSevenDays(shown, ctx))
export function useNextDays(base: StatsBase): NextDaysColumn[] {
  return nextDaysMemo(base.shown, base.ctx)
}

const statusMemo = shownOfTotalMemo((tasks: Tasks, statuses: StatsContext['statuses']) => selectStatusBreakdown(tasks, statuses))
export function useStatusStats(base: StatsBase): ShownOfTotal<StatusBreakdownEntry[]> {
  return statusMemo(base.shown, base.todos, base.ctx.statuses)
}

// The People / Tags rows narrow by the top bar's `@` / `#` picks (its chips' and its lens's), as a list grouped so does.
const peopleMemo = sharedMemo((shown: Tasks, ctx: StatsContext, screen: FilterCriteria): PeopleStats => (
  computePeopleStats(shown, ctx, groupRestrictions('personIds', undefined, screen))
))
export function usePeopleStats(base: StatsBase): PeopleStats {
  return peopleMemo(base.shown, base.ctx, base.screen)
}

const tagsShownMemo = sharedMemo((shown: Tasks, ctx: StatsContext, screen: FilterCriteria): TagStats => (
  computeTagStats(shown, ctx, groupRestrictions('tags', undefined, screen))
))
const tagsTotalMemo = sharedMemo((todos: Tasks, ctx: StatsContext): TagStats => computeTagStats(todos, ctx))
const tagsPairMemo = sharedMemo((shown: TagStats, total: TagStats): ShownOfTotal<TagStats> => ({ shown, total }))
export function useTagStats(base: StatsBase): ShownOfTotal<TagStats> {
  return tagsPairMemo(tagsShownMemo(base.shown, base.ctx, base.screen), tagsTotalMemo(base.todos, base.ctx))
}

const staleMemo = shownOfTotalMemo((tasks: Tasks, ctx: StatsContext, days: number) => computeStaleTasks(tasks, ctx, days))
export function useStaleStats(base: StatsBase, days: number): ShownOfTotal<StaleTasks> {
  return staleMemo(base.shown, base.todos, base.ctx, days)
}

const recentMemo = shownOfTotalMemo((tasks: Tasks, ctx: StatsContext, days: number) => computeRecentlyCompleted(tasks, ctx, days))
export function useRecentStats(base: StatsBase, days: number): ShownOfTotal<RecentlyCompleted> {
  return recentMemo(base.shown, base.todos, base.ctx, days)
}

const trendMemo = sharedMemo((shown: Tasks, events: readonly TodoEvent[], ctx: StatsContext, range: TrendRange): TrendStats => (
  computeTrend(shown, events, ctx, range)
))
/** Created vs completed over `range`; `null` until the history has been read. */
export function useTrendStats(base: StatsBase, range: TrendRange): TrendStats | null {
  const events = useTrendEvents(range)
  return events ? trendMemo(base.shown, events, base.ctx, range) : null
}

const historyMemo = sharedMemo((shown: Tasks, events: readonly TodoEvent[], ctx: StatsContext): MetricHistory => (
  computeMetricHistory(shown, events, ctx)
))
const historyTrendMemo = sharedMemo((shown: Tasks, events: readonly TodoEvent[], ctx: StatsContext): TrendStats => (
  computeTrend(shown, events, ctx, '14d')
))
/**
 * The Numbers' 14-day history over the screen-filtered tasks, and the
 * 14-day trend read from the same events (the Open sub-line's net);
 * `null` until the history has been read.
 */
export function useMetricHistory(base: StatsBase): { history: MetricHistory; trend: TrendStats } | null {
  const events = useTrendEvents('history')
  if (!events) return null
  return { history: historyMemo(base.shown, events, base.ctx), trend: historyTrendMemo(base.shown, events, base.ctx) }
}

// ── The brief's parts (D25 L) ───────────────────────────────────────────────

const changesMemo = sharedMemo((
  shown: Tasks,
  events: readonly TodoEvent[],
  ctx: StatsContext,
  tagIds: readonly number[],
  retentionDays: number | null,
): Change[] => computeChanges(shown, events, ctx, tagIds, retentionDays))
/** What changed's sentences over the screen-filtered tasks; `null` until its events have been read. */
export function useChanges(base: StatsBase, tagIds: readonly number[]): Change[] | null {
  const events = useTrendEvents('changes')
  const retentionDays = useSettingsStore((s) => s.completedRetentionDays)
  return events ? changesMemo(base.shown, events, base.ctx, tagIds, retentionDays) : null
}

const pulseMemo = sharedMemo((shown: Tasks, tags: readonly Tag[], ctx: StatsContext, tagIds: readonly number[], staleAfterDays: number): PulseCard[] => (
  computePulse(shown, tags, ctx, tagIds, staleAfterDays)
))
/** Project pulse's cards over the screen-filtered tasks, a card per picked tag. */
export function usePulse(base: StatsBase, tagIds: readonly number[]): PulseCard[] {
  const tags = useTagStore((s) => s.tags)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  return pulseMemo(base.shown, tags, base.ctx, tagIds, staleAfterDays)
}

const todayMemo = sharedMemo((shown: Tasks, ctx: StatsContext): TodayPicks => computeTodayPicks(shown, ctx))
/** Today's Focus tasks and suggestions over the screen-filtered tasks. */
export function useTodayPicks(base: StatsBase): TodayPicks {
  return todayMemo(base.shown, base.ctx)
}

// ── The Eisenhower summary ──────────────────────────────────────────────────

/** The Eisenhower settings as the Eisenhower summary uses them. */
export interface EisenhowerSetup {
  /** The four panes, in position order. */
  panes: readonly EisenhowerPane[]
  /**
   * The Eisenhower's list's name (as edited) when its filter narrows the
   * tasks; `null` while it holds every task.
   */
  listName: string | null
}

const panesMemo = sharedMemo(resolvePanes)

const eisenhowerListMemo = sharedMemo((
  listId: number | null,
  defs: readonly PersistedListDefinition[],
  drafts: Readonly<Record<number, PersistedListDefinition | undefined>>,
): PersistedListDefinition | undefined => {
  const saved = listId != null ? defs.find((d) => d.id === listId) : undefined
  return saved ? (drafts[saved.id] ?? saved) : undefined
})

const setupMemo = sharedMemo((
  panes: readonly EisenhowerPane[],
  list: PersistedListDefinition | undefined,
  listId: number | null,
  defs: readonly PersistedListDefinition[],
): EisenhowerSetup => {
  const savedName = defs.find((d) => d.id === listId)?.name
  const narrows = list != null && hasNarrowingFilters(list.membership.predicate)
  return { panes, listName: narrows ? (list.name.trim() || savedName || '') : null }
})

const paneCtxMemo = sharedMemo((
  ctx: StatsContext,
  settings: FilterSettings,
  people: PaneContext['people'],
  tags: PaneContext['tags'],
  statusUpdatesByTodo: PaneContext['statusUpdatesByTodo'],
  subtasksByTodo: PaneContext['subtasksByTodo'],
): PaneContext => ({
  today: ctx.today,
  settings,
  people,
  assignedPeopleMap: ctx.assignedPeopleMap,
  tags,
  assignedTagsMap: ctx.assignedTagsMap,
  statuses: ctx.statuses,
  statusUpdatesByTodo,
  subtasksByTodo,
}))

const eisenhowerMemo = sharedMemo((
  todos: Tasks,
  shown: Tasks,
  screen: FilterCriteria,
  lookups: TodoNameLookups,
  settings: FilterSettings,
  list: PersistedListDefinition | undefined,
  panes: readonly EisenhowerPane[],
  paneCtx: PaneContext,
): ShownOfTotal<EisenhowerSummary> => {
  const source = eisenhowerSourceTasks(todos, shown, list, { screen: statsFilter(screen), lookups, today: paneCtx.today, settings })
  return {
    shown: computeEisenhowerSummary(source.shown, panes, paneCtx),
    total: computeEisenhowerSummary(source.total, panes, paneCtx),
  }
})

/**
 * The Eisenhower summary: the Eisenhower's own list's members (its unsaved
 * draft included; every task until it is loaded) sorted by the app-wide
 * panes, and the setup it counts with.
 */
export function useEisenhowerStats(base: StatsBase): { eisenhower: ShownOfTotal<EisenhowerSummary>; eisenhowerSetup: EisenhowerSetup } {
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  const storedPanes = useSettingsStore((s) => s.eisenhowerPanes)
  const eisenhowerListId = useSettingsStore((s) => s.eisenhowerListId)
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statusUpdatesByTodo = useStatusUpdateStore((s) => s.byTodo)
  const subtasksByTodo = useSubtaskStore((s) => s.byTodo)

  const panes = panesMemo(storedPanes)
  const list = eisenhowerListMemo(eisenhowerListId, listDefinitions, drafts)
  const eisenhowerSetup = setupMemo(panes, list, eisenhowerListId, listDefinitions)
  const paneCtx = paneCtxMemo(base.ctx, base.markerSettings, people, tags, statusUpdatesByTodo, subtasksByTodo)
  const eisenhower = eisenhowerMemo(base.todos, base.shown, base.screen, base.lookups, base.markerSettings, list, panes, paneCtx)
  return { eisenhower, eisenhowerSetup }
}

// ── Task rows that linger (D19) ─────────────────────────────────────────────

const NO_IDS: ReadonlySet<number> = new Set()

/** Rows of a task-row part, and the lingering tasks they keep as they were. */
export interface LingeringRows<R> {
  rows: R
  kept: ReadonlySet<number>
}

/**
 * A task-row part's rows: `now` — or, while a just-completed task lingers
 * (D19), the rows rebuilt from the tasks as they were before (`asWas`),
 * keeping that task in its place. `ids` lists a rows value's task ids.
 */
export function lingeringRows<R>(
  base: StatsBase,
  now: R,
  ids: (rows: R) => readonly number[],
  asWas: (tasks: PersistedTodoItem[]) => R,
  leaving: LeavingRows | undefined,
): LingeringRows<R> {
  if (!leaving || leaving.size === 0) return { rows: now, kept: NO_IDS }
  const tasks = applyFilter(statsFilter(base.screen), restoreLeaving(base.todos, leaving), base.lookups, base.ctx.today, base.markerSettings)
  const before = asWas(tasks)
  const inRows = new Set(ids(before))
  const kept = keptOf(leaving, new Set(ids(now)))
  for (const id of kept) if (!inRows.has(id)) kept.delete(id)
  return kept.size > 0 ? { rows: before, kept } : { rows: now, kept: NO_IDS }
}

/** A Needs follow-up group's task ids, in row order. */
export function followupRowIds(g: FollowupGroups): number[] {
  return [...g.late, ...g.today, ...g.upcoming]
}

/** Needs follow-up's rows (`followup.shown`, a lingering task kept in place). */
export function useFollowupRows(
  base: StatsBase,
  followup: ShownOfTotal<FollowupGroups>,
  lookAhead: LookAhead,
  leaving: LeavingRows | undefined,
): LingeringRows<FollowupGroups> {
  return useMemo(
    () => lingeringRows(base, followup.shown, followupRowIds, (tasks) => computeFollowupGroups(tasks, base.ctx, lookAhead), leaving),
    [base, followup, lookAhead, leaving],
  )
}

/** Today's Focus rows (`picks.focusIds`, a lingering completion kept in place). */
export function useTodayRows(base: StatsBase, picks: TodayPicks, leaving: LeavingRows | undefined): LingeringRows<number[]> {
  return useMemo(
    () => lingeringRows(base, picks.focusIds, (ids) => ids, (tasks) => openFocusIds(tasks), leaving),
    [base, picks, leaving],
  )
}

/** Stale tasks' rows (`stale.shown.ids`, a lingering task kept in place). */
export function useStaleRows(
  base: StatsBase,
  stale: ShownOfTotal<StaleTasks>,
  days: number,
  leaving: LeavingRows | undefined,
): LingeringRows<number[]> {
  return useMemo(
    () => lingeringRows(base, stale.shown.ids, (ids) => ids, (tasks) => computeStaleTasks(tasks, base.ctx, days).ids, leaving),
    [base, stale, days, leaving],
  )
}
