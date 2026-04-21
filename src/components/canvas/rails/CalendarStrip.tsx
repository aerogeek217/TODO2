import { useMemo } from 'react'
import type { PersistedTodoItem, Person, Org, Status } from '../../../models'
import type { CalendarOrientation } from '../../../models/canvas-rails'
import { startOfDay, MS_PER_DAY } from '../../../utils/date'
import { buildEntries, dayKey } from './calendar/calendar-events'
import { EventRow } from './calendar/EventRow'
import styles from './CalendarStrip.module.css'

export const STRIP_DAY_COUNT = 7

interface CalendarStripProps {
  todos: PersistedTodoItem[]
  today: Date
  orientation?: CalendarOrientation
  /** Weeks offset from today's week. 0 = current week. */
  weekOffset?: number
  assignedPeopleMap: Map<number, Person[]>
  assignedOrgsMap: Map<number, Org[]>
  statuses: Status[]
  onOpenTodo?: (todoId: number) => void
}

/** Monday of the week containing `d`, at 00:00. */
function mondayOf(d: Date): Date {
  const x = startOfDay(d)
  const dow = x.getDay() // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow
  return new Date(x.getTime() + diff * MS_PER_DAY)
}

function buildDayRange(today: Date, weekOffset: number): Date[] {
  const start = new Date(mondayOf(today).getTime() + weekOffset * 7 * MS_PER_DAY)
  const days: Date[] = []
  for (let i = 0; i < STRIP_DAY_COUNT; i++) {
    days.push(new Date(start.getTime() + i * MS_PER_DAY))
  }
  return days
}

export function CalendarStrip({
  todos,
  today,
  orientation = 'vertical',
  weekOffset = 0,
  assignedPeopleMap,
  assignedOrgsMap,
  statuses,
  onOpenTodo,
}: CalendarStripProps) {
  const days = useMemo(() => buildDayRange(today, weekOffset), [today, weekOffset])
  const entriesByDay = useMemo(
    () => buildEntries(todos, days, today, assignedPeopleMap, assignedOrgsMap, statuses),
    [todos, days, today, assignedPeopleMap, assignedOrgsMap, statuses],
  )
  const todayKey = dayKey(today)

  if (orientation === 'horizontal') {
    return (
      <div
        className={styles.horizontal}
        role="list"
        aria-label="Week calendar (horizontal)"
        data-orientation="horizontal"
      >
        {days.map((day) => {
          const key = dayKey(day)
          const isToday = key === todayKey
          const isPast = day.getTime() < startOfDay(today).getTime()
          const entries = entriesByDay.get(key) ?? []
          const dow = day.toLocaleDateString('en-US', { weekday: 'short' })
          return (
            <div
              key={key}
              className={[
                styles.hCol,
                isToday && styles.hColToday,
                !isToday && isPast && styles.hColPast,
              ].filter(Boolean).join(' ')}
              role="listitem"
              data-day={key}
              data-today={isToday ? 'true' : undefined}
            >
              <div className={styles.hColHeader}>
                <span className={styles.dow}>{dow}</span>
                <span className={styles.dayNum}>{day.getDate()}</span>
              </div>
              <div className={styles.hColEvents}>
                {entries.length === 0 ? (
                  <span className={styles.emptyDash} aria-hidden="true">—</span>
                ) : (
                  entries.map((entry) => (
                    <EventRow
                      key={entry.key}
                      entry={entry}
                      compact
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

  return (
    <div
      className={styles.strip}
      role="list"
      aria-label="Week calendar"
      data-orientation="vertical"
    >
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
