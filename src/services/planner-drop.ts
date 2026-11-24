import type { PersistedTodoItem } from '../models'
import type { PlannerDragPreview } from '../stores/planner-store'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore } from '../stores/undo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { startOfDay, startOfToday } from '../utils/date'
import { shortTitle } from '../utils/text'
import {
  plannerClearDelayed,
  plannerClearLeaves,
  plannerDayLabel,
  plannerDropWrite,
  plannerFixClearsPlan,
  plannerHasPlan,
  plannerMovePlan,
  plannerPlacement,
  plannerPlannedDay,
  plannerResetTasks,
  plannerResetWeekLabel,
  plannerShows,
  plannerSnoozeDay,
  plannerWindow,
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
 * Snooze, Unplan, Clear Delayed plans, Reset plan or a conflict's fix writes
 * from (a drag is the drop rule; every other move to a day is a pick,
 * planned outright). Everything but a fix's date move changes **the plan only**
 * (`todo-store.setPlans`: the planned day in one task write, one undo step,
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
 * planned day, or cleared — one undo step, no stamp). A refused drop, and
 * one that changes nothing, write no task. A plan that takes the task **out
 * of view** (`plan.hidden`: a day the Planner shows it on nowhere — a Snooze
 * past the window with no real date inside it) shows the snackbar, named for
 * the day, with its Undo (`Planned for Fri, Nov 27`), and an Unplan that
 * takes it out of the Planner (`plan.leaves`) says so (`Removed “Title” from
 * the Planner`): nothing leaves the Planner silently — in a Planner only
 * (`tabId`; outside one there is no Planner to leave). A plan write that fails
 * (`setPlan` says so and tells the user) takes the hand order back to what
 * the tab stored before, so the row doesn't keep a place among the rows of
 * a group it never reached.
 */
export async function applyPlannerMove(tabId: string | null, todoId: number, plan: PlannerMovePlan): Promise<void> {
  const { drop, order, hidden, leaves } = plan
  const before = order ? storedOrder(tabId) : null
  if (order && tabId != null) void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { order })
  const write = plannerDropWrite(drop)
  if (write === undefined) return
  const store = useTodoStore.getState()
  const title = shortTitle(store.todos.find((t) => t.id === todoId)?.title ?? '')
  const notice = tabId == null ? null
    : hidden ? `Planned for ${plannerDayLabel(hidden)}`
      : leaves ? `Removed “${title}” from the Planner`
        : null
  const saved = notice ? await store.setPlan([todoId], write, notice, true) : await store.setPlan([todoId], write)
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
 * A calendar's plan drop — a plan entry moved to a day, or a list row
 * dropped as a plan: plans the task for `day` outright (a pick, as Plan for
 * day ›), read against this week's window — one plan write, no stamp, one
 * undo step; a day before today, and a completed task, refused
 * (`plannerDrop`).
 */
export function planTaskForDay(todoId: number, day: Date): Promise<void> {
  return movePlannerTask(null, { todoId, target: { kind: 'day', day, pick: true }, window: plannerWindow(startOfToday()) })
}

/**
 * **Snooze**: plans the task for the day after the day it sits on, never
 * earlier than tomorrow (a Delayed or Unplanned row: tomorrow) — as a pick
 * (`PlannerTarget.pick`): planned for that day outright, its own date's day
 * too. A Snooze that takes it out of view says so (`applyPlannerMove`).
 */
export function snoozePlannerTask(tabId: string, todoId: number, window: PlannerSpan): Promise<void> {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
  if (!todo) return Promise.resolve()
  const day = plannerSnoozeDay(plannerPlacement(todo, window), window.today)
  return movePlannerTask(tabId, { todoId, target: { kind: 'day', day, pick: true }, window })
}

/**
 * **Today** (an Unplanned row's button, in Snooze's place): planned for
 * today outright, as a pick — today its own date's day too —, so the row
 * lands in Today.
 */
export function planPlannerTaskToday(tabId: string, todoId: number, window: PlannerSpan): Promise<void> {
  return movePlannerTask(tabId, { todoId, target: { kind: 'day', day: window.today, pick: true }, window })
}

/**
 * **Unplan**: the Unplanned tray's drop for one row — its plan cleared, back
 * to where its own dates or the Unplanned filter put it; one that then shows
 * nowhere leaves the Planner, the snackbar saying so (`applyPlannerMove`).
 */
export function unplanPlannerTask(tabId: string, todoId: number, window: PlannerSpan): Promise<void> {
  return movePlannerTask(tabId, { todoId, target: { kind: 'unplanned' }, window })
}

/**
 * **Clear plan**: the task's plan state cleared (`setPlan(…, null)`: one
 * undo step, no stamp) — it goes back to where its own dates put it. When
 * that takes it out of the Planner (`plannerClearLeaves`: no date in the
 * window, not matching the Unplanned filter — `window.joins`) — **Remove from Planner** — the snackbar says so,
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

/** How many of `n` tasks leave the Planner, in Reset plan's words (` 1 of them leaves the Planner.`); empty when none. */
function leaveWords(left: number, n: number, past = false): string {
  if (left === 0) return ''
  if (left === n) return past ? ` ${left === 1 ? 'It left' : 'They all left'} the Planner.` : ` ${left === 1 ? 'It leaves' : 'They all leave'} the Planner.`
  return past ? ` ${left} of them left the Planner.` : ` ${left} of them ${left === 1 ? 'leaves' : 'leave'} the Planner.`
}

/**
 * **Clear Delayed plans**: the plan of every task the Planner's Delayed
 * tray shows (`view`) cleared — each back to where its own dates or the
 * Unplanned filter put it — in one write and one undo step, with the
 * snackbar's Undo, saying how many then left the Planner as Reset plan says
 * it (`Cleared 3 Delayed plans. 1 of them left the Planner.`). It asks
 * nothing.
 */
export async function clearDelayedPlans(view: Pick<PlannerRows, 'window' | 'delayed'>): Promise<void> {
  const plans = plannerClearDelayed(view)
  if (plans.length === 0) return
  const ids = new Set(plans.map((p) => p.id))
  const left = view.delayed.tasks.filter((t) => ids.has(t.id) && plannerClearLeaves(t, view.window)).length
  const what = plans.length === 1 ? 'Cleared 1 Delayed plan.' : `Cleared ${plans.length} Delayed plans.`
  await useTodoStore.getState().setPlans(plans, `${what}${leaveWords(left, plans.length, true)}`, true)
}

/** Why a task leaving on a reset was in the Planner: its planned day (`Planned Thu, Nov 26`). */
function resetLeaveNote(task: PersistedTodoItem): string {
  const planned = plannerPlannedDay(task)
  return planned ? `Planned ${plannerDayLabel(planned)}` : ''
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
  const leaving = tasks.filter((t) => plannerClearLeaves(t, view.window))
  const n = leaving.length
  const ok = await useUIStore.getState().askConfirmation({
    title: `Reset plan: ${words}?`,
    message: `This clears the plan of ${tasksWord(tasks.length)}: each goes back to where its own dates put it.${leaveWords(n, tasks.length)} No due date or follow-up changes.`,
    ...(n > 0 ? {
      list: {
        label: `Leaving the Planner — no date in it, not in the Unplanned filter`,
        items: leaving.map((t) => ({ key: t.id, text: t.title, note: resetLeaveNote(t) })),
      },
    } : {}),
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
  const changes = plannerFixClearsPlan(todo, fix, window) ? { ...date, doDate: undefined } : date
  const undo = useUndoStore.getState()
  // The edit leaves the task in view, or a compound step is already running: the plain edit.
  if (tabId == null || plannerShows({ ...todo, ...changes }, window) || undo.groupToken != null || undo.isPerformingUndoRedo) {
    await store.update(todoId, changes)
    return
  }
  await undo.runGroup(`Moved the ${fix.date === 'due' ? 'due date' : 'follow-up'} to ${plannerDayLabel(day)}`, () => store.update(todoId, changes))
}
