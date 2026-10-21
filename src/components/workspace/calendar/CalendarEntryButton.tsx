import { memo } from 'react'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { calendarEntryState, type CalendarEntry } from '../../../services/calendar-entries'
import { calendarEntryTitle } from './calendar-entry-title'
import { AvatarStack } from '../../shared/AvatarStack'
import { TaskPillStatus } from '../../shared/TaskPillBar'
import { FlagIcon, RepeatIcon, WidgetKindIcon } from '../../shared/icons'
import styles from './CalendarWidget.module.css'
import { TODO_ID_ATTR } from '../../../utils/dom-contract'

/** Entry sizes: `sm` month cells, `md` week / day list / day popover, `touch` mobile day list. */
export type CalendarEntrySize = 'sm' | 'md' | 'touch'

interface CalendarEntryButtonProps {
  entry: CalendarEntry
  today: Date
  size: CalendarEntrySize
  /** Week columns: the title wraps to two lines; avatars only. */
  wrap?: boolean
  onOpen?: (todoId: number) => void
  /** The origin of a drag of this entry (faded). */
  dragging?: boolean
  /** Rendered in the drag overlay. */
  ghost?: boolean
  dragRef?: (node: HTMLElement | null) => void
  dragAttributes?: DraggableAttributes
  dragListeners?: DraggableSyntheticListeners
}

/**
 * One calendar entry: a task's due date or next follow-up on a day (or an
 * occurrence of a recurring task). Type glyph · repeat glyph · title · meta
 * (people + status at `md` / `touch`). Click opens the task.
 */
export const CalendarEntryButton = memo(function CalendarEntryButton({
  entry, today, size, wrap = false, onOpen, dragging = false, ghost = false,
  dragRef, dragAttributes, dragListeners,
}: CalendarEntryButtonProps) {
  const { todo } = entry
  const state = calendarEntryState(entry, today)
  const showMeta = size !== 'sm'
  const cls = [
    styles.entry,
    size === 'md' ? styles.entryMd : size === 'touch' ? styles.entryTouch : '',
    wrap ? styles.entryWrap : '',
    entry.isVirtual ? styles.entryVirtual : '',
    todo.isCompleted ? styles.entryCompleted : '',
    dragging ? styles.entryDragging : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      ref={dragRef}
      type="button"
      className={cls}
      data-cal-entry={entry.kind}
      data-state={state}
      {...{ [TODO_ID_ATTR]: todo.id }}
      data-virtual={entry.isVirtual ? 'true' : undefined}
      title={ghost ? undefined : calendarEntryTitle(entry, today)}
      onClick={(e) => {
        e.stopPropagation()
        onOpen?.(todo.id)
      }}
      {...(dragAttributes ?? {})}
      {...(dragListeners ?? {})}
      {...(ghost ? { tabIndex: -1 } : {})}
    >
      <span className={styles.entryGlyph}>
        {entry.kind === 'due' ? <WidgetKindIcon kind="calendar" size={12} /> : <FlagIcon size={12} />}
      </span>
      {todo.recurrenceRule && entry.kind === 'due' && (
        <span className={styles.entryRepeat}><RepeatIcon size={10} /></span>
      )}
      <span className={styles.entryTitle}>{todo.title}</span>
      {showMeta && (entry.people.length > 0 || (!wrap && entry.status)) && (
        <span className={styles.entryMeta}>
          {entry.people.length > 0 && <AvatarStack people={entry.people} max={2} size="sm" readOnly />}
          {!wrap && entry.status && <TaskPillStatus status={entry.status} interactive={false} />}
        </span>
      )}
    </button>
  )
})
