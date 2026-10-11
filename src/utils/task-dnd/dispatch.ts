import type { DragEndEvent } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../models'
import { dndLog } from '../debug-flags'
import { TASK_DROP_KIND } from './kinds'

/**
 * Narrow reschedule surface consumed by the calendar-day branch of
 * {@link dispatchTaskDrop}. Callers supply whatever store plumbing they want
 * (typically `useTodoStore` + `buildRescheduleUpdate`); the dispatch only
 * cares about the single callback.
 */
export interface CalendarOps {
  reschedule: (todoId: number, targetDate: Date) => Promise<void>
}

export interface TaskDropDispatchDeps {
  /** Optional — required by surfaces that host calendar day droppables
   * (canvas rails/floating strips, the `/calendar` route, the workspace).
   * When omitted, calendar-day drops fall through to the caller's own
   * handler. */
  calendar?: CalendarOps
}

/**
 * Shared drop dispatcher for task-shaped drags that land on a shared drop
 * target: a task dropped on a calendar day is rescheduled to that day.
 *
 * Returns `true` when the drop was handled (the caller should stop
 * processing), `false` when the drop is not one of these targets (the caller
 * continues with its route-specific logic — e.g. canvas project placement).
 */
export async function dispatchTaskDrop(
  event: DragEndEvent,
  deps: TaskDropDispatchDeps,
): Promise<boolean> {
  const { active, over } = event
  const activeTodo = active.data.current?.todo as PersistedTodoItem | undefined
  if (!activeTodo) {
    dndLog('dispatch.no-active-todo', { activeId: active.id, overId: over?.id ?? null })
    return false
  }

  const overData = over?.data.current

  // ── Calendar day drop → reschedule ──
  if (overData?.type === TASK_DROP_KIND.calendarDay && deps.calendar) {
    const date = overData.date as Date | undefined
    if (date instanceof Date) {
      dndLog('dispatch.calendar-day-reschedule', { todoId: activeTodo.id, date: date.toISOString() })
      await deps.calendar.reschedule(activeTodo.id, date)
      return true
    }
  }

  dndLog('dispatch.unhandled', {
    todoId: activeTodo.id,
    activeType: active.data.current?.type ?? null,
    overType: overData?.type ?? null,
    overId: over?.id ?? null,
  })
  return false
}
