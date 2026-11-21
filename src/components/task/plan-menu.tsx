import type { PersistedTodoItem } from '../../models'
import { clearPlannerTask, movePlannerTask } from '../../services/planner-drop'
import { formatDateWith } from '../../utils/date'
import {
  plannerClearLeaves,
  plannerDayWords,
  plannerHasPlan,
  plannerPlacement,
  plannerWindow,
  type PlannerPlacement,
  type PlannerTarget,
  type PlannerWindow,
} from '../../utils/planner'
import type { MenuEntry } from '../shared/MenuPopover'
import { WidgetKindIcon } from '../shared/icons'

/** The Plan for day › submenu's first line: a pick changes the plan, nothing else. */
export const PLAN_FOR_DAY_LABEL = 'Plans it for that day'

/** Clear plan's words: **Remove from Planner** when it takes the task out of the Planner (`plannerClearLeaves`). */
export function clearPlanLabel(todo: PersistedTodoItem, window: Pick<PlannerWindow, 'today' | 'last'>): string {
  return plannerClearLeaves(todo, window) ? 'Remove from Planner' : 'Clear plan'
}

/** Where the task sits in the Planner, in words — a day, `Delayed`, `Unplanned` — or nothing (not in it). */
export function plannerWhereWords(placement: PlannerPlacement | null, today: Date): string | undefined {
  if (placement?.where === 'day' && placement.day) return plannerDayWords(placement.day, today)
  return placement?.where === 'delayed' ? 'Delayed' : placement ? 'Unplanned' : undefined
}

/**
 * Plan for day ›'s days: Today (its date beside it), then the window's days
 * after it, in words — the day the task sits on checked. A pick is
 * `move` on that day (the drop rule, `plannerDrop`).
 */
export function planDayItems(
  todo: PersistedTodoItem,
  window: Pick<PlannerWindow, 'today' | 'days' | 'last'>,
  move: (target: PlannerTarget) => void,
): MenuEntry[] {
  const { today } = window
  const placement = plannerPlacement(todo, window)
  const days = [today, ...window.days.filter((d) => d.getTime() > today.getTime())]
  return days.map((day): MenuEntry => {
    const isToday = day.getTime() === today.getTime()
    return {
      kind: 'item',
      label: plannerDayWords(day, today),
      note: isToday ? formatDateWith(day, { month: 'short', day: 'numeric' }) : undefined,
      radio: true,
      checked: placement?.where === 'day' && placement.day?.getTime() === day.getTime(),
      onSelect: () => move({ kind: 'day', day }),
    }
  })
}

/**
 * **Plan for day ›** for any open task, outside a Planner — every task menu
 * (a row's right-click, a calendar entry's, a search result's) and the task
 * editor's ⋯: read against this week's window (today and the six days
 * after it, as a Planner on this week shows them):
 *
 * - a muted first line, then the days (`planDayItems`);
 * - **Unplanned** — held in the Planner's Unplanned tray with no day (any
 *   open task: it joins the Planner so), checked while it is there;
 * - **Clear plan** — while it has a plan state (`clearPlannerTask`): back to
 *   where its own dates put it; **Remove from Planner** when that takes it
 *   out of the Planner.
 *
 * The item names where the task sits (a day, `Delayed`, `Unplanned`). None
 * for a completed task: the Planner holds open tasks. Never a due date or a
 * follow-up. A Planner's own rows have its menu instead (`planner-menu`).
 */
export function planForDayEntries(todo: PersistedTodoItem, today: Date): MenuEntry[] {
  if (todo.isCompleted) return []
  const window = plannerWindow(today)
  const placement = plannerPlacement(todo, window)
  const move = (target: PlannerTarget) => { void movePlannerTask(null, { todoId: todo.id, target, window }) }
  const clear: MenuEntry[] = plannerHasPlan(todo)
    ? [{ kind: 'item', label: clearPlanLabel(todo, window), onSelect: () => { void clearPlannerTask(todo.id, window) } }]
    : []
  return [{
    kind: 'item',
    label: 'Plan for day',
    icon: <WidgetKindIcon kind="planner" />,
    note: plannerWhereWords(placement, window.today),
    childrenWidth: 216,
    children: [
      { kind: 'label', text: PLAN_FOR_DAY_LABEL },
      ...planDayItems(todo, window, move),
      { kind: 'separator' },
      { kind: 'item', label: 'Unplanned', radio: true, checked: placement?.where === 'unplanned', onSelect: () => move({ kind: 'unplanned' }) },
      ...clear,
    ],
  }]
}
