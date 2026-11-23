import type { ReactNode } from 'react'
import { type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel } from '../../../utils/calendar-grid'
import { TaskDraggable } from '../../task/dnd/TaskDraggable'
import { PlusIcon } from '../../shared/icons'
import { CalendarEntryButton, type CalendarEntrySize } from './CalendarEntryButton'
import { type CalendarEntryDragData } from './calendar-drag'
import styles from './CalendarWidget.module.css'
import { type DayContext, dropLabel } from './calendar-day'

/** The parts every calendar day draws: the drop label, its date, an entry, the `+N more` button. */

export function DropLabel({ ctx, day }: { ctx: DayContext; day: Date }) {
  return (
    <span className={styles.dropLabel} aria-hidden="true">
      <PlusIcon size={12} strokeWidth={2} /> {dropLabel(ctx.drag, ctx.dateTypes, day, ctx.today)}
    </span>
  )
}

/**
 * One entry, draggable unless it's a recurring occurrence, a completed
 * task's plan (the Planner plans open tasks only) or on mobile.
 */
export function EntryItem({ entry, size, wrap = false, slot, ctx }: {
  entry: CalendarEntry
  size: CalendarEntrySize
  wrap?: boolean
  /** Drag id slot; defaults to the entry's date type. */
  slot?: string
  ctx: DayContext
}) {
  if (entry.isVirtual || ctx.noDrag || (entry.kind === 'plan' && entry.todo.isCompleted)) {
    return <CalendarEntryButton entry={entry} today={ctx.today} size={size} wrap={wrap} onOpen={ctx.onOpen} />
  }
  const data: CalendarEntryDragData = {
    calendarDateType: entry.kind,
    calendarEntry: { entry, size, wrap, today: ctx.today },
  }
  return (
    <TaskDraggable
      todo={entry.todo}
      surface="calendar-widget"
      scope={ctx.tabId}
      sectionKey={slot ?? entry.kind}
      extraData={{ ...data }}
    >
      {({ setNodeRef, attributes, listeners, isDragging }) => (
        <CalendarEntryButton
          entry={entry}
          today={ctx.today}
          size={size}
          wrap={wrap}
          onOpen={ctx.onOpen}
          dragging={isDragging}
          dragRef={setNodeRef}
          dragAttributes={attributes}
          dragListeners={listeners}
        />
      )}
    </TaskDraggable>
  )
}

/**
 * A day's date (a month cell's number, a week row's or column's weekday and
 * date): while the day has entries a button that opens the day popover over
 * the day, as `+N more` does; else plain text.
 */
export function DayDate({ day, count, open, onMore, className, label, children }: {
  day: Date
  /** The day's entries. */
  count: number
  open: boolean
  onMore?: (day: Date, cell: HTMLElement) => void
  /** A CSS module class (`styles.dayNumber`, …); undefined only where the module lacks it. */
  className: string | undefined
  /** The plain date's accessible name (a week date's: the day in words). */
  label?: string
  children: ReactNode
}) {
  if (!onMore || count === 0) return <div className={className} aria-label={label}>{children}</div>
  const words = `${dayLabel(day)}: ${count} ${count === 1 ? 'task' : 'tasks'}`
  return (
    <button
      type="button"
      className={`${className ?? ''} ${styles.dayDate} ${open ? styles.dayDateOpen : ''}`}
      aria-label={words}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-day-date=""
      data-tooltip={`Show the ${count === 1 ? 'task' : `${count} tasks`}`}
      onClick={(e) => {
        const cell = e.currentTarget.closest<HTMLElement>('[data-day]')
        if (cell) onMore(day, cell)
      }}
    >
      {children}
    </button>
  )
}

/** `+N more` in a day's last slot: opens the day popover over the day. */
export function MoreButton({ day, more, open, onMore, md }: {
  day: Date
  more: number
  open: boolean
  onMore: (day: Date, cell: HTMLElement) => void
  /** Week rows: a 24px slot. */
  md?: boolean
}) {
  return (
    <button
      type="button"
      className={`${styles.more} ${md ? styles.moreMd : ''} ${open ? styles.moreOpen : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => {
        const cell = e.currentTarget.closest<HTMLElement>('[data-day]')
        if (cell) onMore(day, cell)
      }}
    >
      +{more} more
    </button>
  )
}
