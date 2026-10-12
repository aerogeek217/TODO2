import type { TodoItem } from '../models'
import { useSettingsStore } from '../stores/settings-store'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { startOfToday } from '../utils/date'
import { daysUntil } from '../utils/effective-date'
import { formatFollowupDay } from '../utils/followup'
import { dueDatePhrase, isUrgentByDate, type UrgentDueWithinDays } from '../utils/urgency'

/**
 * Turning Urgent off. Urgent is effective urgent (flag OR due within the
 * Settings range), so clearing the flag alone doesn't always make a task not
 * urgent. The case table:
 *
 * | Task(s)                              | Now                 | Then asks                                  |
 * |--------------------------------------|---------------------|--------------------------------------------|
 * | One, not flagged, urgent by date     | nothing changes     | `Remove the due date?` Cancel · Remove      |
 * | One, flagged, due within the range   | the flag clears     | `Still urgent: due …` Keep · Remove         |
 * | One, flagged, date outside / none    | the flag clears     | —                                          |
 * | One, not urgent at all               | nothing             | —                                          |
 * | Several                              | flags clear         | one prompt when any stays urgent by date   |
 *
 * Removing the due date is its own undo step; clearing flags is one too.
 */

export type UrgentTarget = Pick<TodoItem, 'title' | 'urgent' | 'dueDate' | 'isCompleted'>

/** The copy of a clearing-Urgent prompt. */
export interface ClearUrgentPrompt {
  title: string
  message: string
  /** Primary button: removes the due dates of `ClearUrgentPlan.dueSoon`. */
  confirmLabel: string
  /** Esc / secondary: keeps the dates. */
  cancelLabel: string
}

export interface ClearUrgentPlan<T extends UrgentTarget> {
  /** Targets whose urgent flag clears now. */
  clearFlag: T[]
  /** Targets that stay urgent because of their due date (the prompt offers to remove those dates). */
  dueSoon: T[]
  /** The question to ask afterwards, or null when nothing stays urgent. */
  prompt: ClearUrgentPrompt | null
}

/** `is due Tue 13, within 3 days` / `is due today` / `is overdue (due Thu 8)`. */
function isDuePhrase(dueDate: Date, today: Date, range: number): string {
  const days = daysUntil(dueDate, today) ?? 0
  if (days < 0) return `is overdue (due ${formatFollowupDay(dueDate, today)})`
  if (days === 0) return 'is due today'
  return `is due ${dueDatePhrase(dueDate, today)}, within ${range} ${range === 1 ? 'day' : 'days'}`
}

/** `it’s due Tue 13` / `it’s due today` / `it’s overdue (Thu 8)`. */
function itsDuePhrase(dueDate: Date, today: Date): string {
  const days = daysUntil(dueDate, today) ?? 0
  const phrase = dueDatePhrase(dueDate, today)
  return days < 0 ? `it’s ${phrase}` : `it’s due ${phrase}`
}

/** `today` / `Tue 13` / `overdue` — the date in the "Still urgent" title. */
function stillUrgentTitle(dueDate: Date, today: Date): string {
  const days = daysUntil(dueDate, today) ?? 0
  if (days < 0) return 'Still urgent: overdue'
  return `Still urgent: due ${dueDatePhrase(dueDate, today)}`
}

/** What clearing Urgent on `targets` does (pure; see the module comment). */
export function planClearUrgent<T extends UrgentTarget>(
  targets: readonly T[],
  today: Date,
  range: UrgentDueWithinDays,
): ClearUrgentPlan<T> {
  const clearFlag = targets.filter((t) => t.urgent === true)
  // After the flags clear, only the due date can keep a task urgent.
  const dueSoon = targets.filter((t) => isUrgentByDate(t, today, range))
  const only = targets.length === 1 ? targets[0] : undefined
  if (dueSoon.length === 0 || range == null) return { clearFlag, dueSoon, prompt: null }

  if (only && only.dueDate) {
    if (only.urgent !== true) {
      return {
        clearFlag,
        dueSoon,
        prompt: {
          title: 'Remove the due date?',
          message: `${only.title} ${isDuePhrase(only.dueDate, today, range)}, so it counts as urgent. Removing the due date makes it not urgent.`,
          confirmLabel: 'Remove due date',
          cancelLabel: 'Cancel',
        },
      }
    }
    return {
      clearFlag,
      dueSoon,
      prompt: {
        title: stillUrgentTitle(only.dueDate, today),
        message: `${only.title} is no longer flagged urgent, but ${itsDuePhrase(only.dueDate, today)}, so it still counts as urgent.`,
        confirmLabel: 'Remove due date',
        cancelLabel: 'Keep due date',
      },
    }
  }

  const k = dueSoon.length
  const one = k === 1
  return {
    clearFlag,
    dueSoon,
    prompt: {
      title: 'Still urgent: due soon',
      message: `${k} of ${targets.length} tasks ${one ? 'stays' : 'stay'} urgent because of ${one ? 'its due date' : 'their due dates'}.`,
      confirmLabel: one ? 'Remove its due date' : 'Remove their due dates',
      cancelLabel: one ? 'Keep due date' : 'Keep due dates',
    },
  }
}

/**
 * Asks a clearing-Urgent prompt through the app's confirm dialog (it stacks
 * above the task editor). `onRemoveDates` runs on the primary button.
 */
export function askClearUrgent(prompt: ClearUrgentPrompt, ids: number[], onRemoveDates: () => void): void {
  useUIStore.getState().showBulkConfirmation('custom', ids, {
    title: prompt.title,
    message: prompt.message,
    confirmLabel: prompt.confirmLabel,
    cancelLabel: prompt.cancelLabel,
    onConfirm: onRemoveDates,
  })
}

/**
 * Turns Urgent off on the stored tasks `ids`: clears their flags (one undo
 * step), then asks about the ones still urgent by their due date.
 */
export async function clearUrgent(ids: readonly number[]): Promise<void> {
  const idSet = new Set(ids)
  const targets = useTodoStore.getState().todos.filter((t) => idSet.has(t.id))
  if (targets.length === 0) return
  const plan = planClearUrgent(targets, startOfToday(), useSettingsStore.getState().urgentDueWithinDays)
  if (plan.clearFlag.length > 0) {
    await useTodoStore.getState().bulkSetUrgent(plan.clearFlag.map((t) => t.id), false)
  }
  if (plan.prompt) {
    const dateIds = plan.dueSoon.map((t) => t.id)
    askClearUrgent(plan.prompt, dateIds, () => { void useTodoStore.getState().bulkClearDueDate(dateIds) })
  }
}

/**
 * Sets Urgent on (flags every task) or off (`clearUrgent`) for `ids`. "On"
 * is the flag; "off" also deals with tasks urgent by their due date.
 */
export function setUrgent(ids: readonly number[], on: boolean): Promise<void> {
  if (on) return useTodoStore.getState().bulkSetUrgent([...ids], true)
  return clearUrgent(ids)
}
