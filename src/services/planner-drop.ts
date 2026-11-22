import type { PersistedTodoItem } from '../models'
import type { PlannerDragPreview } from '../stores/planner-store'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore } from '../stores/undo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { startOfDay } from '../utils/date'
import { shortTitle } from '../utils/text'
import {
  plannerClearLeaves,
  plannerDayLabel,
  plannerDropWrite,
  plannerFixClearsPlan,
  plannerHasPlan,
  plannerMovePlan,
  plannerPlacement,
  plannerResetTasks,
  plannerResetWeekLabel,
  plannerShows,
  plannerSnoozeDay,
  plannerUnplanDelayed,
  type PlannerDropPosition,
  type PlannerFix,
  type PlannerMovePlan,
  type PlannerResetScope,
  type PlannerSpan,
  type PlannerTarget,
  type PlannerView,
} from '../utils/planner'
import { getTab } from '../utils/workspace-layout-queries'
import type { PlannerDropRequest } from '../utils/task-dnd'

/**
 * The Planner's writes — the only place a Planner drop, Plan for day ›,
 * Snooze, Unplan, Unplan all Delayed, Reset plan or a conflict's fix writes
 * from. Everything but a fix's date move changes **the plan only**
 * (`todo-store.setPlans`: both plan fields in one task write, one undo step,
 * no stamp, no history event) — never a due date or a follow-up; what to
 * write is `utils/planner`'s decision (`plannerDrop`).
 */

/** A task moved in a Planner: a row dropped on a tile or in a group, or a menu's move. */
interface PlannerMove {
  todoId: number
  target: PlannerTarget
  /** The Planner's window as it shows: what the task's placement is read against. */
  window: PlannerSpan
  /** Dropped into a group: where (`utils/planner.PlannerDropPosition`). Null: a tile, the menu. */
  position?: PlannerDropPosition | null
}

/** The hand order the Planner `tabId` of the open layout stores (none: no such tab, or it never had one; or no tab — a menu outside a Planner). */
function storedOrder(tabId: string | null): readonly string[] {
  if (tabId == null) return []
  const layout = useWorkspaceStore.getState().working
  const tab = layout ? getTab(layout, tabId) : undefined
  return tab?.kind === 'planner' ? tab.viewState?.order ?? [] : []
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((uid, i) => uid === b[i])

/**
 * What `move` does now in the Planner `tabId`, for the task as the store
 * holds it (`utils/planner.plannerMovePlan`); null when the task is gone.
 * A place is merged into the tab's stored hand order: the tasks it doesn't
 * show now keep theirs, and only those the todo store no longer holds
 * (deleted, purged) leave it.
 */
function planPlannerMove(tabId: string | null, move: PlannerMove): PlannerMovePlan | null {
  const todos = useTodoStore.getState().todos
  const todo = todos.find((t) => t.id === move.todoId)
  if (!todo) return null
  if (!move.position) return plannerMovePlan(todo, move.window, move.target)
  const uids = new Set(todos.map((t) => t.uid))
  return plannerMovePlan(todo, move.window, move.target, move.position, { order: storedOrder(tabId), exists: (uid) => uids.has(uid) })
}

/**
 * The plan for a task dropped on a Planner's tile or group (the
 * dispatcher's `PlannerDropRequest`). The place in a group is the one the
 * Planner's drag preview shows (`stores/planner-store`'s `drag`, which the
 * widget sets as the pointer moves) — only while it is of that very group:
 * with none, the drop still writes its plan and the hand order stays.
 */
export function planPlannerDrop(request: PlannerDropRequest, preview: PlannerDragPreview | null): PlannerMovePlan | null {
  const { group } = request
  const index = group && preview?.tabId === request.tabId && preview.over === 'group' && preview.key === group.key ? preview.index : null
  return planPlannerMove(request.tabId, {
    todoId: request.todo.id,
    target: request.target,
    window: request.window,
    position: group && index != null ? { rows: group.rows, shown: group.shown, index } : null,
  })
}

/**
 * Makes a planned move in the Planner `tabId`. The hand order first (the
 * tab's view state, `order` — the stored one with the row's new place
 * merged in: saved at once, no undo step, as a list's manual order), then
 * the one task write: its plan state (`plannerDropWrite` → `setPlan`: a
 * planned day, held in Unplanned, or cleared — one undo step, no stamp). A
 * refused drop, and one that changes nothing, write no task. A plan that
 * takes the task **out of view** (`plan.hidden`: a day the Planner shows it
 * on nowhere — a Snooze past the window with no real date inside it) shows
 * the snackbar, named for the day, with its Undo (`Planned for Fri, Nov
 * 27`): nothing leaves the Planner silently — in a Planner only (`tabId`;
 * outside one there is no Planner to leave). A plan write that fails
 * (`setPlan` says so and tells the user) takes the hand order back to what
 * the tab stored before, so the row doesn't keep a place among the rows of
 * a group it never reached.
 */
export async function applyPlannerMove(tabId: string | null, todoId: number, plan: PlannerMovePlan): Promise<void> {
  const { drop, order, hidden } = plan
  const before = order ? storedOrder(tabId) : null
  if (order && tabId != null) void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { order })
  const write = plannerDropWrite(drop)
  if (write === undefined) return
  const saved = hidden && tabId != null
    ? await useTodoStore.getState().setPlan([todoId], write, `Planned for ${plannerDayLabel(hidden)}`, true)
    : await useTodoStore.getState().setPlan([todoId], write)
  // Only while the tab still stores this move's order: a later drop's stays.
  if (!saved && order && before && tabId != null && sameOrder(storedOrder(tabId), order)) {
    void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { order: [...before] })
  }
}

/**
 * Plans and makes `move` (Plan for day ›, Unplan); resolves once it is
 * written. `tabId` null: a task menu, the task editor or the review card
 * outside a Planner, read against the window of this week (no hand order
 * to keep). A menu's day is a `pick` (`PlannerTarget`): planned outright.
 */
export function movePlannerTask(tabId: string | null, move: PlannerMove): Promise<void> {
  const plan = planPlannerMove(tabId, move)
  return plan ? applyPlannerMove(tabId, move.todoId, plan) : Promise.resolve()
}

/**
 * **Snooze**: plans the task for the day after the day it sits on, never
 * earlier than tomorrow (a Delayed or Unplanned row: tomorrow) — through
 * the drop rule, so a task landing on its natural day loses its plan.
 */
export function snoozePlannerTask(tabId: string, todoId: number, window: PlannerSpan): Promise<void> {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
  if (!todo) return Promise.resolve()
  const day = plannerSnoozeDay(plannerPlacement(todo, window), window.today)
  return movePlannerTask(tabId, { todoId, target: { kind: 'day', day }, window })
}

/**
 * **Today** (an Unplanned row's button, in Snooze's place): the drop on
 * today — planned for today, or, when today is its own date's day, its plan
 * state cleared — so the row lands in Today.
 */
export function planPlannerTaskToday(tabId: string, todoId: number, window: PlannerSpan): Promise<void> {
  return movePlannerTask(tabId, { todoId, target: { kind: 'day', day: window.today }, window })
}

/** **Unplan**: the Unplanned tray's drop for one row — held there, or (a Focus task with no date in the window) its plan cleared. */
export function unplanPlannerTask(tabId: string, todoId: number, window: PlannerSpan): Promise<void> {
  return movePlannerTask(tabId, { todoId, target: { kind: 'unplanned' }, window })
}

/**
 * **Clear plan**: the task's plan state cleared (`setPlan(…, null)`: one
 * undo step, no stamp) — it goes back to where its own dates put it. When
 * that takes it out of the Planner (`plannerClearLeaves`: no date in the
 * window, not in Focus) — **Remove from Planner** — the snackbar says so,
 * with its Undo (`Removed “Title” from the Planner`).
 */
export async function clearPlannerTask(todoId: number, window: PlannerSpan): Promise<void> {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
  if (!todo || !plannerHasPlan(todo)) return
  if (plannerClearLeaves(todo, window)) await useTodoStore.getState().setPlan([todoId], null, `Removed “${shortTitle(todo.title)}” from the Planner`, true)
  else await useTodoStore.getState().setPlan([todoId], null)
}

type PlannerRows = PlannerView<PersistedTodoItem>

const tasksWord = (n: number): string => `${n} ${n === 1 ? 'task' : 'tasks'}`

/**
 * **Unplan all Delayed**: every task the Planner's Delayed tray shows
 * (`view`) to Unplanned — each as its own Unplan would — in one write and
 * one undo step, with the snackbar's Undo.
 */
export async function unplanDelayedTasks(view: Pick<PlannerRows, 'window' | 'delayed'>): Promise<void> {
  const plans = plannerUnplanDelayed(view)
  await useTodoStore.getState().setPlans(plans, `Unplanned ${tasksWord(plans.length)} from Delayed`, true)
}


/**
 * **Reset plan**: clears the plan state of the tasks of `scope` in the
 * Planner as it shows (`utils/planner.plannerResetTasks`: this week, today
 * only, or Delayed) — **after asking** (the shared confirm prompt: how many
 * plans it clears, and how many of those tasks then leave the Planner,
 * `plannerClearLeaves`) — one write and one undo step, with the snackbar's
 * Undo, named for what it cleared: `Reset plan: this week` — or, with the
 * window shifted, the days shown, `Reset plan: Nov 27 – Dec 3` —,
 * `… today`, `… Delayed`. Cancel writes nothing; with nothing to clear it
 * asks nothing.
 */
export async function resetPlannerPlan(view: PlannerRows, scope: PlannerResetScope): Promise<void> {
  const tasks = plannerResetTasks(view, scope)
  if (tasks.length === 0) return
  const week = plannerResetWeekLabel(view.window)
  const words = scope === 'week' ? (week === 'This week' ? 'this week' : week) : scope === 'today' ? 'today' : 'Delayed'
  const leaving = tasks.filter((t) => plannerClearLeaves(t, view.window)).length
  const leaveWords = leaving === 0 ? ''
    : leaving === tasks.length ? ` ${tasks.length === 1 ? 'It has' : 'They have'} no date in the Planner, so ${tasks.length === 1 ? 'it leaves' : 'they leave'} it.`
      : ` ${leaving} of them ${leaving === 1 ? 'has' : 'have'} no date in the Planner and ${leaving === 1 ? 'leaves' : 'leave'} it.`
  const ok = await useUIStore.getState().askConfirmation({
    title: `Reset plan: ${words}?`,
    message: `This clears the plan of ${tasksWord(tasks.length)}: each goes back to where its own dates put it.${leaveWords} No due date or follow-up changes.`,
    confirmLabel: 'Reset plan',
  })
  if (!ok) return
  await useTodoStore.getState().setPlan(tasks.map((t) => t.id), null, `Reset plan: ${words}`, true)
}

/**
 * A conflict's fix for the task `todoId` (`utils/planner.PlannerFix`):
 *
 * - `move-date` — the due date or the follow-up moved to the planned day,
 *   as a day at local midnight: **a real edit** of the task, through the
 *   ordinary edit path (`todo-store.update`: stamped, one undo step, in the
 *   history log) — the one Planner write that touches a real date. When
 *   the task's own dates then put it on its planned day in the window
 *   (`plannerFixClearsPlan`), the plan is cleared in the same edit, one undo step: the row is no longer placed. With another,
 *   earlier date still putting it elsewhere the plan stays. A move that
 *   takes the task out of view (the date moved past the window, for a row
 *   planned later) shows the snackbar with its Undo (`Moved the due date to
 *   Fri, Nov 27`);
 * - `plan` — the task planned for that date's day instead, outright (a
 *   pick: its own date's day is a plan like any other).
 *
 * `tabId` null: the fix offered by the task layout's Planned cell, outside
 * a Planner (this week's window); its date move is the plain edit.
 */
export async function applyPlannerFix(tabId: string | null, todoId: number, fix: PlannerFix, window: PlannerSpan): Promise<void> {
  if (fix.kind === 'plan') return movePlannerTask(tabId, { todoId, target: { kind: 'day', day: fix.day, pick: true }, window })
  const store = useTodoStore.getState()
  const todo = store.todos.find((t) => t.id === todoId)
  if (!todo) return
  const day = startOfDay(new Date(fix.to))
  const date = fix.date === 'due' ? { dueDate: day } : { nextFollowupAt: day }
  const changes = plannerFixClearsPlan(todo, fix, window) ? { ...date, doDate: undefined, unplanned: undefined } : date
  const undo = useUndoStore.getState()
  // The edit leaves the task in view, or a compound step is already running: the plain edit.
  if (tabId == null || plannerShows({ ...todo, ...changes }, window) || undo.groupToken != null || undo.isPerformingUndoRedo) {
    await store.update(todoId, changes)
    return
  }
  await undo.runGroup(`Moved the ${fix.date === 'due' ? 'due date' : 'follow-up'} to ${plannerDayLabel(day)}`, () => store.update(todoId, changes))
}
