import type { PersistedTodoItem } from '../../../models'
import {
  plannerHasPlan,
  plannerPlacement,
  plannerDayWords,
  plannerSnoozeDay,
  plannerUnplan,
  type PlannerTarget,
  type PlannerWindow,
} from '../../../utils/planner'
import type { MenuEntry } from '../../shared/MenuPopover'
import { WidgetKindIcon } from '../../shared/icons'
import { clearPlanLabel, PLAN_FOR_DAY_LABEL, planDayItems, pickPlanDateItem, plannerWhereWords } from '../../task/plan-menu'

/** Why Unplan is off: the row is where Unplan would put it. */
export const UNPLAN_OFF = 'It is in Unplanned already.'

/** What the menu's entries do: the Planner's writes for the row (`services/planner-drop`). */
export interface PlannerMenuActions {
  /** Plan for day ›: the day picked, planned outright (a `pick` target). */
  move: (target: PlannerTarget) => void
  /** Snooze: the next day. */
  snooze: () => void
  /** Unplan: to the Unplanned tray. */
  unplan: () => void
  /** Clear plan / Remove from Planner: the plan state cleared. */
  clear: () => void
}

/**
 * A Planner row's entries in its task menu — the drag's moves without a
 * pointer (the task menu's extra entries, `TaskMenuExtrasContext`, in place
 * of the task menu's own Plan for day ›, `task/plan-menu`):
 *
 * - **Plan for day ›** — a muted first line (`PLAN_FOR_DAY_LABEL`), Today,
 *   then the window's days after it, in words — the planned day checked —,
 *   then **Pick a date…**. A pick plans the task for that day outright, its
 *   own date's day too (`planDayItems`; only a drag onto that day clears
 *   the plan). The item names where the row is (a day, `Delayed`,
 *   `Unplanned`);
 * - **Snooze** — the day after the one it sits on, never before tomorrow
 *   (`plannerSnoozeDay`, planned outright as a pick); the item names that day;
 *   none on a row in Unplanned (nothing there is planned to put off);
 * - **Unplan** — to the Unplanned tray (`plannerUnplan`); off, saying why,
 *   for a row that is there already;
 * - **Clear plan** — on a placed row (one with a plan state): back to where
 *   its own dates put it; **Remove from Planner** when that takes it out of
 *   the Planner (`plannerClearLeaves`).
 *
 * None of them changes a due date or a follow-up. None for a completed
 * task: the Planner holds open tasks.
 */
export function plannerMenuEntries(
  todo: PersistedTodoItem,
  window: Pick<PlannerWindow, 'today' | 'days' | 'last'>,
  actions: PlannerMenuActions,
): MenuEntry[] {
  if (todo.isCompleted) return []
  const { today } = window
  const placement = plannerPlacement(todo, window)
  // A row the Planner shows is on a day or in Delayed (Unplan moves it) or in Unplanned already.
  const unplanOff = plannerUnplan(todo, window).kind === 'unplan' ? undefined : UNPLAN_OFF
  // Nothing in Unplanned is planned to put off: no Snooze there (Plan for day › Today plans it).
  const snooze: MenuEntry[] = placement?.where === 'unplanned' ? [] : [{
    kind: 'item',
    label: 'Snooze',
    note: plannerDayWords(plannerSnoozeDay(placement, today), today),
    onSelect: actions.snooze,
  }]
  const clear: MenuEntry[] = plannerHasPlan(todo) ? [{ kind: 'item', label: clearPlanLabel(todo, window), onSelect: actions.clear }] : []
  return [
    {
      kind: 'item',
      label: 'Plan for day',
      icon: <WidgetKindIcon kind="planner" />,
      note: plannerWhereWords(placement, today),
      childrenWidth: 216,
      children: [
        { kind: 'label', text: PLAN_FOR_DAY_LABEL },
        ...planDayItems(todo, window, actions.move),
        { kind: 'separator' },
        pickPlanDateItem(todo, today, actions.move),
      ],
    },
    ...snooze,
    {
      kind: 'item',
      label: 'Unplan',
      disabled: unplanOff != null,
      title: unplanOff,
      onSelect: actions.unplan,
    },
    ...clear,
  ]
}
