import { useId, useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { PersistedTodoItem, Person, Org, Status } from '../../../models'
import type { CalendarOrientation } from '../../../models/canvas-rails'
import { startOfDay, MS_PER_DAY } from '../../../utils/date'
import { TASK_DROP_KIND, calendarDayDropId } from '../../../utils/task-dnd'
import { TaskDraggable } from '../../task/dnd/TaskDraggable'
import { useSettingsStore } from '../../../stores/settings-store'
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
   * Scope string distinguishing this strip from other calendar droppables in
   * the same `DndContext` (e.g. two rail-docked strips + a floating calendar
   * on one canvas). When omitted, each `CalendarStrip` instance gets an
   * auto-generated React `useId` scope. Reschedule dispatch is handled by
   * the `DndContext` owner via `dispatchTaskDrop` — the strip only
   * registers draggable rows + droppable day cells.
   */
  scope?: string
  /**
   * Disable drag/drop wiring entirely. When `true`, rows render with no
   * draggable handlers and cells skip `useDroppable` registration. Used in
   * isolated tests / read-only previews where mounting a `DndContext` would
   * be overkill.
   */
  disableDnd?: boolean
}

function formatRange(days: Date[]): string {
  const first = days[0]
  const last = days[days.length - 1]
  if (!first || !last) return ''
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

interface DayCellProps {
  scope: string
  day: Date
  disableDnd: boolean
  children: (args: {
    isDragOver: boolean
    setNodeRef: (el: HTMLElement | null) => void
  }) => React.ReactNode
}

/** Wraps a strip day cell in a `useDroppable` so dnd-kit drops reach the
 * DndContext's `handleDragEnd`. The ref must attach to a real
 * layout-participating element (not a `display: contents` wrapper) or dnd-kit
 * measures a zero-size rect and no drop ever matches. */
function DayDroppable({ scope, day, disableDnd, children }: DayCellProps) {
  const id = calendarDayDropId(scope, startOfDay(day).getTime())
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: TASK_DROP_KIND.calendarDay, date: startOfDay(day), scope },
    disabled: disableDnd,
  })
  return <>{children({ isDragOver: isOver && !disableDnd, setNodeRef })}</>
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
  scope: scopeProp,
  disableDnd = false,
}: CalendarStripProps) {
  const autoScope = useId()
  const scope = scopeProp ?? autoScope
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const days = useMemo(() => buildDayRange(today, weekOffset), [today, weekOffset])
  const entriesByDay = useMemo(
    () => buildEntries(todos, days, today, weekStartsOn, assignedPeopleMap, assignedOrgsMap, statuses),
    [todos, days, today, weekStartsOn, assignedPeopleMap, assignedOrgsMap, statuses],
  )
  const todayKey = dayKey(today)

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
          const entries = entriesByDay.get(key) ?? []
          const dow = day.toLocaleDateString('en-US', { weekday: 'short' })
          return (
            <DayDroppable key={key} scope={scope} day={day} disableDnd={disableDnd}>
              {({ isDragOver, setNodeRef }) => (
                <div
                  ref={setNodeRef}
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
                        disableDnd ? (
                          <EventRow
                            key={entry.key}
                            entry={entry}
                            today={today}
                            weekStartsOn={weekStartsOn}
                            compact
                            onClick={() => onOpenTodo?.(entry.todo.id)}
                          />
                        ) : (
                          <TaskDraggable
                            key={entry.key}
                            todo={entry.todo}
                            surface="calendar-strip"
                            extraData={{ scope }}
                          >
                            {({ setNodeRef, attributes, listeners }) => (
                              <EventRow
                                entry={entry}
                                today={today}
                                weekStartsOn={weekStartsOn}
                                compact
                                draggable
                                onClick={() => onOpenTodo?.(entry.todo.id)}
                                dragRef={setNodeRef}
                                dragAttributes={attributes}
                                dragListeners={listeners}
                              />
                            )}
                          </TaskDraggable>
                        )
                      ))
                    )}
                  </div>
                </div>
              )}
            </DayDroppable>
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
        const entries = entriesByDay.get(key) ?? []
        const dow = day.toLocaleDateString('en-US', { weekday: 'short' })
        const dayLabel = `${day.toLocaleDateString('en-US', { month: 'short' })} ${day.getDate()}`

        return (
          <DayDroppable key={key} scope={scope} day={day} disableDnd={disableDnd}>
            {({ isDragOver, setNodeRef }) => (
              <div
                ref={setNodeRef}
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
                      disableDnd ? (
                        <EventRow
                          key={entry.key}
                          entry={entry}
                          today={today}
                          weekStartsOn={weekStartsOn}
                          onClick={() => onOpenTodo?.(entry.todo.id)}
                        />
                      ) : (
                        <TaskDraggable
                          key={entry.key}
                          todo={entry.todo}
                          surface="calendar-strip"
                          extraData={{ scope }}
                        >
                          {({ setNodeRef, attributes, listeners }) => (
                            <EventRow
                              entry={entry}
                              today={today}
                              weekStartsOn={weekStartsOn}
                              draggable
                              onClick={() => onOpenTodo?.(entry.todo.id)}
                              dragRef={setNodeRef}
                              dragAttributes={attributes}
                              dragListeners={listeners}
                            />
                          )}
                        </TaskDraggable>
                      )
                    ))
                  )}
                </div>
              </div>
            )}
          </DayDroppable>
        )
      })}
      </div>
    </div>
  )
}
