import { useEffect, useMemo, useRef } from 'react'
import type { PersistedTodoItem, TodoPredicate } from '../models'
import type { LayoutBody, PlannerTab, PlannerUnplannedSort } from '../models/workspace-layout'
import { plannerWindowKey, usePlannerStore, usePlannerWindow } from '../stores/planner-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTodoStore } from '../stores/todo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { listSortComparator } from '../services/list-sections'
import { resetPlannerPlan } from '../services/planner-drop'
import { hasFilterClause } from '../utils/filter-clauses'
import type { TodoNameLookups } from '../utils/filter'
import { predicateToCriteria } from '../utils/filter-criteria'
import { matchesFilterWithLookups, type FilterSettings } from '../utils/filter-match'
import {
  plannerResetCounts,
  plannerResetWeekLabel,
  plannerView,
  type PlannerGroup,
  type PlannerJoins,
  type PlannerResetScope,
  type PlannerTask,
  type PlannerView,
} from '../utils/planner'
import { countTabBadges, tabBadgeSummary, type TabBadgeCounts } from '../utils/tab-badges'
import { tasksDoneToday } from '../utils/tally'
import { layoutTabs } from '../utils/workspace-layout-queries'
import { useScreenTasks, useStatsBase } from './use-glance-data'
import { keptOf, useKeptTodos, useLeavingRows, type LeavingRows } from './use-leaving-rows'
import { useToday } from './use-today'

type Task = PersistedTodoItem

/** What a Planner draws (`components/workspace/planner`). */
export interface PlannerData {
  today: Date
  /** The key of the tab's window in `stores/planner-store`: its layout and tab (`plannerWindowKey`). */
  windowKey: string
  /** The window's offset from today, days (`stores/planner-store`). */
  offset: number
  /** Today, the days ahead, the Delayed and Unplanned trays, and the tiles (`utils/planner.plannerView`). */
  view: PlannerView<Task>
  /** The rows lingering after a completion (`useLeavingRows`), by task id. */
  leaving: LeavingRows
  /** What each lingering row shows: the task as it is now (completed); null with none. */
  keptTodos: ReadonlyMap<number, Task> | null
  /** The due / follow-up counts of the tasks it holds, in Settings' ranges, and those in words. */
  badge: { counts: TabBadgeCounts; summary: string[] }
}

const NO_IDS: ReadonlySet<number> = new Set()
const NO_LEAVING: LeavingRows = new Map()

const groupIds = (groups: ReadonlyArray<PlannerGroup<Task>>): number[] => groups.flatMap((g) => g.tasks.map((t) => t.id))

/** A task the rules hand back is one of the todo store's (the matcher reads its id, title and names). */
const isStoredTask = (task: PlannerTask): task is Task => typeof (task as Partial<Task>).id === 'number' && typeof (task as Partial<Task>).title === 'string'

const JOINS_NOTHING: PlannerJoins = () => false

/**
 * The Unplanned filter `filter` as the rules read it (`PlannerJoins`): the
 * app's predicate matcher — the one a list's filter goes through
 * (`matchesFilterWithLookups`, names from `lookups`) — over the tasks the
 * Planner holds, which the screen filter already narrowed. An empty filter
 * joins nothing: Unplanned stays empty.
 */
function plannerUnplannedJoins(filter: TodoPredicate, lookups: TodoNameLookups, today: Date, settings: FilterSettings): PlannerJoins {
  if (!hasFilterClause(filter) && !filter.expression) return JOINS_NOTHING
  const criteria = predicateToCriteria(filter)
  return (task) => isStoredTask(task) && matchesFilterWithLookups(criteria, task, lookups, today, settings)
}

/**
 * The rules' Unplanned filter for a Planner whose config holds `filter`:
 * none while it holds none (Focus, the rules' own default), else
 * `plannerUnplannedJoins` over the shared base's names and settings.
 */
function useUnplannedJoins(filter: TodoPredicate | undefined): PlannerJoins | undefined {
  const { lookups, ctx, markerSettings } = useStatsBase()
  return useMemo(
    () => (filter ? plannerUnplannedJoins(filter, lookups, ctx.today, markerSettings) : undefined),
    [filter, lookups, ctx.today, markerSettings],
  )
}

/**
 * The Unplanned tray's order for a Planner whose config sorts it `sort` (a
 * list's sort and direction, `listSortComparator`, over the shared base's
 * day, urgent range, people and statuses); none for manual or no sort: the
 * hand order.
 */
function useUnplannedCompare(sort: PlannerUnplannedSort | undefined): ((a: Task, b: Task) => number) | undefined {
  const { ctx } = useStatsBase()
  const by = sort?.by
  const direction = sort?.direction
  return useMemo(() => (by == null || by === 'manual' ? undefined : listSortComparator(by, {
    today: ctx.today,
    urgentRange: ctx.urgentRange,
    direction,
    assignedPeopleMap: ctx.assignedPeopleMap,
    statuses: ctx.statuses,
  })), [by, direction, ctx])
}

/**
 * A Planner tab's data: the open tasks the screen filter shows
 * (`useScreenTasks`) placed for the tab's window
 * (`stores/planner-store`, by the open layout and the tab) in its hand order (`order`, the tab's view
 * state), an open task with no day joining Unplanned when it matches the
 * tab's Unplanned filter (`config.unplanned`; absent: Focus), Unplanned
 * sorted as the tab sorts it (`config.unplannedSort`) — `tab` as
 * drawn, its editor's unsaved filter included. With `linger`, a row completed here lingers, then folds, as a
 * list's does (`useLeavingRows`): the view is built with it as it was just
 * before, and `keptTodos` says what it shows meanwhile.
 *
 * It also **reports Reset plan** for the tab (`planner-store.resets`, by
 * `windowKey`): the counts each scope would clear, over the view without
 * the lingering rows, and the action — so the top line's button and the
 * cell's ⋯ menu read them from the store instead of building the view again.
 * Written only when a count changes; removed when the widget unmounts.
 */
export function usePlanner(tab: PlannerTab, linger: boolean): PlannerData {
  const tabId = tab.id
  const order = tab.viewState?.order
  const today = useToday()
  const screenTasks = useScreenTasks()
  const joins = useUnplannedJoins(tab.config.unplanned)
  const unplannedCompare = useUnplannedCompare(tab.config.unplannedSort)
  const windowKey = plannerWindowKey(useWorkspaceStore((s) => s.working?.id), tabId)
  const { offset } = usePlannerWindow(windowKey)
  const ranges = useSettingsStore((s) => s.tabBadges)

  const shownIdsRef = useRef<ReadonlySet<number>>(NO_IDS)
  const completed = useLeavingRows((id) => shownIdsRef.current.has(id))
  const leaving = linger ? completed : NO_LEAVING

  const { view, kept, current } = useMemo(() => {
    const options = { today, offset, order, joins, unplannedCompare }
    const built = plannerView(screenTasks, options)
    if (leaving.size === 0) return { view: built, kept: NO_IDS, current: built }
    const rows = (v: PlannerView<Task>) => new Set(groupIds([v.today, ...v.days, v.delayed, v.unplanned]))
    // The rows it would drop now (a completed task left the screen's tasks; a repeating one moved on).
    const dropped = keptOf(leaving, rows(built))
    if (dropped.size === 0) return { view: built, kept: NO_IDS, current: built }
    const before = [...dropped].flatMap((id) => leaving.get(id)?.before ?? [])
    return { view: plannerView([...screenTasks.filter((t) => !dropped.has(t.id)), ...before], options), kept: dropped, current: built }
  }, [screenTasks, today, offset, order, joins, unplannedCompare, leaving])
  usePlannerResetReport(windowKey, current)

  useEffect(() => { shownIdsRef.current = new Set(groupIds([view.today, ...view.days, view.delayed, view.unplanned])) })
  const keptTodos = useKeptTodos(kept, leaving)

  const badge = useMemo(() => {
    const counts = countTabBadges(view.tasks.filter((t) => !kept.has(t.id)), ranges, today)
    return { counts, summary: tabBadgeSummary(counts, ranges) }
  }, [view, kept, ranges, today])

  return { today, windowKey, offset, view, leaving, keptTodos, badge }
}

/**
 * Reports what Reset plan would do in `view` — the Planner as it is, no
 * lingering row — to `planner-store.resets[windowKey]`: its counts and the
 * week scope's name (a new report only when one of them changes) and its
 * action, which reads the view of the moment it is called. The report goes
 * when the widget unmounts.
 */
function usePlannerResetReport(windowKey: string, view: PlannerView<Task>): void {
  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view })
  const counts = useMemo(() => plannerResetCounts(view), [view])
  const { week, today, delayed } = counts
  const weekLabel = plannerResetWeekLabel(view.window)
  useEffect(() => {
    const run = (scope: PlannerResetScope) => { void resetPlannerPlan(viewRef.current, scope) }
    usePlannerStore.getState().setReset(windowKey, { counts: { week, today, delayed }, week: weekLabel, run })
  }, [windowKey, week, today, delayed, weekLabel])
  useEffect(() => () => usePlannerStore.getState().setReset(windowKey, null), [windowKey])
}

/**
 * Keeps `stores/planner-store`'s windows to the Planner tabs the open layout
 * has (the workspace page calls it with `working`): a tab closed, or changed
 * to another kind — by a menu, an undo, the layout edit mode — loses its
 * window, so one that is a Planner again starts on this week.
 */
export function usePlannerWindowsOf(layout: (LayoutBody & { id: number }) | null): void {
  const layoutId = layout?.id
  const tabIds = useMemo(() => (layout ? layoutTabs(layout).filter((t) => t.kind === 'planner').map((t) => t.id).join('\n') : null), [layout])
  useEffect(() => {
    if (layoutId == null || tabIds == null) return
    usePlannerStore.getState().keep(layoutId, tabIds === '' ? [] : tabIds.split('\n'))
  }, [layoutId, tabIds])
}

/** The tasks completed today, the last one first (the tally's count, `utils/tally`): the Planner's `N done` line. */
export function useTasksDoneToday(): Task[] {
  const today = useToday()
  const todos = useTodoStore((s) => s.todos)
  return useMemo(() => tasksDoneToday(todos, today), [todos, today])
}
