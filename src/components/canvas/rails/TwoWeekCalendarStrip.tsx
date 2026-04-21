import { useMemo } from 'react'
import type { PersistedTodoItem, Person, Org, Status } from '../../../models'
import { startOfDay, MS_PER_DAY } from '../../../utils/date'
import { buildEntries, dayKey } from './calendar/calendar-events'
import { EventRow } from './calendar/EventRow'
import styles from './TwoWeekCalendarStrip.module.css'

export const STRIP_DAY_OFFSET_START = -2
export const STRIP_DAY_OFFSET_END = 12
export const STRIP_DAY_COUNT = STRIP_DAY_OFFSET_END - STRIP_DAY_OFFSET_START + 1

interface TwoWeekCalendarStripProps {
  todos: PersistedTodoItem[]
  today: Date
  assignedPeopleMap: Map<number, Person[]>
  assignedOrgsMap: Map<number, Org[]>
  statuses: Status[]
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

export function TwoWeekCalendarStrip({
  todos,
  today,
  assignedPeopleMap,
  assignedOrgsMap,
  statuses,
  onOpenTodo,
}: TwoWeekCalendarStripProps) {
  const days = useMemo(() => buildDayRange(today), [today])
  const entriesByDay = useMemo(
    () => buildEntries(todos, days, today, assignedPeopleMap, assignedOrgsMap, statuses),
    [todos, days, today, assignedPeopleMap, assignedOrgsMap, statuses],
  )
  const todayKey = dayKey(today)

  return (
    <div className={styles.strip} role="list" aria-label="Two-week calendar">
      {days.map((day) => {
        const key = dayKey(day)
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
                  <EventRow
                    key={entry.key}
                    entry={entry}
                    onClick={() => onOpenTodo?.(entry.todo.id)}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
