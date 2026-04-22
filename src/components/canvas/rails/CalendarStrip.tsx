import { useCallback, useMemo, useState, type DragEvent } from 'react'
import type { PersistedTodoItem, Person, Org, Status } from '../../../models'
import type { CalendarOrientation } from '../../../models/canvas-rails'
import { startOfDay, MS_PER_DAY } from '../../../utils/date'
import { DRAG_MIME, serializeTodoDragPayload, parseTodoDragPayload } from '../../../utils/task-dnd'
import { buildEntries, dayKey } from './calendar/calendar-events'
import { EventRow } from './calendar/EventRow'
import { dropCellClassName } from '../../shared/DropIndicator'
import styles from './CalendarStrip.module.css'

export const STRIP_DAY_COUNT = 7

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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
  onWeekOffsetChange?: (n: number) => void
  /**
   * Called when a todo event row is dropped on a different day cell. The
   * strip does not itself mutate stores — it just hands back the target.
   * Virtual recurring rows forward their parent todo id (per plan §Phase 5).
   */
  onReschedule?: (todoId: number, targetDay: Date) => void
}

function formatRange(days: Date[]): string {
  const first = days[0]
  const last = days[days.length - 1]
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()
  return sameMonth
    ? `${MONTH_NAMES[first.getMonth()]} ${first.getDate()} – ${last.getDate()}`
    : `${MONTH_NAMES[first.getMonth()]} ${first.getDate()} – ${MONTH_NAMES[last.getMonth()]} ${last.getDate()}`
}

interface RangeBarProps {
  days: Date[]
  weekOffset: number
  onWeekOffsetChange: (n: number) => void
}

function RangeBar({ days, weekOffset, onWeekOffsetChange }: RangeBarProps) {
  return (
    <div className={styles.rangeBar} data-testid="calendar-range-bar">
      <button
        type="button"
        className={styles.navBtn}
        onClick={() => onWeekOffsetChange(weekOffset - 1)}
        aria-label="Previous week"
        title="Previous week"
      >‹</button>
      <button
        type="button"
        className={styles.navBtn}
        onClick={() => onWeekOffsetChange(weekOffset + 1)}
        aria-label="Next week"
        title="Next week"
      >›</button>
      {weekOffset !== 0 && (
        <button
          type="button"
          className={styles.todayBtn}
          onClick={() => onWeekOffsetChange(0)}
          title="Jump to this week"
        >Today</button>
      )}
      <span className={styles.rangeLabel}>{formatRange(days)}</span>
      {weekOffset === 0 && <span className={styles.rangeHint}>This wk</span>}
    </div>
  )
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
  onWeekOffsetChange,
  onReschedule,
}: CalendarStripProps) {
  const days = useMemo(() => buildDayRange(today, weekOffset), [today, weekOffset])
  const entriesByDay = useMemo(
    () => buildEntries(todos, days, today, assignedPeopleMap, assignedOrgsMap, statuses),
    [todos, days, today, assignedPeopleMap, assignedOrgsMap, statuses],
  )
  const todayKey = dayKey(today)

  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  const handleDragStart = useCallback((todoId: number) => (e: DragEvent) => {
    if (!onReschedule) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(DRAG_MIME, serializeTodoDragPayload(todoId))
    e.dataTransfer.setData('text/plain', String(todoId))
  }, [onReschedule])

  const handleDragOver = useCallback((key: string) => (e: DragEvent) => {
    if (!onReschedule) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverKey(key)
  }, [onReschedule])

  const handleDragLeave = useCallback(() => {
    setDragOverKey(null)
  }, [])

  const handleDrop = useCallback((day: Date) => (e: DragEvent) => {
    if (!onReschedule) return
    e.preventDefault()
    setDragOverKey(null)
    const raw = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain')
    if (!raw) return
    const todoId = parseTodoDragPayload(raw)
    if (todoId == null) return
    onReschedule(todoId, startOfDay(day))
  }, [onReschedule])

  const rangeBar = onWeekOffsetChange
    ? <RangeBar days={days} weekOffset={weekOffset} onWeekOffsetChange={onWeekOffsetChange} />
    : null

  if (orientation === 'horizontal') {
    return (
      <div className={styles.root}>
        {rangeBar}
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
          const isDragOver = dragOverKey === key
          const entries = entriesByDay.get(key) ?? []
          const dow = day.toLocaleDateString('en-US', { weekday: 'short' })
          return (
            <div
              key={key}
              className={[
                styles.hCol,
                isToday && styles.hColToday,
                !isToday && isPast && styles.hColPast,
                dropCellClassName(isDragOver),
              ].filter(Boolean).join(' ')}
              role="listitem"
              data-day={key}
              data-today={isToday ? 'true' : undefined}
              data-drop-target={isDragOver ? 'true' : undefined}
              onDragOver={onReschedule ? handleDragOver(key) : undefined}
              onDragLeave={onReschedule ? handleDragLeave : undefined}
              onDrop={onReschedule ? handleDrop(day) : undefined}
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
                      draggable={!!onReschedule}
                      onDragStart={onReschedule ? handleDragStart(entry.todo.id) : undefined}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      {rangeBar}
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
        const isDragOver = dragOverKey === key
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
              dropCellClassName(isDragOver),
            ].filter(Boolean).join(' ')}
            role="listitem"
            data-day={key}
            data-today={isToday ? 'true' : undefined}
            data-drop-target={isDragOver ? 'true' : undefined}
            onDragOver={onReschedule ? handleDragOver(key) : undefined}
            onDragLeave={onReschedule ? handleDragLeave : undefined}
            onDrop={onReschedule ? handleDrop(day) : undefined}
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
                    draggable={!!onReschedule}
                    onDragStart={onReschedule ? handleDragStart(entry.todo.id) : undefined}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}
