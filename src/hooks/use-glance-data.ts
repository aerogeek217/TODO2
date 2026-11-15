import { useEffect, useMemo, useReducer } from 'react'
import type { PersistedTodoItem, Tag, TodoEvent, TodoPredicate } from '../models'
import { TREND_RANGES, type NumberConfig, type TrendRange, type TrendTabConfig } from '../models/glance-widgets'
import { emptyPredicate } from '../models/filter-predicate'
import { countReplayed, historyExactFrom, historyExactness, replayTasks, type HistoryExactness, type HistoryField, type TaskReplays } from '../services/stats/filter-history'
import { numberHistoryDays, numberIds, numberStages } from '../services/stats/number-count'
import { computePulse, type PulseCard } from '../services/stats/pulse'
import { pulseRuleFilter, type PulseRuleKey, type PulseTabConfig } from '../models/pulse-config'
import { statsFilter, type StatsContext } from '../services/stats/stats-context'
import { computeTrend, type TrendStats } from '../services/stats/trend'
import { usePersonStore } from '../stores/person-store'
import { useSettingsStore } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useStatusUpdateStore } from '../stores/status-update-store'
import { useSubtaskStore } from '../stores/subtask-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { trendFieldsWindow } from '../utils/trend-window'
import { todoNameLookups, type TodoNameLookups } from '../utils/filter'
import { admitsCompleted, countActiveFilters, predicateToCriteria, type FilterCriteria } from '../utils/filter-criteria'
import { applyFilter, matchesFilterWithLookups, readsText, type FilterSettings } from '../utils/filter-match'
import type { UrgentDueWithinDays } from '../utils/urgency'
import type { WeekStart } from '../utils/effective-date'
import { registerModuleReset } from '../utils/module-reset'
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

// Kept per (first) filter: a widget's count is matched once per change of what the lens hides, not on
// every render of every widget (each frame of a divider drag re-renders them all — cr34 G7).
const lensHidesMemo = sharedMemoByKey(function lensHides(
  first: FilterCriteria,
  hidden: PersistedTodoItem[],
  lookups: TodoNameLookups,
  ctx: StatsContext,
  settings: FilterSettings,
  ...rest: FilterCriteria[]
): number {
  const criteria = [first, ...rest]
  let n = 0
  for (const t of hidden) if (criteria.some((c) => matchesFilterWithLookups(c, t, lookups, ctx.today, settings))) n++
  return n
}, undefined, 2)

/** How many of the tasks the lens hides `filter` keeps (as a Number counts: open ones unless it admits completed). */
export function lensHidesFor(info: LensHidden | null, ...filters: TodoPredicate[]): number {
  if (!info) return 0
  const [first, ...rest] = filters.map((f) => numberCriteriaMemo(f))
  if (!first) return 0
  const lookups = lookupsFor(info.base, first, ...rest)
  return lensHidesMemo(first, info.hidden, lookups, info.base.ctx, info.base.markerSettings, ...rest)
}

/**
 * The tasks the screen filter shows, as a list and the calendar show
 * them: the shared base's `shown` (filtered once for every
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

/** What Created vs completed draws: its statistics, and from which day they are exact. */
export interface TrendData {
  stats: TrendStats
  /** The index of the first of the window's days from which every count is exact (`days.length`: none is); the days before it are drawn dimmed or dashed. */
  exactFrom: number
  /** What reads as it is now on the days before `exactFrom` (those days' tooltip). */
  approximate: HistoryField[]
  /** The screen filter narrows what it counts (its drills say so). */
  filtered: boolean
}

/** No filter: every task (a config without one). */
const EVERY_TASK: TodoPredicate = emptyPredicate()

/**
 * The input sets a memo keyed by a filter keeps: two — callers sharing a
 * filter (the constants `EVERY_TASK` and a share's `EVERY_OPEN`, or two
 * widgets with equal filters) may differ by their lens switch, and with one
 * set kept they evicted each other on every render (cr34 G8).
 */
const LENS_SLOTS = 2

/** Created vs completed's filter: its own, else one keeping every task (the same object each time, so the memos keyed on it hit). */
export function trendFilter(config: Pick<TrendTabConfig, 'filter'>): TodoPredicate {
  return config.filter ?? EVERY_TASK
}

/** Whether a filter narrows the tasks (completion aside). */
function narrows(f: FilterCriteria): boolean {
  return f.expression != null || countActiveFilters({ ...f, showCompleted: false }) > 0
}

// One memo per range, each keeping a set per filter (`sharedMemoByKey`): any
// number of these widgets on screen never evict one another, and two with the
// same filter and range compute once.
type FilteredTrend = (filter: FilterCriteria, screen: FilterCriteria, todos: Tasks, events: readonly TodoEvent[], ctx: StatsContext, lookups: TodoNameLookups, settings: FilterSettings) => TrendStats
const filteredTrendMemos = Object.fromEntries(TREND_RANGES.map((range): [TrendRange, FilteredTrend] => [range, sharedMemoByKey(function filteredTrend(
  filter: FilterCriteria,
  screen: FilterCriteria,
  todos: Tasks,
  events: readonly TodoEvent[],
  ctx: StatsContext,
  lookups: TodoNameLookups,
  settings: FilterSettings,
): TrendStats {
  const stages = [statsFilter(screen), { ...filter, showCompleted: true }]
  return computeTrend(todos, events, ctx, range, { stages, lookups, settings })
}, undefined, LENS_SLOTS)])) as Record<TrendRange, FilteredTrend>

const trendExactMemo = sharedMemoByKey(function trendExact(stats: TrendStats, filter: FilterCriteria | null, screen: FilterCriteria, historyLogSince: Date | null) {
  return filter ? historyExactFrom([statsFilter(screen), filter], stats.window.days, historyLogSince) : { from: 0, approximate: [] }
}, undefined, LENS_SLOTS)

const trendDataMemo = sharedMemoByKey(function trendData(stats: TrendStats, exact: { from: number; approximate: HistoryField[] }, filtered: boolean): TrendData {
  return { stats, exactFrom: exact.from, approximate: exact.approximate, filtered }
})

/**
 * Created vs completed's data (its filter and range): among the tasks the
 * top bar shows — the base's, without the lens while the widget ignores it.
 * While neither its filter nor the screen filter narrows, every task is
 * read as it is; else each task is replayed to
 * each day's end and counted while the filter and the screen filter kept it
 * then (`computeTrend`'s filter, a Number line's replay), the days the log
 * can't say exactly marked by `exactFrom`. `null` until the history has been read.
 */
export function useTrend(base: StatsBase, config: Pick<TrendTabConfig, 'range' | 'filter'>): TrendData | null {
  const range = config.range
  const filter = numberCriteriaMemo(trendFilter(config))
  const replay = base.filtered || narrows(filter)
  const events = useTrendEvents(replay ? trendFieldsWindow(range) : range)
  const historyLogSince = useSettingsStore((s) => s.historyLogSince)
  if (!events) return null
  const stats = replay
    ? filteredTrendMemos[range](filter, base.screen, base.todos, events, base.ctx, lookupsFor(base, base.screen, filter), base.markerSettings)
    : trendMemo(base.shown, events, base.ctx, range)
  const exact = trendExactMemo(stats, replay ? filter : null, base.screen, historyLogSince)
  return trendDataMemo(stats, exact, base.filtered)
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

/** How many filters' criteria are kept by their content (far more than a workspace shows). */
const CRITERIA_KEPT = 256

/**
 * A filter's criteria by its content. A layout read again from the database
 * (every layout switch) hands each widget a new, equal filter object: by
 * identity alone, every memo keyed on the criteria missed and each Number
 * replayed its history on every switch (cr34 M12). One criteria object per
 * distinct filter keeps them hitting.
 */
let criteriaByContent = new Map<string, FilterCriteria>()
registerModuleReset(() => { criteriaByContent = new Map() })

/** A stored filter is plain data; should a set or a map ever sit in one, its members are its content (JSON alone writes `{}` for both). */
function contentOf(_key: string, value: unknown): unknown {
  if (value instanceof Set) return { set: [...(value as Set<unknown>)] }
  if (value instanceof Map) return { map: [...(value as Map<unknown, unknown>)] }
  return value
}

// Each Number's parts are memoized per its filter (`sharedMemoByKey`): a
// dashboard of Numbers never evict one another.
const numberCriteriaMemo = sharedMemoByKey(function numberCriteria(filter: TodoPredicate): FilterCriteria {
  const content = JSON.stringify(filter, contentOf)
  const kept = criteriaByContent.get(content)
  if (kept) return kept
  const criteria = predicateToCriteria(filter)
  if (criteriaByContent.size >= CRITERIA_KEPT) {
    const oldest = criteriaByContent.keys().next()
    if (!oldest.done) criteriaByContent.delete(oldest.value)
  }
  criteriaByContent.set(content, criteria)
  return criteria
})

const numberIdsShownMemo = sharedMemoByKey(function numberIdsShown(filter: FilterCriteria, tasks: Tasks, lookups: TodoNameLookups, ctx: StatsContext, settings: FilterSettings) {
  return numberIds(filter, tasks, lookups, ctx.today, settings)
}, sameElements, LENS_SLOTS)
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
}, undefined, LENS_SLOTS)

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

/**
 * Every task replayed to each of the history days' ends: read by no filter,
 * so every Number's line on screen counts from this one replay
 * (`countReplayed`) — each replayed every task itself before (cr34 M12).
 */
export const historyReplayMemo = sharedMemo(function historyReplay(
  todos: Tasks,
  events: readonly TodoEvent[],
  days: Date[],
  assignedPeopleMap: TodoNameLookups['assignedPeopleMap'],
  assignedTagsMap: TodoNameLookups['assignedTagsMap'],
): TaskReplays {
  return replayTasks(todos, events, days, { assignedPeopleMap, assignedTagsMap })
})

const numberHistoryMemo = sharedMemoByKey(function numberHistory(
  filter: FilterCriteria,
  screen: FilterCriteria,
  replays: TaskReplays,
  days: Date[],
  lookups: TodoNameLookups,
  settings: FilterSettings,
  historyLogSince: Date | null,
): NumberHistory {
  const stages = numberStages(screen, filter)
  const firstDay = days[0] ?? new Date(0)
  return {
    days,
    series: countReplayed(stages, replays, { lookups, settings }),
    exactness: historyExactness(stages, firstDay, historyLogSince),
  }
}, undefined, LENS_SLOTS)

/** Runs `run` once the browser is idle (soon, where it can't say); returns what cancels it. */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(run, 0)
  return () => clearTimeout(id)
}

/** The longest a line waits for an idle moment before it is computed anyway. */
const IDLE_TIMEOUT_MS = 300

/**
 * A history line computed off the render that asks for it (cr34 M12; the
 * user's answer 13: a Number's line and its change may update a moment after
 * a write). `now`: the line when the memos hold it for the current inputs;
 * `last`: the line this filter had before a write or a change of the screen
 * filter — only those (`lineBeforeWrite`); `compute`: computes and keeps it.
 *
 * With `now`, that. Else, while there is a `last` to show, `last` — and the
 * current one is computed once the browser is idle, then drawn; a newer
 * request before that replaces it, so a run of writes or keystrokes computes
 * once. With nothing to show (the filter's first line, or anything else
 * changed: the day, a setting, when the log began), it is computed here.
 */
export function useOffRender<T>(now: T | undefined, last: T | undefined, compute: () => T): T {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const pending = now === undefined && last != null
  useEffect(() => {
    if (!pending) return undefined
    return whenIdle(() => {
      compute()
      redraw()
    })
  })
  return now ?? last ?? compute()
}

/**
 * Whether a kept line differs from the one asked for only by what a write
 * changes: `kept` and `asked` are the memo's inputs after the screen filter
 * and the replay — the days, the lookups (which a write to a task's people,
 * tags or text replaces), the settings, when the log began.
 */
export function lineBeforeWrite(kept: readonly unknown[], asked: readonly [Date[], TodoNameLookups, FilterSettings, Date | null]): boolean {
  const [days, , settings, since] = asked
  return kept[0] === days && kept[2] === settings && kept[3] === since
}

/**
 * A Number's 14-day line (`filter-history`): its filter under its screen
 * filter, counted over every task replayed to each day's end; `null` until
 * the history has been read. After a change (a task write, the screen
 * filter) it shows the line it had until the new one is computed, a moment
 * later (`useOffRender`).
 */
export function useNumberHistory(base: StatsBase, count: NumberCount): NumberHistory | null {
  const events = useTrendEvents('history')
  const historyLogSince = useSettingsStore((s) => s.historyLogSince)
  const days = historyDaysMemo(base.ctx.today.getTime())
  const lookups = lookupsFor(base, count.screen, count.filter)
  const { todos, markerSettings } = base
  const { filter, screen } = count
  const replayed = events ? historyReplayMemo.peek(todos, events, days, lookups.assignedPeopleMap, lookups.assignedTagsMap) : undefined
  const now = replayed ? numberHistoryMemo.peek(filter, screen, replayed, days, lookups, markerSettings, historyLogSince) : undefined
  // The line it had while only the tasks, their events or names, or the screen filter have changed since.
  const kept = events ? numberHistoryMemo.last(filter) : undefined
  const last = kept && lineBeforeWrite(kept.deps.slice(2), [days, lookups, markerSettings, historyLogSince]) ? kept.value : undefined
  // No history read yet: nothing kept, nothing to show, and `compute` says so (`null`).
  return useOffRender<NumberHistory | null>(now, last, () => {
    if (!events) return null
    const replays = historyReplayMemo(todos, events, days, lookups.assignedPeopleMap, lookups.assignedTagsMap)
    return numberHistoryMemo(filter, screen, replays, days, lookups, markerSettings, historyLogSince)
  })
}

// ── Project pulse (D25 L) ───────────────────────────────────────────────────

const pulseMemo = sharedMemo((
  shown: Tasks,
  tags: readonly Tag[],
  ctx: StatsContext,
  tagIds: readonly number[],
  staleAfterDays: number,
  late: FilterCriteria | null,
  stale: FilterCriteria | null,
  lookups: TodoNameLookups | null,
  settings: FilterSettings,
): PulseCard[] => {
  // A rule with a filter of its own (G5) matches through it, as a chart's filter does; else its built-in default.
  const match = (c: FilterCriteria | null) => (c && lookups ? (t: PersistedTodoItem) => matchesFilterWithLookups(c, t, lookups, ctx.today, settings) : undefined)
  return computePulse(shown, tags, ctx, tagIds, staleAfterDays, { late: match(late), stale: match(stale) })
}, OPTION_SLOTS)
/**
 * Project pulse's cards over the screen-filtered tasks, a card per picked
 * tag; late and stale by its rules (G5): a rule's filter over a card's open
 * tasks (the lookups only when one has a filter, so a write no rule reads
 * recomputes nothing), else its default.
 */
export function usePulse(base: StatsBase, config: Pick<PulseTabConfig, 'tagIds' | PulseRuleKey>): PulseCard[] {
  const tags = useTagStore((s) => s.tags)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const lateFilter = pulseRuleFilter(config, 'late')
  const staleFilter = pulseRuleFilter(config, 'stale')
  const late = lateFilter ? numberCriteriaMemo(lateFilter) : null
  const stale = staleFilter ? numberCriteriaMemo(staleFilter) : null
  const criteria = [late, stale].filter((c): c is FilterCriteria => c != null)
  const lookups = criteria.length > 0 ? lookupsFor(base, ...criteria) : null
  return pulseMemo(base.shown, tags, base.ctx, config.tagIds, staleAfterDays, late, stale, lookups, base.markerSettings)
}

