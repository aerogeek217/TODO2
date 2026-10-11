import type { DragEndEvent } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../models'
import type { CalendarDateType, CalendarDateTypes } from '../../models/workspace-layout'
import { dndLog } from '../debug-flags'
import { TASK_DROP_KIND } from './kinds'

/** A list drag dropped on a day of a calendar showing both date types. */
export interface CalendarDropChoiceRequest {
  todo: PersistedTodoItem
  /** Midnight of the day dropped on. */
  date: Date
  /** The day's calendar (its droppable `scope`). */
  scope: string | undefined
  /** Where the pointer was let go (viewport), when known. */
  at: { x: number; y: number } | null
}

/**
 * Calendar side of {@link dispatchTaskDrop}. Callers supply the store
 * plumbing (typically `useTodoStore` + `buildRescheduleUpdate`).
 */
export interface CalendarOps {
  /** Moves the task's `type` date to `targetDate`'s day. */
  reschedule: (todoId: number, targetDate: Date, type: CalendarDateType) => Promise<void>
  /**
   * Asks which date to set when the target calendar shows both types and the
   * drag isn't a calendar entry (which always moves its own date). Resolves
   * `null` when the user cancels: nothing changes. Without it, the due date
   * is set.
   */
  chooseType?: (request: CalendarDropChoiceRequest) => Promise<CalendarDateType | null>
}

export interface TaskDropDispatchDeps {
  /** Optional — required by surfaces that host calendar day droppables (the
   * workspace). When omitted, calendar-day drops fall through to the
   * caller's own handler. */
  calendar?: CalendarOps
}

function isDateType(v: unknown): v is CalendarDateType {
  return v === 'due' || v === 'followup'
}

/**
 * Which date a calendar-day drop sets, from the drag payload and the day's
 * drop data:
 * - a calendar entry (`calendarDateType` on the drag) moves its own date,
 *   whatever the target calendar shows;
 * - otherwise the date type the target shows (`dateTypes` on the day), or
 *   `'choose'` when it shows both;
 * - a day without `dateTypes` (calendars that only show due dates) sets the due date.
 */
export function resolveCalendarDropType(
  activeData: Record<string, unknown> | null | undefined,
  overData: Record<string, unknown> | null | undefined,
): CalendarDateType | 'choose' {
  const own = activeData?.calendarDateType
  if (isDateType(own)) return own
  const types = overData?.dateTypes as CalendarDateTypes | undefined
  if (types?.due && types.followup) return 'choose'
  if (types?.followup && !types.due) return 'followup'
  return 'due'
}

/** The viewport point a drag ended at (activator position + travel), when the activator was a pointer. */
function dropPoint(event: DragEndEvent): { x: number; y: number } | null {
  const e = event.activatorEvent as { clientX?: unknown; clientY?: unknown } | null
  if (!e || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return null
  return { x: e.clientX + event.delta.x, y: e.clientY + event.delta.y }
}

/**
 * Shared drop dispatcher for task-shaped drags that land on a shared drop
 * target: a task dropped on a calendar day gets that day as its due date or
 * next follow-up (see {@link resolveCalendarDropType}).
 *
 * Returns `true` when the drop was handled (the caller should stop
 * processing — also when the user cancelled the date-type choice), `false`
 * when the drop is not one of these targets.
 */
export async function dispatchTaskDrop(
  event: DragEndEvent,
  deps: TaskDropDispatchDeps,
): Promise<boolean> {
  const { active, over } = event
  const activeData = active.data.current
  const activeTodo = activeData?.todo as PersistedTodoItem | undefined
  if (!activeTodo) {
    dndLog('dispatch.no-active-todo', { activeId: active.id, overId: over?.id ?? null })
    return false
  }

  const overData = over?.data.current

  // ── Calendar day drop → set a date ──
  if (overData?.type === TASK_DROP_KIND.calendarDay && deps.calendar) {
    const date = overData.date as Date | undefined
    if (date instanceof Date) {
      let type = resolveCalendarDropType(activeData, overData)
      if (type === 'choose') {
        const chosen = deps.calendar.chooseType
          ? await deps.calendar.chooseType({
            todo: activeTodo,
            date,
            scope: typeof overData.scope === 'string' ? overData.scope : undefined,
            at: dropPoint(event),
          })
          : 'due'
        if (chosen == null) {
          dndLog('dispatch.calendar-day-cancelled', { todoId: activeTodo.id, date: date.toISOString() })
          return true
        }
        type = chosen
      }
      dndLog('dispatch.calendar-day-reschedule', { todoId: activeTodo.id, date: date.toISOString(), type })
      await deps.calendar.reschedule(activeTodo.id, date, type)
      return true
    }
  }

  dndLog('dispatch.unhandled', {
    todoId: activeTodo.id,
    activeType: activeData?.type ?? null,
    overType: overData?.type ?? null,
    overId: over?.id ?? null,
  })
  return false
}
