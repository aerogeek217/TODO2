import { useState } from 'react'
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { shownCalendarDateTypes, type CalendarDateType, type CalendarDateTypes } from '../../../models/workspace-layout'
import { dayOverdueWash, type CalendarEntry } from '../../../services/calendar-entries'
import { TASK_DROP_KIND, calendarDayDropId } from '../../../utils/task-dnd'
import { isCalendarEntryDragData } from './calendar-drag'
import styles from './CalendarWidget.module.css'

/**
 * The calendar widget's day helpers (cr31 A7 split `CalendarWidget`): what a
 * day knows (`DayContext`), the task drag in progress, a day as a drop
 * target, its classes and its overdue wash.
 */

/** Month grid: bottom padding and row gap (px), for the cell-height fit. */
export const MONTH_GRID_PAD = 6
export const MONTH_GRID_GAP = 2
/** The heat map's legend under the month grid (px; `.heatLegend`'s height). */
export const MONTH_LEGEND_HEIGHT = 20

export type CalendarMode = 'month' | 'compact' | 'rows' | 'columns'

/** A task drag in progress anywhere in the workspace. */
interface TaskDragInfo {
  /** A calendar entry (moves its own date), not a list row. */
  entryMove: boolean
  /** The date type a calendar entry moves; absent for a list row. */
  type?: CalendarDateType
}

/** What a day shared by every layout needs. */
export interface DayContext {
  tabId: string
  scope: string
  dateTypes: CalendarDateTypes
  today: Date
  drag: TaskDragInfo | null
  /** The day the Due / Follow-up chooser is open for, in ms. */
  pendingMs: number | null
  /** Mobile: nothing drags. */
  noDrag: boolean
  onOpen: (todoId: number) => void
}

export function useTaskDrag(): TaskDragInfo | null {
  const [drag, setDrag] = useState<TaskDragInfo | null>(null)
  useDndMonitor({
    onDragStart(event) {
      const data = event.active.data.current
      if (!data || data.todo == null) return
      setDrag(isCalendarEntryDragData(data) ? { entryMove: true, type: data.calendarDateType } : { entryMove: false })
    },
    onDragEnd() { setDrag(null) },
    onDragCancel() { setDrag(null) },
  })
  return drag
}

const SET_LABEL: Record<CalendarDateType, string> = { due: 'Set due', followup: 'Set follow-up', plan: 'Set plan' }

/**
 * The hovered day's label: what a drop there does — `Move here` (an entry),
 * `Set date` (a list row onto a calendar showing more than one type: the
 * chooser asks), `Set due` / `Set follow-up` / `Set plan`; `Past day` where
 * a plan would land before today (refused, as the Planner refuses it).
 */
export function dropLabel(drag: TaskDragInfo | null, types: CalendarDateTypes, day: Date, today: Date): string {
  const shown = shownCalendarDateTypes(types)
  const type = drag?.entryMove ? drag.type : shown.length === 1 ? shown[0] : undefined
  if (type === 'plan' && day.getTime() < today.getTime()) return 'Past day'
  if (drag?.entryMove) return 'Move here'
  return type ? SET_LABEL[type] : 'Set date'
}

/** A day as a drop target: dropping a task sets (or moves) one of its dates to the day. */
export function useDayTarget(ctx: DayContext, day: Date) {
  const { setNodeRef, isOver } = useDroppable({
    id: calendarDayDropId(ctx.scope, day.getTime()),
    // A calendar showing no date type takes no drop.
    disabled: shownCalendarDateTypes(ctx.dateTypes).length === 0,
    data: { type: TASK_DROP_KIND.calendarDay, date: day, scope: ctx.scope, dateTypes: ctx.dateTypes },
  })
  const highlighted = isOver || ctx.pendingMs === day.getTime()
  return { setNodeRef, highlighted }
}

export function dayClasses(base: string | undefined, ctx: DayContext, highlighted: boolean, extra: Array<string | false | undefined>): string {
  return [
    base,
    ctx.drag ? styles.dayDragTarget : '',
    highlighted ? styles.dayOver : '',
    ...extra,
  ].filter(Boolean).join(' ')
}

/** The compact month's past-day wash: its dots don't say what is late (month and week entries' ticks do). */
export function washClass(entries: readonly CalendarEntry[], day: Date, today: Date): string | false {
  if (day.getTime() >= today.getTime()) return false
  const wash = dayOverdueWash(entries, today)
  return wash === 'due' ? (styles.washDue ?? false) : wash === 'followup' ? (styles.washFollowup ?? false) : false
}
