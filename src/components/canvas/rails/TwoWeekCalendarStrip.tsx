import { useMemo } from 'react'
import type { PersistedTodoItem } from '../../../models'
import { startOfDay, MS_PER_DAY } from '../../../utils/date'
import { effectiveDate } from '../../../utils/effective-date'
import { generateRecurringInstances, recurrenceAnchor } from '../../../services/recurrence'
import { StatusIcon } from '../../shared/StatusIcon'
import styles from './TwoWeekCalendarStrip.module.css'

export const STRIP_DAY_OFFSET_START = -2
export const STRIP_DAY_OFFSET_END = 12
export const STRIP_DAY_COUNT = STRIP_DAY_OFFSET_END - STRIP_DAY_OFFSET_START + 1

interface StripEntry {
  todo: PersistedTodoItem
  isVirtual: boolean
  key: string
}

interface TwoWeekCalendarStripProps {
  todos: PersistedTodoItem[]
  today: Date
  onOpenTodo?: (todoId: number) => void
}

function buildDayRange(today: Date): Date[] {
  const base = startOfDay(today).getTime()
  const days: Date[] = []
  for (let i = 0; i < STRIP_DAY_COUNT; i++) {
    days.push(new Date(base + (STRIP_DAY_OFFSET_START + i) * MS_PER_DAY))
  }
  return days
}

function bucketEntries(todos: PersistedTodoItem[], days: Date[], today: Date): Map<string, StripEntry[]> {
  const map = new Map<string, StripEntry[]>()
  if (days.length === 0) return map
  const rangeStart = startOfDay(days[0])
  const rangeEnd = new Date(startOfDay(days[days.length - 1]).getTime() + MS_PER_DAY)
  const inRange = (d: Date) => d.getTime() >= rangeStart.getTime() && d.getTime() < rangeEnd.getTime()
  const keyOf = (d: Date) => startOfDay(d).toISOString()

  const push = (d: Date, entry: StripEntry) => {
    const k = keyOf(d)
    const arr = map.get(k) ?? []
    arr.push(entry)
    map.set(k, arr)
  }

  for (const t of todos) {
    const ed = effectiveDate(t, today)
    if (ed && inRange(ed)) {
      push(ed, { todo: t, isVirtual: false, key: `task-${t.id}` })
    }
    if (t.recurrenceRule) {
      const anchor = recurrenceAnchor(t)
      if (!anchor) continue
      const instances = generateRecurringInstances(anchor.date, t.recurrenceRule, rangeStart, rangeEnd)
      const primaryKey = ed ? keyOf(ed) : null
      for (const inst of instances) {
        const ik = keyOf(inst)
        if (ik === primaryKey) continue
        push(inst, { todo: t, isVirtual: true, key: `recurring-${t.id}-${ik}` })
      }
    }
  }

  for (const [, arr] of map) {
    arr.sort((a, b) => a.todo.sortOrder - b.todo.sortOrder)
  }
  return map
}

export function TwoWeekCalendarStrip({ todos, today, onOpenTodo }: TwoWeekCalendarStripProps) {
  const days = useMemo(() => buildDayRange(today), [today])
  const entriesByDay = useMemo(() => bucketEntries(todos, days, today), [todos, days, today])
  const todayKey = startOfDay(today).toISOString()

  return (
    <div className={styles.strip} role="list" aria-label="Two-week calendar">
      {days.map((day) => {
        const key = startOfDay(day).toISOString()
        const isToday = key === todayKey
        const isPast = day.getTime() < startOfDay(today).getTime()
        const entries = entriesByDay.get(key) ?? []
        const dow = day.toLocaleDateString('en-US', { weekday: 'short' })
        const dayLabel = `${day.toLocaleDateString('en-US', { month: 'short' })} ${day.getDate()}`

        return (
          <div
            key={key}
            className={[
              styles.row,
              isToday && styles.rowToday,
              !isToday && isPast && styles.rowPast,
            ].filter(Boolean).join(' ')}
            role="listitem"
            data-day={key}
            data-today={isToday ? 'true' : undefined}
          >
            <div className={styles.dateBlock} aria-label={dayLabel}>
              <span className={styles.dow}>{dow}</span>
              <span className={styles.dayNum}>{day.getDate()}</span>
            </div>
            <div className={styles.events}>
              {entries.length === 0 ? (
                <span className={styles.emptyDash} aria-hidden="true">—</span>
              ) : (
                entries.map((entry) => (
                  <div
                    key={entry.key}
                    className={[
                      styles.event,
                      entry.todo.isCompleted && styles.eventCompleted,
                      entry.isVirtual && styles.eventVirtual,
                    ].filter(Boolean).join(' ')}
                    onClick={() => onOpenTodo?.(entry.todo.id)}
                    title={entry.isVirtual ? `Recurring instance of "${entry.todo.title}"` : entry.todo.title}
                  >
                    {entry.todo.scheduledDate && (
                      <span className={`${styles.marker} ${styles.markerScheduled}`} aria-label="Scheduled">
                        <StatusIcon icon="calendar" />
                      </span>
                    )}
                    {entry.todo.dueDate && (
                      <span className={`${styles.marker} ${styles.markerDeadline}`} aria-label="Deadline">
                        <StatusIcon icon="clock" />
                      </span>
                    )}
                    {entry.todo.recurrenceRule && (
                      <span className={styles.marker} title={`Repeats ${entry.todo.recurrenceRule.type}`}>&#x21bb;</span>
                    )}
                    <span className={styles.eventTitle}>{entry.todo.title}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
