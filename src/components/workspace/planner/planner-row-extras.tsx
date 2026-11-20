import type { PersistedTodoItem } from '../../../models'
import { plannerLateDates, plannerRowTag, type PlannerPlacement, type PlannerWindow } from '../../../utils/planner'
import type { TaskRowExtras } from '../../task/task-row-extras'
import { PlannerRowActions, PlannerRowTag } from './PlannerRowExtras'

type Span = Pick<PlannerWindow, 'today' | 'last'>

/**
 * What a Planner adds to the row of `todo` (`TaskRowExtrasContext`): its
 * tag, its hover buttons and the real dates its plan falls after, drawn
 * late. Null for a task with no placement (a completed row lingering).
 */
export function plannerRowExtras(
  todo: PersistedTodoItem,
  placement: PlannerPlacement | undefined,
  tabId: string,
  window: Span,
): TaskRowExtras | null {
  if (!placement || todo.isCompleted) return null
  const tag = plannerRowTag(placement)
  return {
    tag: tag ? <PlannerRowTag tabId={tabId} todoId={todo.id} tag={tag} window={window} /> : undefined,
    actions: <PlannerRowActions tabId={tabId} todoId={todo.id} placement={placement} window={window} />,
    late: plannerLateDates(placement) ?? undefined,
  }
}
