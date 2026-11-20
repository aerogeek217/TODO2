import type { PersistedTodoItem } from '../models'
import type { PlannerDragPreview } from '../stores/planner-store'
import { useTodoStore } from '../stores/todo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { startOfDay } from '../utils/date'
import {
  plannerDropWrite,
  plannerMovePlan,
  plannerPlacement,
  plannerResetTasks,
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
 * The Planner's writes — the only place a Planner drop, Move to day ›,
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

/** The hand order the Planner `tabId` of the open layout stores (none: no such tab, or it never had one). */
function storedOrder(tabId: string): readonly string[] {
  const layout = useWorkspaceStore.getState().working
  const tab = layout ? getTab(layout, tabId) : undefined
  return tab?.kind === 'planner' ? tab.viewState?.order ?? [] : []
}

/**
 * What `move` does now in the Planner `tabId`, for the task as the store
 * holds it (`utils/planner.plannerMovePlan`); null when the task is gone.
 * A place is merged into the tab's stored hand order: the tasks it doesn't
 * show now keep theirs, and only those the todo store no longer holds
 * (deleted, purged) leave it.
 */
function planPlannerMove(tabId: string, move: PlannerMove): PlannerMovePlan | null {
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
 * refused drop, and one that changes nothing, write no task.
 */
export async function applyPlannerMove(tabId: string, todoId: number, plan: PlannerMovePlan): Promise<void> {
  const { drop, order } = plan
  if (order) void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { order })
  const write = plannerDropWrite(drop)
  if (write !== undefined) await useTodoStore.getState().setPlan([todoId], write)
}

/** Plans and makes `move` (Move to day ›, Unplan); resolves once it is written. */
export function movePlannerTask(tabId: string, move: PlannerMove): Promise<void> {
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

/** **Unplan**: the Unplanned tray's drop for one row — held there with a natural day, else its plan cleared. */
export function unplanPlannerTask(tabId: string, todoId: number, window: PlannerSpan): Promise<void> {
  return movePlannerTask(tabId, { todoId, target: { kind: 'unplanned' }, window })
}

type PlannerRows = PlannerView<PersistedTodoItem>

const tasksWord = (n: number): string => `${n} ${n === 1 ? 'task' : 'tasks'}`

/**
 * **Unplan all Delayed**: every task the Planner's Delayed tray shows
 * (`view`) to Unplanned — each held or just cleared, as its own Unplan
 * would — in one write and one undo step.
 */
export function unplanDelayedTasks(view: Pick<PlannerRows, 'window' | 'delayed'>): Promise<void> {
  const plans = plannerUnplanDelayed(view)
  return useTodoStore.getState().setPlans(plans, `Unplanned ${tasksWord(plans.length)} from Delayed`)
}

const RESET_WORDS: Record<PlannerResetScope, string> = { week: 'this week', today: 'today', delayed: 'Delayed' }

/**
 * **Reset plan**: clears the plan state of the tasks of `scope` in the
 * Planner as it shows (`utils/planner.plannerResetTasks`: this week, today
 * only, or Delayed) — one write and one undo step.
 */
export function resetPlannerPlan(view: PlannerRows, scope: PlannerResetScope): Promise<void> {
  const ids = plannerResetTasks(view, scope).map((t) => t.id)
  return useTodoStore.getState().setPlan(ids, null, `Reset plan: ${RESET_WORDS[scope]}`)
}

/**
 * A conflict's fix for the task `todoId` (`utils/planner.PlannerFix`):
 *
 * - `move-date` — the due date or the follow-up moved to the planned day,
 *   as a day at local midnight: **a real edit** of the task, through the
 *   ordinary edit path (`todo-store.update`: stamped, one undo step, in the
 *   history log) — the one Planner write that touches a real date;
 * - `plan` — the task planned for that date's day instead, through the
 *   drop rule (on its natural day the plan is cleared).
 */
export async function applyPlannerFix(tabId: string, todoId: number, fix: PlannerFix, window: PlannerSpan): Promise<void> {
  if (fix.kind === 'plan') return movePlannerTask(tabId, { todoId, target: { kind: 'day', day: fix.day }, window })
  const day = startOfDay(new Date(fix.to))
  await useTodoStore.getState().update(todoId, fix.date === 'due' ? { dueDate: day } : { nextFollowupAt: day })
}
