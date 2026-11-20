import type { PlannerDragPreview } from '../stores/planner-store'
import { useTodoStore } from '../stores/todo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { plannerDropPlan, type PlannerDropPlan, type PlannerDropPosition, type PlannerTarget, type PlannerWindow } from '../utils/planner'
import type { PlannerDropRequest } from '../utils/task-dnd'

/** A task moved to a day of a Planner: a row dropped on a tile or in a group, or Move to day ›. */
interface PlannerMove {
  todoId: number
  target: PlannerTarget
  /** The Planner's window as it shows: what the task's placement is read against. */
  window: Pick<PlannerWindow, 'today' | 'last'>
  /** Dropped into a group: where (`utils/planner.PlannerDropPosition`). Null: a tile, the menu. */
  position?: PlannerDropPosition | null
}

/**
 * What `move` does now, for the task as the store holds it
 * (`utils/planner.plannerDropPlan`); null when the task is gone.
 */
function planPlannerMove(move: PlannerMove): PlannerDropPlan | null {
  const todo = useTodoStore.getState().todos.find((t) => t.id === move.todoId)
  return todo ? plannerDropPlan(todo, move.window, move.target, move.position ?? null) : null
}

/**
 * The plan for a task dropped on a Planner's tile or group (the
 * dispatcher's `PlannerDropRequest`). The place in a group is the one the
 * Planner's drag preview shows (`stores/planner-store`'s `drag`, which the
 * widget sets as the pointer moves) — only while it is of that very group:
 * with none, the drop still writes its day and the hand order stays.
 */
export function planPlannerDrop(request: PlannerDropRequest, preview: PlannerDragPreview | null): PlannerDropPlan | null {
  const { group } = request
  const index = group && preview?.tabId === request.tabId && preview.over === 'group' && preview.key === group.key ? preview.index : null
  return planPlannerMove({
    todoId: request.todo.id,
    target: request.target,
    window: request.window,
    position: group && index != null ? { rows: group.rows, shown: group.shown, index } : null,
  })
}

/**
 * Makes a planned move in the Planner `tabId` — the only place a Planner
 * drop or Move to day › writes from. The hand order first (the tab's view
 * state, `order`: saved at once, no undo step, as a list's manual order),
 * then the one task write: a follow-up moved to the day (local midnight) by
 * the ordinary task edit — stamped, one undo step — or the Do day set or
 * cleared (`setDoDate`: one undo step, no stamp). The due date is never
 * written; a refused drop, and one that changes nothing, write no task.
 */
export async function applyPlannerMove(tabId: string, todoId: number, plan: PlannerDropPlan): Promise<void> {
  const { drop, order } = plan
  if (order) void useWorkspaceStore.getState().patchTabViewState(tabId, 'planner', { order })
  if (drop.kind === 'followup') await useTodoStore.getState().update(todoId, { nextFollowupAt: drop.date })
  else if (drop.kind === 'do') await useTodoStore.getState().setDoDate([todoId], drop.date)
}

/** Plans and makes `move` (Move to day ›); resolves once it is written. */
export function movePlannerTask(tabId: string, move: PlannerMove): Promise<void> {
  const plan = planPlannerMove(move)
  return plan ? applyPlannerMove(tabId, move.todoId, plan) : Promise.resolve()
}
