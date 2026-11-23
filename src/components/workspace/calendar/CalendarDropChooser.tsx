import { useMemo, type ReactNode } from 'react'
import type { PersistedTodoItem } from '../../../models'
import { shownCalendarDateTypes, type CalendarDateType, type CalendarDateTypes } from '../../../models/workspace-layout'
import { dayLabel, shortDayLabel } from '../../../utils/calendar-grid'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import { FlagIcon, WidgetKindIcon } from '../../shared/icons'
import styles from './CalendarWidget.module.css'

interface CalendarDropChooserProps {
  todo: PersistedTodoItem
  /** The day dropped on. */
  date: Date
  /** The date types the calendar shows: one item each. */
  dateTypes: CalendarDateTypes
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

/** Each type's item: its name, icon, shortcut and the task's value now. */
function typeItem(type: CalendarDateType, todo: PersistedTodoItem, date: Date): { label: string; icon: ReactNode; note: string; shortcut: string } {
  switch (type) {
    case 'due':
      return { label: 'Due date', icon: <span className={styles.chooserDue}><WidgetKindIcon kind="calendar" size={14} /></span>, note: currentValue(todo.dueDate, date), shortcut: 'D' }
    case 'followup':
      return { label: 'Follow-up', icon: <span className={styles.chooserFollowup}><FlagIcon size={14} /></span>, note: currentValue(todo.nextFollowupAt, date), shortcut: 'F' }
    case 'plan':
      return {
        label: 'Plan',
        icon: <span className={styles.chooserPlan}><span className={styles.planBar} /></span>,
        note: todo.unplanned ? 'held in Unplanned' : currentValue(todo.doDate, date),
        shortcut: 'P',
      }
  }
}

/**
 * Asked when a task from a list lands on a day of a calendar showing more
 * than one date type: set its due date, its next follow-up or its plan —
 * the types the calendar shows, in its toolbar's order. ↑↓ / Enter / D / F
 * / P / click pick; Esc or a click outside cancels with no change.
 */
export function CalendarDropChooser({ todo, date, dateTypes, at, onDone }: CalendarDropChooserProps) {
  const entries = useMemo<MenuEntry[]>(() => [
    { kind: 'label', text: `Set “${todo.title}” for ${dayLabel(date)}` },
    ...shownCalendarDateTypes(dateTypes).map((type): MenuEntry => ({ kind: 'item', ...typeItem(type, todo, date), onSelect: () => onDone(type) })),
  ], [todo, date, dateTypes, onDone])

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
