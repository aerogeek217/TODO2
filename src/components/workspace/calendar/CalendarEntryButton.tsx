import { memo } from 'react'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { calendarEntryLevel, calendarEntryState, type CalendarEntry } from '../../../services/calendar-entries'
import { useSettingsStore } from '../../../stores/settings-store'
import { calendarEntryBar, calendarEntryTitle } from './calendar-entry-title'
import { AvatarStack } from '../../shared/AvatarStack'
import { TaskPillStatus } from '../../shared/TaskPillBar'
import { RepeatIcon } from '../../shared/icons'
import styles from './CalendarWidget.module.css'
import { TODO_ID_ATTR, TOOLTIP_BAR_ATTR, TOOLTIP_BAR_LABEL_ATTR } from '../../../utils/dom-contract'

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
 * occurrence of a recurring task) — a line, no fill, with a bar at its left
 * edge in its date type's colour (due magenta, follow-up yellow; flair P6,
 * E6) whose strength is how soon (`data-level`, the ladder a row date's bar
 * shares: faint later, full soon, heavier over a faint tint late). Repeat
 * glyph · title · meta (people + status at `md` / `touch`). Its tooltip is
 * the title beside the same bar, the date type's colour. Click opens the
 * task.
 */
export const CalendarEntryButton = memo(function CalendarEntryButton({
  entry, today, size, wrap = false, onOpen, dragging = false, ghost = false,
  dragRef, dragAttributes, dragListeners,
}: CalendarEntryButtonProps) {
  const { todo } = entry
  const state = calendarEntryState(entry, today)
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const showMeta = size !== 'sm'
  const bar = calendarEntryBar(entry)
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
      data-level={calendarEntryLevel(entry, today, range)}
      {...{ [TODO_ID_ATTR]: todo.id }}
      data-virtual={entry.isVirtual ? 'true' : undefined}
      data-tooltip={ghost ? undefined : calendarEntryTitle(entry, today)}
      {...(ghost ? {} : { [TOOLTIP_BAR_ATTR]: bar.color, [TOOLTIP_BAR_LABEL_ATTR]: bar.label })}
      onClick={(e) => {
        e.stopPropagation()
        onOpen?.(todo.id)
      }}
      {...(dragAttributes ?? {})}
      {...(dragListeners ?? {})}
      {...(ghost ? { tabIndex: -1 } : {})}
    >
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
