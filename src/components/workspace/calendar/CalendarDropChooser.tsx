import { useMemo } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { CalendarDateType } from '../../../models/workspace-layout'
import { dayLabel, shortDayLabel } from '../../../utils/calendar-grid'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { FlagIcon, WidgetKindIcon } from '../icons'
import styles from './CalendarWidget.module.css'

interface CalendarDropChooserProps {
  todo: PersistedTodoItem
  /** The day dropped on. */
  date: Date
  /** Where the pointer was let go (viewport). */
  at: { x: number; y: number }
  /** The picked date type, or `null` when cancelled (Esc, click outside). */
  onDone: (type: CalendarDateType | null) => void
}

/** `was Thu 15` (`was Thu 15 Nov` in another month than `target`) or `not set`. */
function currentValue(value: Date | undefined, target: Date): string {
  if (!value) return 'not set'
  const d = new Date(value)
  const sameMonth = d.getMonth() === target.getMonth() && d.getFullYear() === target.getFullYear()
  return `was ${sameMonth ? shortDayLabel(d) : dayLabel(d)}`
}

/**
 * Asked when a task from a list lands on a day of a calendar showing both
 * date types: set its due date or its next follow-up. ↑↓ / Enter / D / F /
 * click pick; Esc or a click outside cancels with no change.
 */
export function CalendarDropChooser({ todo, date, at, onDone }: CalendarDropChooserProps) {
  const entries = useMemo<MenuEntry[]>(() => [
    { kind: 'label', text: `Set “${todo.title}” for ${dayLabel(date)}` },
    {
      kind: 'item',
      label: 'Due date',
      icon: <span className={styles.chooserDue}><WidgetKindIcon kind="calendar" size={14} /></span>,
      note: currentValue(todo.dueDate, date),
      shortcut: 'D',
      onSelect: () => onDone('due'),
    },
    {
      kind: 'item',
      label: 'Follow-up',
      icon: <span className={styles.chooserFollowup}><FlagIcon size={14} /></span>,
      note: currentValue(todo.nextFollowupAt, date),
      shortcut: 'F',
      onSelect: () => onDone('followup'),
    },
  ], [todo, date, onDone])

  return (
    <MenuPopover
      point={{ x: at.x + 2, y: at.y + 10 }}
      entries={entries}
      label="Set which date"
      width={252}
      onClose={() => onDone(null)}
    />
  )
}
