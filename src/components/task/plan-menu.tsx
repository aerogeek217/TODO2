import type { PersistedTodoItem, TaskPlan, TodoItem } from '../../models'
import { clearPlannerTask, movePlannerTask } from '../../services/planner-drop'
import { formatDateWith, startOfDay } from '../../utils/date'
import {
  plannerClearLeaves,
  plannerDayWords,
  plannerHasPlan,
  plannerPlacement,
  plannerPlannedDay,
  plannerWindow,
  type PlannerPlacement,
  type PlannerTarget,
  type PlannerSpan,
  type PlannerWindow,
} from '../../utils/planner'
import type { MenuEntry } from '../shared/MenuPopover'
import { WidgetKindIcon } from '../shared/icons'
import { pickDate } from '../shared/pick-date'

/** Clear plan's words: **Remove from Planner** when it takes the task out of the Planner (`plannerClearLeaves`). */
export function clearPlanLabel(todo: PersistedTodoItem, window: PlannerSpan): string {
  return plannerClearLeaves(todo, window) ? 'Remove from Planner' : 'Clear plan'
}

/** Where the task sits in the Planner, in words — a day, `Delayed`, `Unplanned` — or nothing (not in it). */
export function plannerWhereWords(placement: PlannerPlacement | null, today: Date): string | undefined {
  if (placement?.where === 'day' && placement.day) return plannerDayWords(placement.day, today)
  return placement?.where === 'delayed' ? 'Delayed' : placement ? 'Unplanned' : undefined
}

const sameDay = (date: Date | undefined, day: Date): boolean => date != null && startOfDay(new Date(date)).getTime() === day.getTime()

/**
 * Plan for day ›'s days: Today (its date beside it), then the window's days
 * after it, in words — the task's due and follow-up days noted (`due`,
 * `follow-up`), its planned day checked. A pick is `move` on that day as a
 * **pick** (`PlannerTarget.pick`): planned for it outright, its own date's
 * day too (`plannerDrop`).
 */
export function planDayItems(
  todo: Pick<TodoItem, 'doDate' | 'dueDate' | 'nextFollowupAt'>,
  window: Pick<PlannerWindow, 'today' | 'days' | 'last' | 'joins'>,
  move: (target: PlannerTarget) => void,
): MenuEntry[] {
  const { today } = window
  const planned = plannerPlannedDay(todo)
  const days = [today, ...window.days.filter((d) => d.getTime() > today.getTime())]
  return days.map((day): MenuEntry => {
    const notes = [
      day.getTime() === today.getTime() ? formatDateWith(day, { month: 'short', day: 'numeric' }) : null,
      sameDay(todo.dueDate, day) ? 'due' : null,
      sameDay(todo.nextFollowupAt, day) ? 'follow-up' : null,
    ].filter((n) => n != null)
    return {
      kind: 'item',
      label: plannerDayWords(day, today),
      note: notes.length > 0 ? notes.join(' · ') : undefined,
      radio: true,
      checked: planned?.getTime() === day.getTime(),
      onSelect: () => move({ kind: 'day', day, pick: true }),
    }
  })
}

/**
 * **Pick a date…**: any day from today on, in the browser's date picker
 * (`shared/pick-date`), planned outright as a day of the list is.
 */
export function pickPlanDateItem(todo: Pick<TodoItem, 'doDate'>, today: Date, move: (target: PlannerTarget) => void): MenuEntry {
  return {
    kind: 'item',
    label: 'Pick a date…',
    onSelect: () => pickDate({
      value: todo.doDate,
      min: today,
      onPick: (day) => move({ kind: 'day', day, pick: true }),
    }),
  }
}

/**
 * The **Plan for day** menu of an open task outside a Planner, read
 * against this week's window (today and the six days after it, as a
 * Planner on this week shows them):
 *
 * - the days (`planDayItems`);
 * - **Pick a date…** (`pickPlanDateItem`);
 * - **Unplanned** — held in the Planner's Unplanned tray with no day (any
 *   open task: it joins the Planner so), checked while it is there;
 * - **Clear plan** — while it has a plan state (`clearPlannerTask`): back to
 *   where its own dates put it; **Remove from Planner** when that takes it
 *   out of the Planner.
 *
 * The task menus' submenu (`planForDayEntries`) and the task layout's
 * Planned cell (`PlannedFacts`) show it. Each pick is a plan write (no
 * stamp, one undo step), never a due date or a follow-up.
 */
export function planMenuEntries(todo: PersistedTodoItem, today: Date): MenuEntry[] {
  const window = plannerWindow(today)
  const placement = plannerPlacement(todo, window)
  const move = (target: PlannerTarget) => { void movePlannerTask(null, { todoId: todo.id, target, window }) }
  const clear: MenuEntry[] = plannerHasPlan(todo)
    ? [{ kind: 'item', label: clearPlanLabel(todo, window), onSelect: () => { void clearPlannerTask(todo.id, window) } }]
    : []
  return [
    ...planDayItems(todo, window, move),
    { kind: 'separator' },
    pickPlanDateItem(todo, window.today, move),
    { kind: 'item', label: 'Unplanned', radio: true, checked: placement?.where === 'unplanned', onSelect: () => move({ kind: 'unplanned' }) },
    ...clear,
  ]
}

/**
 * The Plan for day menu of a task not yet created (the task editor's create
 * and draft modes), over its plan held until Create: the same days, Pick a
 * date… and Unplanned, each setting the plan (`onPlan`), and **Clear plan**
 * while it has one. Nothing is written.
 */
export function draftPlanMenuEntries(
  task: Pick<TodoItem, 'doDate' | 'unplanned' | 'dueDate' | 'nextFollowupAt'>,
  today: Date,
  onPlan: (plan: TaskPlan) => void,
): MenuEntry[] {
  const window = plannerWindow(today)
  const move = (target: PlannerTarget) => {
    if (target.kind === 'day') onPlan({ day: startOfDay(new Date(target.day)) })
    else if (target.kind === 'unplanned') onPlan('unplanned')
  }
  const held = task.doDate == null && task.unplanned === true
  return [
    ...planDayItems(task, window, move),
    { kind: 'separator' },
    pickPlanDateItem(task, window.today, move),
    { kind: 'item', label: 'Unplanned', radio: true, checked: held, onSelect: () => move({ kind: 'unplanned' }) },
    ...(task.doDate != null || held ? [{ kind: 'item' as const, label: 'Clear plan', onSelect: () => onPlan(null) }] : []),
  ]
}

/**
 * **Plan for day ›** for any open task, outside a Planner — every task menu
 * (a row's right-click, a calendar entry's, a search result's) and the task
 * editor's and the review card's ⋯ — its submenu `planMenuEntries`. The
 * item names where the task sits in the Planner (a day, `Delayed`,
 * `Unplanned`). None for a completed task: the Planner holds open tasks. A
 * Planner's own rows have its menu instead (`planner-menu`).
 */
export function planForDayEntries(todo: PersistedTodoItem, today: Date): MenuEntry[] {
  if (todo.isCompleted) return []
  const window = plannerWindow(today)
  return [{
    kind: 'item',
    label: 'Plan for day',
    icon: <WidgetKindIcon kind="planner" />,
    note: plannerWhereWords(plannerPlacement(todo, window), window.today),
    childrenWidth: 216,
    children: planMenuEntries(todo, today),
  }]
}
