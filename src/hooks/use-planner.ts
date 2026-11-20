import { useEffect, useMemo, useRef } from 'react'
import type { PersistedTodoItem } from '../models'
import type { LayoutBody } from '../models/workspace-layout'
import { plannerWindowKey, usePlannerStore, usePlannerWindow } from '../stores/planner-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTodoStore } from '../stores/todo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { plannerView, type PlannerGroup, type PlannerView } from '../utils/planner'
import { countTabBadges, tabBadgeSummary, type TabBadgeCounts } from '../utils/tab-badges'
import { tasksDoneToday } from '../utils/tally'
import { layoutTabs } from '../utils/workspace-layout-queries'
import { useScreenTasks } from './use-glance-data'
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

/**
 * A Planner tab's data: the open tasks the screen filter shows
 * (`useScreenTasks`) placed for the tab's window
 * (`stores/planner-store`, by the open layout and the tab) in its hand order (`order`, the tab's view
 * state). With `linger`, a row completed here lingers, then folds, as a
 * list's does (`useLeavingRows`): the view is built with it as it was just
 * before, and `keptTodos` says what it shows meanwhile.
 */
export function usePlanner(tabId: string, order: readonly string[] | undefined, linger: boolean): PlannerData {
  const today = useToday()
  const screenTasks = useScreenTasks()
  const windowKey = plannerWindowKey(useWorkspaceStore((s) => s.working?.id), tabId)
  const { offset } = usePlannerWindow(windowKey)
  const ranges = useSettingsStore((s) => s.tabBadges)

  const shownIdsRef = useRef<ReadonlySet<number>>(NO_IDS)
  const completed = useLeavingRows((id) => shownIdsRef.current.has(id))
  const leaving = linger ? completed : NO_LEAVING

  const { view, kept } = useMemo(() => {
    const options = { today, offset, order }
    const built = plannerView(screenTasks, options)
    if (leaving.size === 0) return { view: built, kept: NO_IDS }
    const rows = (v: PlannerView<Task>) => new Set(groupIds([v.today, ...v.days, v.delayed, v.unplanned]))
    // The rows it would drop now (a completed task left the screen's tasks; a repeating one moved on).
    const dropped = keptOf(leaving, rows(built))
    if (dropped.size === 0) return { view: built, kept: NO_IDS }
    const before = [...dropped].flatMap((id) => leaving.get(id)?.before ?? [])
    return { view: plannerView([...screenTasks.filter((t) => !dropped.has(t.id)), ...before], options), kept: dropped }
  }, [screenTasks, today, offset, order, leaving])

  useEffect(() => { shownIdsRef.current = new Set(groupIds([view.today, ...view.days, view.delayed, view.unplanned])) })
  const keptTodos = useKeptTodos(kept, leaving)

  const badge = useMemo(() => {
    const counts = countTabBadges(view.tasks.filter((t) => !kept.has(t.id)), ranges, today)
    return { counts, summary: tabBadgeSummary(counts, ranges) }
  }, [view, kept, ranges, today])

  return { today, windowKey, offset, view, leaving, keptTodos, badge }
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
