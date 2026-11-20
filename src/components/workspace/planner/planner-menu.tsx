import type { PersistedTodoItem } from '../../../models'
import { formatDateWith } from '../../../utils/date'
import { plannerDayWords, plannerDrop, plannerPlacement, type PlannerTarget, type PlannerWindow } from '../../../utils/planner'
import type { MenuEntry } from '../../shared/MenuPopover'
import { WidgetKindIcon } from '../../shared/icons'

/** The submenu's first line: which date a pick changes. */
export const MOVE_FOLLOWUP_LABEL = 'Moves the follow-up'
export const MOVE_DO_LABEL = 'Sets the Do day'

/** Why No day is off for a row on its day by a date. */
export const NO_DAY_REFUSED = {
  followup: 'It is on its day by its follow-up date. Only a Do day can be cleared.',
  due: 'It is on its day by its due date. Only a Do day can be cleared.',
} as const

/**
 * **Move to day ›** for a row in a Planner — the drag's moves without a
 * pointer (the task menu's extra entry, `TaskMenuExtrasContext`): a muted
 * first line saying which date a pick changes (`Moves the follow-up` for a
 * row on its day by its follow-up, else `Sets the Do day`), Today, then the
 * window's days after it, in words — the day the row is on checked — and
 * **No day**: it clears a Do day, is checked for a Focus task with no day,
 * and is off for a row placed by a date, its tooltip saying why. Each pick
 * is the drop's decision (`plannerDrop`) made by `onMove`. None for a
 * completed task: the Planner holds open tasks.
 */
export function plannerMoveEntries(
  todo: PersistedTodoItem,
  window: Pick<PlannerWindow, 'today' | 'days' | 'last'>,
  onMove: (target: PlannerTarget) => void,
): MenuEntry[] {
  if (todo.isCompleted) return []
  const { today } = window
  const placement = plannerPlacement(todo, today, window.last)
  const days = [today, ...window.days.filter((d) => d.getTime() > today.getTime())]
  const dayItems = days.map((day): MenuEntry => {
    const isToday = day.getTime() === today.getTime()
    const here = plannerDrop(todo, placement, { kind: 'day', day }).kind === 'none'
    return {
      kind: 'item',
      label: plannerDayWords(day, today),
      note: isToday ? formatDateWith(day, { month: 'short', day: 'numeric' }) : undefined,
      radio: true,
      checked: here,
      onSelect: () => onMove({ kind: 'day', day }),
    }
  })
  const noDay = plannerDrop(todo, placement, { kind: 'noday' })
  const refused = noDay.kind === 'refuse'
  return [{
    kind: 'item',
    label: 'Move to day',
    icon: <WidgetKindIcon kind="planner" />,
    note: placement ? plannerDayWords(placement.day, today) : 'No day',
    childrenWidth: 216,
    children: [
      { kind: 'label', text: placement?.reason === 'followup' ? MOVE_FOLLOWUP_LABEL : MOVE_DO_LABEL },
      ...dayItems,
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'No day',
        radio: true,
        checked: noDay.kind === 'none',
        disabled: refused,
        title: refused && placement && placement.reason !== 'do' ? NO_DAY_REFUSED[placement.reason] : undefined,
        onSelect: () => onMove({ kind: 'noday' }),
      },
    ],
  }]
}
