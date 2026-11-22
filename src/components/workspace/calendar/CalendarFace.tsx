import { useMemo, useState } from 'react'
import type { CalendarTab } from '../../../models/workspace-layout'
import type { CalendarEntry } from '../../../services/calendar-entries'
import { calendarRange, calendarTypesWords, dayLabel, weekdayLabels } from '../../../utils/calendar-grid'
import { dayHeat, heatSummary } from '../../../utils/calendar-heat'
import { dayTicks, entryDayMarks } from '../../../utils/day-ticks'
import { dayKey } from '../../../utils/date'
import type { WidgetFace } from '../../../utils/widget-face'
import { DayTicks } from '../../shared/DayTicks'
import { TodayIcon } from '../../shared/icons'
import { dayClasses, type DayContext, useDayTarget } from './calendar-day'
import { useCalendarEntries, useCalendarSetup } from './calendar-data'
import { DropLabel, EntryItem } from './CalendarDayParts'
import { CalendarDayPopover } from './CalendarDayPopover'
import calStyles from './CalendarWidget.module.css'
import styles from './CalendarFace.module.css'

/** What today's entries are, in words: `due today`, `due or to follow up today`, …. */
function todayWords(types: CalendarTab['config']['dateTypes']): string {
  return `${calendarTypesWords(types)} today`
}

/** A medium face's day: its weekday, number, count and ticks; it takes a task drop (sets the date) and opens its entries. */
function WeekFaceDay({ day, weekday, entries, ctx, onOpen }: {
  day: Date
  weekday: string
  entries: readonly CalendarEntry[]
  ctx: DayContext
  onOpen: (day: Date, el: HTMLElement) => void
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const heat = dayHeat(entries, day, ctx.today)
  const isToday = day.getTime() === ctx.today.getTime()
  const summary = heatSummary(heat)
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={dayClasses(styles.weekDay, ctx, highlighted, [isToday && styles.weekToday])}
      aria-label={`${dayLabel(day)}${isToday ? ', today' : ''}: ${heat.count} ${heat.count === 1 ? 'task' : 'tasks'}`}
      data-tooltip={summary || undefined}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-late={heat.late ?? undefined}
      data-drop-target={highlighted ? 'true' : undefined}
      onClick={(e) => { if (heat.count > 0) onOpen(day, e.currentTarget) }}
    >
      <span className={styles.weekName}>{weekday}</span>
      <span className={`${styles.weekNumber} ${heat.late ? styles.weekLate : ''}`} data-late={heat.late ?? undefined}>{day.getDate()}</span>
      <span className={styles.weekCount} data-testid="calendar-face-count">{heat.count > 0 ? heat.count : '–'}</span>
      <DayTicks ticks={dayTicks(entryDayMarks(entries))} className={styles.weekTicks} />
      {highlighted && <DropLabel ctx={ctx} day={day} />}
    </button>
  )
}

/**
 * The calendar's small and medium faces (D25 R), over this week under the
 * screen filter. Small: today's count (of the tab's date types) and a
 * seven-day strip of the days' ticks (`shared/DayTicks`, the Planner
 * strip's: a solid tick per due date and follow-up, a hollow one per plan).
 * Medium: the week as seven day cells with their counts and ticks — each
 * takes a task dropped on it as the full calendar's days do
 * (the same droppable ids and drop handling: it sets or moves the date), and
 * a click opens its entries.
 */
export function CalendarFace({ tab, face, faceRef }: {
  tab: CalendarTab
  face: Exclude<WidgetFace, 'large'>
  faceRef: (el: HTMLElement | null) => void
}) {
  const { ctx, today, weekStartsOn } = useCalendarSetup(tab)
  const drag = ctx.drag
  const [open, setOpen] = useState<{ dayMs: number; at: { x: number; y: number } } | null>(null)

  const dateTypes = tab.config.dateTypes
  const range = useMemo(() => calendarRange('week', 0, today, weekStartsOn), [today, weekStartsOn])
  const entriesByDay = useCalendarEntries(tab, range.days)

  const entriesOf = (day: Date) => entriesByDay.get(dayKey(day)) ?? []
  const todayCount = entriesOf(today).length
  const weekdays = weekdayLabels(weekStartsOn)
  const openDay = open ? range.days.find((d) => d.getTime() === open.dayMs) : undefined

  return (
    <div
      ref={faceRef}
      className={`${calStyles.widget} ${styles.face} ${face === 'small' ? styles.small : styles.medium}`}
      data-calendar-face={face}
      data-calendar-face-tab={tab.id}
      data-dragging={drag ? 'true' : undefined}
    >
      {face === 'small' ? (
        <>
          <span className={styles.label}><TodayIcon size={12} />Today</span>
          <span className={styles.figures}>
            <span className={styles.count} data-testid="calendar-face-today">{todayCount}</span>
            <span className={styles.caption}>{todayWords(dateTypes)}</span>
          </span>
          <span className={styles.strip} role="img" aria-label={`This week: ${range.days.map((d) => `${dayLabel(d)} ${entriesOf(d).length}`).join(', ')}`}>
            {range.days.map((day) => {
              const entries = entriesOf(day)
              return (
                <span
                  key={day.getTime()}
                  className={styles.stripDay}
                  data-day={dayKey(day)}
                  data-today={day.getTime() === today.getTime() ? 'true' : undefined}
                  data-late={dayHeat(entries, day, today).late ?? undefined}
                >
                  <DayTicks ticks={dayTicks(entryDayMarks(entries))} size="sm" />
                </span>
              )
            })}
          </span>
        </>
      ) : (
        <div className={styles.week} data-cal-grid="week-face">
          {range.days.map((day, i) => (
            <WeekFaceDay
              key={day.getTime()}
              day={day}
              weekday={weekdays[i] ?? ''}
              entries={entriesOf(day)}
              ctx={ctx}
              onOpen={(d, el) => {
                const r = el.getBoundingClientRect()
                setOpen((prev) => (prev?.dayMs === d.getTime() ? null : { dayMs: d.getTime(), at: { x: r.left, y: r.bottom + 4 } }))
              }}
            />
          ))}
        </div>
      )}
      {open && openDay && (
        <CalendarDayPopover
          day={openDay}
          at={open.at}
          entries={entriesOf(openDay)}
          renderEntry={(e) => <EntryItem key={e.key} entry={e} size="md" slot={`pop-${e.kind}`} ctx={ctx} />}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
