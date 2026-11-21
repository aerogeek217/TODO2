import type { PersistedTodoItem } from '../../../models'
import { formatDateWith } from '../../../utils/date'
import {
  plannerDayWords,
  plannerPlacement,
  plannerSnoozeDay,
  plannerUnplan,
  type PlannerTarget,
  type PlannerWindow,
} from '../../../utils/planner'
import type { MenuEntry } from '../../shared/MenuPopover'
import { WidgetKindIcon } from '../../shared/icons'

/** The Plan for day › submenu's first line: a pick changes the plan, nothing else. */
export const MOVE_PLAN_LABEL = 'Plans it for that day'

/** Why Unplan is off: the row is where Unplan would put it. */
export const UNPLAN_OFF = 'It is in Unplanned already.'

/** What the menu's entries do: the Planner's writes for the row (`services/planner-drop`). */
export interface PlannerMenuActions {
  /** Plan for day ›: the drop rule on the picked day. */
  move: (target: PlannerTarget) => void
  /** Snooze: the next day. */
  snooze: () => void
  /** Unplan: to the Unplanned tray. */
  unplan: () => void
}

/**
 * A Planner row's entries in its task menu — the drag's moves without a
 * pointer (the task menu's extra entries, `TaskMenuExtrasContext`):
 *
 * - **Plan for day ›** — a muted first line (`Plans it for that day`), Today,
 *   then the window's days after it, in words — the day the row sits on
 *   checked. A pick is the drop rule (`plannerDrop`): the task is planned
 *   for the day, or — on the day its own date puts it — loses its plan.
 *   The item names where the row is (a day, `Delayed`, `Unplanned`);
 * - **Snooze** — the day after the one it sits on, never before tomorrow
 *   (`plannerSnoozeDay`, through the drop rule); the item names that day;
 *   none on a row in Unplanned (nothing there is planned to put off);
 * - **Unplan** — to the Unplanned tray (`plannerUnplan`); off, saying why,
 *   for a row that is there already.
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
  const days = [today, ...window.days.filter((d) => d.getTime() > today.getTime())]
  const dayItems = days.map((day): MenuEntry => {
    const isToday = day.getTime() === today.getTime()
    return {
      kind: 'item',
      label: plannerDayWords(day, today),
      note: isToday ? formatDateWith(day, { month: 'short', day: 'numeric' }) : undefined,
      radio: true,
      checked: placement?.where === 'day' && placement.day?.getTime() === day.getTime(),
      onSelect: () => actions.move({ kind: 'day', day }),
    }
  })
  const where = placement?.where === 'day' && placement.day
    ? plannerDayWords(placement.day, today)
    : placement?.where === 'delayed' ? 'Delayed' : placement ? 'Unplanned' : undefined
  // A row the Planner shows is on a day or in Delayed (Unplan moves it) or in Unplanned already.
  const unplanOff = plannerUnplan(todo, window).kind === 'unplan' ? undefined : UNPLAN_OFF
  // Nothing in Unplanned is planned to put off: no Snooze there (Plan for day › Today plans it).
  const snooze: MenuEntry[] = placement?.where === 'unplanned' ? [] : [{
    kind: 'item',
    label: 'Snooze',
    note: plannerDayWords(plannerSnoozeDay(placement, today), today),
    onSelect: actions.snooze,
  }]
  return [
    {
      kind: 'item',
      label: 'Plan for day',
      icon: <WidgetKindIcon kind="planner" />,
      note: where,
      childrenWidth: 216,
      children: [{ kind: 'label', text: MOVE_PLAN_LABEL }, ...dayItems],
    },
    ...snooze,
    {
      kind: 'item',
      label: 'Unplan',
      disabled: unplanOff != null,
      title: unplanOff,
      onSelect: actions.unplan,
    },
  ]
}
