import { useMemo } from 'react'
import type { PersistedTodoItem, Tag, TodoEvent, TodoPredicate } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
import { TREND_RANGES, type NumberConfig, type TrendRange } from '../models/glance-widgets'
import { computeEisenhowerSummary, eisenhowerSourceTasks, type EisenhowerSummary } from '../services/stats/eisenhower-summary'
import { filterHistory, historyExactness, type HistoryExactness } from '../services/stats/filter-history'
import { numberHistoryDays, numberIds, numberStages } from '../services/stats/number-count'
import { computePulse, type PulseCard } from '../services/stats/pulse'
import { statsFilter, type StatsContext } from '../services/stats/stats-context'
import { computeTrend, type TrendStats } from '../services/stats/trend'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { usePersonStore } from '../stores/person-store'
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
import { admitsCompleted, countActiveFilters, predicateToCriteria, type FilterCriteria } from '../utils/filter-criteria'
import { applyFilter, matchesFilterWithLookups, readsText, type FilterSettings } from '../utils/filter-match'
import type { UrgentDueWithinDays } from '../utils/urgency'
import type { WeekStart } from '../utils/effective-date'
import { sameElements, sharedMemo, sharedMemoByKey } from '../utils/shared-memo'
import { useToday } from './use-today'
import { useTrendEvents } from './use-trend-events'
import { useWidgetScreenFilter } from './use-widget-lens'

/**
 * The glance widgets' data, a hook per part over one
 * shared base: the screen-filtered tasks are filtered once for every widget
 * on screen, and each statistic computed once per set of inputs, however
 * many widgets show it (`utils/shared-memo` — each part's inputs are store
 * values or other shared parts, so they compare by identity). A memo keeps
 * one input set, or one per choice of the option its callers differ by
 * (`OPTION_SLOTS`), so stale generations of the task arrays aren't held. The
 * statistics themselves are the pure `services/stats/*` functions.
 */

/**
 * Input sets kept by a memo whose callers differ by a free choice (Project
 * pulse's tag picks, one per tab): a few tabs on screen each hit.
 */
const OPTION_SLOTS = 8

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
  /** The screen filter (with the lens, unless the widget ignores it: `useWidgetScreenFilter`). */
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
// Two sets: with the top bar's lens and without it (a widget that ignores it, G3).
const shownMemo = sharedMemo((
  screen: FilterCriteria,
  todos: readonly PersistedTodoItem[],
  lookups: TodoNameLookups,
  ctx: StatsContext,
  settings: FilterSettings,
) => applyFilter(statsFilter(screen), todos, lookups, ctx.today, settings), 2, sameElements)

const byIdMemo = sharedMemo((todos: readonly PersistedTodoItem[]) => new Map(todos.map((t) => [t.id, t])))

/**
 * The shared base: the context and the screen-filtered tasks, the same
 * objects in every widget — the top bar's lens left out while the widget
 * being drawn ignores it (`WidgetLensContext`), or as `ignoreLens` says.
 */
export function useStatsBase(ignoreLens?: boolean): StatsBase {
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  const statuses = useStatusStore((s) => s.statuses)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statusUpdatesByTodo = useStatusUpdateStore((s) => s.byTodo)
  const subtasksByTodo = useSubtaskStore((s) => s.byTodo)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const screen = useWidgetScreenFilter(ignoreLens).filters

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

const screenTasksMemo = sharedMemo((shown: PersistedTodoItem[], withCompleted: boolean): PersistedTodoItem[] => (
  withCompleted ? shown : shown.filter((t) => !t.isCompleted)
), 2)

const hiddenMemo = sharedMemo(function lensHidden(unlensed: PersistedTodoItem[], lensed: PersistedTodoItem[]): PersistedTodoItem[] {
  const kept = new Set(lensed)
  return unlensed.filter((t) => !kept.has(t))
})

/** What the top bar's lens hides from the widgets: the tasks shown without it but not with it (completed included), and the base with it. */
export interface LensHidden {
  hidden: PersistedTodoItem[]
  /** The shared base with the lens (its lookups and context, for matching the hidden tasks). */
  base: StatsBase
}

/**
 * What the top bar's lens hides (`LensHidden`), whether or not the widget
 * being drawn ignores it — its switch's `−N` counts its own share of
 * these; `null` while no lens applies.
 */
export function useLensHidden(): LensHidden | null {
  const lensed = useStatsBase(false)
  const unlensed = useStatsBase(true)
  const hidden = hiddenMemo(unlensed.shown, lensed.shown)
  return useMemo(() => (lensed.screen.lens == null ? null : { hidden, base: lensed }), [hidden, lensed])
}

/** How many of the tasks the lens hides `keep` keeps (0 with no lens). */
export function lensHidesWhere(info: LensHidden | null, keep: (t: PersistedTodoItem, base: StatsBase) => boolean): number {
  if (!info) return 0
  let n = 0
  for (const t of info.hidden) if (keep(t, info.base)) n++
  return n
}

/** How many of the tasks the lens hides `filter` keeps (as a Number counts: open ones unless it admits completed). */
export function lensHidesFor(info: LensHidden | null, ...filters: TodoPredicate[]): number {
  if (!info || filters.length === 0) return 0
  const criteria = filters.map((f) => numberCriteriaMemo(f))
  const lookups = lookupsFor(info.base, ...criteria)
  return lensHidesWhere(info, (t, base) => criteria.some((c) => matchesFilterWithLookups(c, t, lookups, base.ctx.today, base.markerSettings)))
}

/**
 * The tasks the screen filter shows, as a list, the calendar and the
 * Eisenhower show them: the shared base's `shown` (filtered once for every
 * widget on screen), its completed tasks kept only while the screen filter
 * lets them through (`admitsCompleted`: Show completed, or a Completed
 * range) — the same tasks `applyFilter(screen, …)` keeps.
 */
export function useScreenTasks(): PersistedTodoItem[] {
  const base = useStatsBase()
  return screenTasksMemo(base.shown, admitsCompleted(base.screen))
}

// ── The parts ───────────────────────────────────────────────────────────────

type Tasks = readonly PersistedTodoItem[]

const trendMemo = sharedMemo((shown: Tasks, events: readonly TodoEvent[], ctx: StatsContext, range: TrendRange): TrendStats => (
  computeTrend(shown, events, ctx, range)
), TREND_RANGES.length)
/** Created vs completed over `range`; `null` until the history has been read. */
export function useTrendStats(base: StatsBase, range: TrendRange): TrendStats | null {
  const events = useTrendEvents(range)
  return events ? trendMemo(base.shown, events, base.ctx, range) : null
}

// ── A Number (D26 P5) ──────────────────────────────────────────────────────

const NO_TEXT = new Map<number, never[]>()

/**
 * The lookups a filter that reads no text needs (people, tags, statuses):
 * a status update or subtask write, which changes the full lookups,
 * leaves these, so a Number not searching text keeps its count.
 */
const idLookupsMemo = sharedMemo(function idLookups(
  assignedPeopleMap: StatsContext['assignedPeopleMap'],
  assignedTagsMap: StatsContext['assignedTagsMap'],
  statuses: StatsContext['statuses'],
) {
  return todoNameLookups({ assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo: NO_TEXT, subtasksByTodo: NO_TEXT })
})

/** The lookups `filters` need: the full ones when one reads text, else the id ones (`idLookupsMemo`). */
export function lookupsFor(base: StatsBase, ...filters: FilterCriteria[]): TodoNameLookups {
  return filters.some(readsText) ? base.lookups : idLookupsMemo(base.ctx.assignedPeopleMap, base.ctx.assignedTagsMap, base.ctx.statuses)
}

// Each Number's parts are memoized per its filter (`sharedMemoByKey`): a
// dashboard of Numbers never evict one another.
const numberCriteriaMemo = sharedMemoByKey(function numberCriteria(filter: TodoPredicate): FilterCriteria {
  return predicateToCriteria(filter)
})

const numberIdsShownMemo = sharedMemoByKey(function numberIdsShown(filter: FilterCriteria, tasks: Tasks, lookups: TodoNameLookups, ctx: StatsContext, settings: FilterSettings) {
  return numberIds(filter, tasks, lookups, ctx.today, settings)
}, sameElements)
const numberIdsTotalMemo = sharedMemoByKey(function numberIdsTotal(filter: FilterCriteria, tasks: Tasks, lookups: TodoNameLookups, ctx: StatsContext, settings: FilterSettings) {
  return numberIds(filter, tasks, lookups, ctx.today, settings)
}, sameElements)

/** What a Number counts, under the screen filter it follows. */
export interface NumberCount {
  /** Its filter (`NumberConfig.filter`) as criteria. */
  filter: FilterCriteria
  /** The screen filter it counts under: the base's (without the lens when the widget ignores it). */
  screen: FilterCriteria
  /** That screen filter narrows the tasks. */
  filtered: boolean
  /** The tasks it keeps among the ones the top bar shows, in dialog order (the count), and among every task (the `of N`). */
  ids: ShownOfTotal<number[]>
}

const numberCountMemo = sharedMemoByKey(function numberCount(filter: FilterCriteria, screen: FilterCriteria, shown: number[], total: number[]): NumberCount {
  return { filter, screen, filtered: countActiveFilters({ ...screen, showCompleted: false }) > 0, ids: { shown, total } }
})

/**
 * A Number's count (`services/stats/number-count`): its filter over the
 * tasks the top bar shows — the base's, which leaves the lens out while
 * the widget ignores it (its lens switch, G3) — and over every task.
 */
export function useNumberCount(base: StatsBase, config: Pick<NumberConfig, 'filter'>): NumberCount {
  return numberCountOf(base, config)
}

/** `useNumberCount` outside a hook's order (no hook inside): a group Number counts each of its items with it (D26 P6). */
export function numberCountOf(base: StatsBase, config: Pick<NumberConfig, 'filter'>): NumberCount {
  const filter = numberCriteriaMemo(config.filter)
  const screen = base.screen
  const lookups = lookupsFor(base, filter)
  const shown = numberIdsShownMemo(filter, base.shown, lookups, base.ctx, base.markerSettings)
  const total = numberIdsTotalMemo(filter, base.todos, lookups, base.ctx, base.markerSettings)
  return numberCountMemo(filter, screen, shown, total)
}

/** A Number's line: what it counted at the end of each of the last 14 days (today last), and whether that is exact. */
export interface NumberHistory {
  days: Date[]
  series: number[]
  exactness: HistoryExactness
}

const historyDaysMemo = sharedMemo(function historyDays(todayMs: number) {
  return numberHistoryDays(new Date(todayMs))
})

const numberHistoryMemo = sharedMemoByKey(function numberHistory(
  filter: FilterCriteria,
  screen: FilterCriteria,
  todos: Tasks,
  events: readonly TodoEvent[],
  days: Date[],
  lookups: TodoNameLookups,
  settings: FilterSettings,
  historyLogSince: Date | null,
): NumberHistory {
  const stages = numberStages(screen, filter)
  const firstDay = days[0] ?? new Date(0)
  return {
    days,
    series: filterHistory(stages, todos, events, days, { lookups, settings }),
    exactness: historyExactness(stages, firstDay, historyLogSince),
  }
})

/**
 * A Number's 14-day line (`filter-history`): its filter under its screen
 * filter, every task replayed to each day's end; `null` until the history
 * has been read.
 */
export function useNumberHistory(base: StatsBase, count: NumberCount): NumberHistory | null {
  const events = useTrendEvents('history')
  const historyLogSince = useSettingsStore((s) => s.historyLogSince)
  const days = historyDaysMemo(base.ctx.today.getTime())
  if (!events) return null
  return numberHistoryMemo(count.filter, count.screen, base.todos, events, days, lookupsFor(base, count.screen, count.filter), base.markerSettings, historyLogSince)
}

// ── Project pulse (D25 L) ───────────────────────────────────────────────────

const pulseMemo = sharedMemo((shown: Tasks, tags: readonly Tag[], ctx: StatsContext, tagIds: readonly number[], staleAfterDays: number): PulseCard[] => (
  computePulse(shown, tags, ctx, tagIds, staleAfterDays)
), OPTION_SLOTS)
/** Project pulse's cards over the screen-filtered tasks, a card per picked tag. */
export function usePulse(base: StatsBase, tagIds: readonly number[]): PulseCard[] {
  const tags = useTagStore((s) => s.tags)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  return pulseMemo(base.shown, tags, base.ctx, tagIds, staleAfterDays)
}

// ── The Eisenhower's counts (its small and medium faces) ────────────────────

/** The Eisenhower settings as its small and medium faces count with them. */
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
 * The Eisenhower's counts (its small and medium faces): its own list's members (its unsaved
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
