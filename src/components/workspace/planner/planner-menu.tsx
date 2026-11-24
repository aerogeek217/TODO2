import type { PersistedTodoItem } from '../../../models'
import {
  plannerClearLeaves,
  plannerPlacement,
  plannerDayWords,
  plannerSnoozeDay,
  plannerUnplan,
  type PlannerTarget,
  type PlannerWindow,
} from '../../../utils/planner'
import type { MenuEntry } from '../../shared/MenuPopover'
import { WidgetKindIcon } from '../../shared/icons'
import { planDayItems, pickPlanDateItem, plannerWhereWords } from '../../task/plan-menu'

/** What the menu's entries do: the Planner's writes for the row (`services/planner-drop`). */
export interface PlannerMenuActions {
  /** Plan for day ›: the day picked, planned outright (a `pick` target). */
  move: (target: PlannerTarget) => void
  /** Snooze: the next day. */
  snooze: () => void
  /** Unplan / Remove from Planner: the plan cleared. */
  unplan: () => void
}

/**
 * A Planner row's entries in its task menu — the drag's moves without a
 * pointer (the task menu's extra entries, `TaskMenuExtrasContext`, in place
 * of the task menu's own Plan for day ›, `task/plan-menu`):
 *
 * - **Plan for day ›** — Today,
 *   then the window's days after it, in words — the planned day checked —,
 *   then **Pick a date…**. A pick plans the task for that day outright, its
 *   own date's day too (`planDayItems`; only a drag onto that day clears
 *   the plan). The item names where the row is (a day, `Delayed`,
 *   `Unplanned`);
 * - **Snooze** — the day after the one it sits on, never before tomorrow
 *   (`plannerSnoozeDay`, planned outright as a pick); the item names that day;
 *   none on a row in Unplanned (nothing there is planned to put off);
 * - **Unplan** — on a placed row (one with a plan state, `plannerUnplan`):
 *   its plan cleared, back to where its own dates or the Unplanned filter
 *   put it; **Remove from Planner** when that takes it out of the Planner
 *   (`plannerClearLeaves`).
 *
 * None of them changes a due date or a follow-up. None for a completed
 * task: the Planner holds open tasks.
 */
export function plannerMenuEntries(
  todo: PersistedTodoItem,
  window: Pick<PlannerWindow, 'today' | 'days' | 'last' | 'joins'>,
  actions: PlannerMenuActions,
): MenuEntry[] {
  if (todo.isCompleted) return []
  const { today } = window
  const placement = plannerPlacement(todo, window)
  // Nothing in Unplanned is planned to put off: no Snooze there (Plan for day › Today plans it).
  const snooze: MenuEntry[] = placement?.where === 'unplanned' ? [] : [{
    kind: 'item',
    label: 'Snooze',
    note: plannerDayWords(plannerSnoozeDay(placement, today), today),
    onSelect: actions.snooze,
  }]
  const unplan: MenuEntry[] = plannerUnplan(todo, window).kind === 'unplan'
    ? [{ kind: 'item', label: plannerClearLeaves(todo, window) ? 'Remove from Planner' : 'Unplan', onSelect: actions.unplan }]
    : []
  return [
    {
      kind: 'item',
      label: 'Plan for day',
      icon: <WidgetKindIcon kind="planner" />,
      note: plannerWhereWords(placement, today),
      childrenWidth: 216,
      children: [
        ...planDayItems(todo, window, actions.move),
        { kind: 'separator' },
        pickPlanDateItem(todo, today, actions.move),
      ],
    },
    ...snooze,
    ...unplan,
  ]
}
