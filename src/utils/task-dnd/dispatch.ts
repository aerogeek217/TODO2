import type { DragEndEvent } from '@dnd-kit/core'
import type { PersistedTodoItem } from '../../models'
import { shownCalendarDateTypes, type CalendarDateType, type CalendarDateTypes } from '../../models/workspace-layout'
import { dndLog } from '../debug-flags'
import type { PlannerSpan, PlannerTarget } from '../planner'
import { TASK_DROP_KIND } from './kinds'

/** A list drag dropped on a day of a calendar showing more than one date type. */
export interface CalendarDropChoiceRequest {
  todo: PersistedTodoItem
  /** Midnight of the day dropped on. */
  date: Date
  /** The date types the calendar shows: the ones to choose from. */
  dateTypes: CalendarDateTypes
  /** The day's calendar (its droppable `scope`). */
  scope: string | undefined
  /** Where the pointer was let go (viewport), when known. */
  at: { x: number; y: number } | null
}

/**
 * Calendar side of {@link dispatchTaskDrop}. Callers supply the store
 * plumbing (typically `useTodoStore` + `buildRescheduleUpdate`).
 */
interface CalendarOps {
  /**
   * Moves the task's `type` date to `targetDate`'s day — for a plan, plans it
   * for that day outright (the plan write).
   */
  reschedule: (todoId: number, targetDate: Date, type: CalendarDateType) => Promise<void>
  /**
   * Asks which date to set when the target calendar shows more than one type
   * and the drag isn't a calendar entry (which always moves its own date).
   * Resolves `null` when the user cancels: nothing changes. Without it, the
   * first type shown is set.
   */
  chooseType?: (request: CalendarDropChoiceRequest) => Promise<CalendarDateType | null>
}

/** A Planner group as its droppable describes it: what the hand order is written over. */
interface PlannerDropGroup {
  /** The group's key (`PlannerGroup.key`). */
  key: string
  /** Its tasks as it shows them: their `uid`s. */
  rows: readonly string[]
  /** Every task the Planner shows, in display order: their `uid`s. */
  shown: readonly string[]
}

/** The drop data of a Planner's day tile or group (`TASK_DROP_KIND.plannerDay` / `.plannerGroup`). */
export interface PlannerDropData {
  type: typeof TASK_DROP_KIND.plannerDay | typeof TASK_DROP_KIND.plannerGroup
  /** The Planner's tab id. */
  scope: string
  /** The day it stands for (Today's group and today's tile: today), or a tray (Unplanned, Delayed). */
  target: PlannerTarget
  /** The Planner's window as it shows: today and its last day — what a task's placement is read against. */
  window: PlannerSpan
  /** A group's rows; absent on a tile. */
  group?: PlannerDropGroup
}

/** A task dropped on a Planner's tile or group. */
export interface PlannerDropRequest {
  todo: PersistedTodoItem
  /** The Planner's tab id. */
  tabId: string
  target: PlannerTarget
  window: PlannerSpan
  /** The group dropped into; null for a tile. */
  group: PlannerDropGroup | null
}

/** Planner side of {@link dispatchTaskDrop}. */
interface PlannerOps {
  /**
   * Makes the drop: the one write the Planner's rule decides for the task
   * (its plan state: a planned day, cleared — or nothing; never a real
   * date) and its place in the hand order. Called
   * once per drop.
   */
  drop: (request: PlannerDropRequest) => Promise<void> | void
}

interface TaskDropDispatchDeps {
  /** Optional — required by surfaces that host calendar day droppables (the
   * workspace). When omitted, calendar-day drops fall through to the
   * caller's own handler. */
  calendar?: CalendarOps
  /** Optional — required by surfaces that host Planner tiles and groups (the workspace). */
  planner?: PlannerOps
}

const isUids = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every((u) => typeof u === 'string')

function isPlannerTarget(v: unknown): v is PlannerTarget {
  if (v == null || typeof v !== 'object') return false
  const t = v as { kind?: unknown; day?: unknown }
  return t.kind === 'unplanned' || t.kind === 'delayed' || (t.kind === 'day' && t.day instanceof Date)
}

/** Whether a droppable's data is a Planner tile's or group's. */
export function isPlannerDropData(v: unknown): v is PlannerDropData {
  if (v == null || typeof v !== 'object') return false
  const d = v as Partial<Record<keyof PlannerDropData, unknown>>
  if (d.type !== TASK_DROP_KIND.plannerDay && d.type !== TASK_DROP_KIND.plannerGroup) return false
  const w = d.window as { today?: unknown; last?: unknown } | undefined
  if (typeof d.scope !== 'string' || !isPlannerTarget(d.target) || !(w?.today instanceof Date) || !(w.last instanceof Date)) return false
  if (d.type === TASK_DROP_KIND.plannerDay) return true
  const g = d.group as Partial<PlannerDropGroup> | undefined
  return g != null && typeof g.key === 'string' && isUids(g.rows) && isUids(g.shown)
}

function isDateType(v: unknown): v is CalendarDateType {
  return v === 'due' || v === 'followup' || v === 'plan'
}

/**
 * Which date a calendar-day drop sets, from the drag payload and the date
 * types the target calendar shows (`dateTypes` on the day's drop data):
 * - a calendar showing no date type takes no drop (`null`);
 * - a calendar entry (`calendarDateType` on the drag) moves its own date —
 *   a plan entry its plan —, whatever the target calendar shows;
 * - otherwise the date type the target shows, or `'choose'` when it shows
 *   more than one.
 */
export function resolveCalendarDropType(
  activeData: Record<string, unknown> | null | undefined,
  dateTypes: CalendarDateTypes,
): CalendarDateType | 'choose' | null {
  const shown = shownCalendarDateTypes(dateTypes)
  if (shown.length === 0) return null
  const own = activeData?.calendarDateType
  if (isDateType(own)) return own
  if (shown.length > 1) return 'choose'
  return shown[0] ?? null
}

function isDateTypes(v: unknown): v is CalendarDateTypes {
  if (v == null || typeof v !== 'object') return false
  const t = v as Record<string, unknown>
  return typeof t.due === 'boolean' && typeof t.followup === 'boolean' && typeof t.plan === 'boolean'
}

/** The viewport point a drag ended at (activator position + travel), when the activator was a pointer. */
function dropPoint(event: DragEndEvent): { x: number; y: number } | null {
  const e = event.activatorEvent as { clientX?: unknown; clientY?: unknown } | null
  if (!e || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return null
  return { x: e.clientX + event.delta.x, y: e.clientY + event.delta.y }
}

/**
 * Shared drop dispatcher for task-shaped drags that land on a shared drop
 * target: a task dropped on a calendar day gets that day as its due date,
 * next follow-up or planned day (see {@link resolveCalendarDropType}); one dropped on a
 * Planner's day tile or group — a row of that Planner, of a list, a
 * calendar entry — is handed to the Planner's one drop (`deps.planner.drop`,
 * once: no chooser, only the task's plan, never a due date or a follow-up).
 *
 * Returns `true` when the drop was handled (the caller should stop
 * processing — also when the user cancelled the date-type choice or the
 * calendar shows no date type), `false`
 * when the drop is not on one.
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
    const dateTypes = overData.dateTypes
    if (date instanceof Date && isDateTypes(dateTypes)) {
      let type = resolveCalendarDropType(activeData, dateTypes)
      if (type === null) {
        dndLog('dispatch.calendar-day-refused', { todoId: activeTodo.id, date: date.toISOString() })
        return true
      }
      if (type === 'choose') {
        const chosen = deps.calendar.chooseType
          ? await deps.calendar.chooseType({
            todo: activeTodo,
            date,
            dateTypes,
            scope: typeof overData.scope === 'string' ? overData.scope : undefined,
            at: dropPoint(event),
          })
          : shownCalendarDateTypes(dateTypes)[0] ?? null
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

  // ── Planner tile or group → the Planner's one drop ──
  if (isPlannerDropData(overData) && deps.planner) {
    dndLog('dispatch.planner', { todoId: activeTodo.id, tabId: overData.scope, type: overData.type })
    await deps.planner.drop({
      todo: activeTodo,
      tabId: overData.scope,
      target: overData.target,
      window: overData.window,
      group: overData.group ?? null,
    })
    return true
  }

  dndLog('dispatch.unhandled', {
    todoId: activeTodo.id,
    activeType: activeData?.type ?? null,
    overType: overData?.type ?? null,
    overId: over?.id ?? null,
  })
  return false
}
