import type { PersistedTodoItem } from '../models'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { countActiveFilters } from '../utils/filter-criteria'
import { todoNameLookups } from '../utils/filter'
import { applyFilter } from '../utils/filter-match'
import { statsFilter } from './stats/stats-context'
import { currentTaskDialogEnv } from './task-dialog'

/**
 * Today's writes to the Focus marker (D25 L): its suggestions' **+**
 * (`pickForToday`) and **Clear Focus…** (`clearFocus`).
 */

/** Puts a suggested task in Focus: one undo step, with the snackbar. Activity on the task, as every priority flag: it stamps `modifiedAt`. */
export function pickForToday(todo: Pick<PersistedTodoItem, 'id' | 'title'>): Promise<void> {
  return useTodoStore.getState().setMarkerFlags([{ todoId: todo.id, focus: true }], `Added “${todo.title}” to Focus`)
}

/**
 * **Clear Focus…**: the end of the day's reset of the
 * Focus marker. Completing a task leaves its Focus on, so the Focus tasks
 * are open ones (today's leftovers) and done ones. The prompt offers to
 * keep the open ones for tomorrow — only the done ones leave Focus — or to
 * clear all of them. Either is one undo step, with the undo snackbar.
 *
 * It acts on the tasks the screen filter keeps, as Today shows them: a
 * Focus task the top bar hides keeps its Focus.
 */

/** The Focus tasks the screen filter keeps now, open and done. */
export function screenFocusTasks(): { open: PersistedTodoItem[]; done: PersistedTodoItem[]; filtered: boolean } {
  const env = currentTaskDialogEnv()
  const settings = { ...env.markerSettings, weekStartsOn: env.weekStartsOn }
  const shown = applyFilter(statsFilter(env.screen), env.todos, todoNameLookups(env), env.today, settings)
  const focus = shown.filter((t) => t.focus === true)
  return {
    open: focus.filter((t) => !t.isCompleted),
    done: focus.filter((t) => t.isCompleted),
    filtered: countActiveFilters({ ...env.screen, showCompleted: false }) > 0,
  }
}

const tasks = (n: number) => (n === 1 ? '1 task' : `${n} tasks`)

/**
 * Takes Focus off `ids`, one undo step. Housekeeping, not activity on the
 * tasks: no `modifiedAt` moves (the stale fade, the Modified filter and the
 * Neglect map's days untouched stay as they were).
 */
function unfocus(ids: readonly PersistedTodoItem[], description: string): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return useTodoStore.getState().setMarkerFlags(ids.map((t) => ({ todoId: t.id, focus: false })), description, { stamp: false })
}

/**
 * Asks, then clears: with open Focus tasks, **Keep the N open ones for
 * tomorrow** (the done ones leave Focus; nothing else changes) or **Clear
 * all**; with only done ones, whether to clear them. Nothing in Focus asks
 * nothing.
 */
export async function clearFocus(): Promise<void> {
  const { open, done, filtered } = screenFocusTasks()
  if (open.length === 0 && done.length === 0) return
  const only = filtered ? ' Only the tasks the top bar’s filter shows are changed.' : ''
  const ui = useUIStore.getState()
  if (open.length === 0) {
    const ok = await ui.askConfirmation({
      title: 'Clear Focus?',
      message: `${tasks(done.length)} in Focus ${done.length === 1 ? 'is' : 'are'} done. Clearing takes them out of Focus.${only}`,
      confirmLabel: 'Clear Focus',
    })
    if (ok) await unfocus(done, `Cleared Focus from ${tasks(done.length)}`)
    return
  }
  const doneNote = done.length === 0 ? '' : ` and ${done.length} done`
  const keepWhat = open.length === 1 ? 'Keep the open one for tomorrow' : `Keep the ${open.length} open ones for tomorrow`
  const answer = await ui.askChoice({
    title: 'Clear Focus?',
    message: `Focus holds ${open.length} open${doneNote} ${open.length + done.length === 1 ? 'task' : 'tasks'}. `
      + `Keep the open ones for tomorrow${done.length > 0 ? ' (the done ones leave Focus)' : ''}, or clear all of them.${only}`,
    confirmLabel: keepWhat,
    discardLabel: 'Clear all',
  })
  if (answer === 'confirm') await unfocus(done, `Cleared Focus from ${done.length === 1 ? '1 done task' : `${done.length} done tasks`}`)
  else if (answer === 'discard') await unfocus([...open, ...done], `Cleared Focus from ${tasks(open.length + done.length)}`)
}
