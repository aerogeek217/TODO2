import { type CalendarEntry } from '../../../services/calendar-entries'
import { TaskDraggable } from '../../task/dnd/TaskDraggable'
import { PlusIcon } from '../../shared/icons'
import { CalendarEntryButton, type CalendarEntrySize } from './CalendarEntryButton'
import { type CalendarEntryDragData } from './calendar-drag'
import styles from './CalendarWidget.module.css'
import { type DayContext, dropLabel } from './calendar-day'

/** The parts every calendar day draws: the drop label, an entry, the `+N more` button. */

export function DropLabel({ ctx }: { ctx: DayContext }) {
  return (
    <span className={styles.dropLabel} aria-hidden="true">
      <PlusIcon size={12} strokeWidth={2} /> {dropLabel(ctx.drag, ctx.dateTypes)}
    </span>
  )
}

/** One entry, draggable unless it's a recurring occurrence (or on mobile). */
export function EntryItem({ entry, size, wrap = false, slot, ctx }: {
  entry: CalendarEntry
  size: CalendarEntrySize
  wrap?: boolean
  /** Drag id slot; defaults to the entry's date type. */
  slot?: string
  ctx: DayContext
}) {
  if (entry.isVirtual || ctx.noDrag) {
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
