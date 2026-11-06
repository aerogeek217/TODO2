import { type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel, dayOverflow, weekRowsFit } from '../../../utils/calendar-grid'
import { dayKey } from '../../../utils/date'
import { useElementSize } from '../../../hooks/use-element-size'
import styles from './CalendarWidget.module.css'
import { type DayContext, useDayTarget, dayClasses, washClass } from './calendar-day'
import { DropLabel, EntryItem, MoreButton } from './CalendarDayParts'

/** The calendar's week: as rows (narrow) or seven columns. */

function weekdayShort(d: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] ?? ''
}

function WeekRow({ day, entries, fit, ctx, onMore, moreOpen }: {
  day: Date
  entries: CalendarEntry[]
  fit: number
  ctx: DayContext
  onMore: (day: Date, cell: HTMLElement) => void
  moreOpen: boolean
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const { shown, more } = dayOverflow(entries.length, fit)
  return (
    <div
      ref={setNodeRef}
      className={dayClasses(styles.weekRow, ctx, highlighted, [isToday && styles.dayToday, washClass(entries, day, ctx.today)])}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
    >
      <div className={styles.dateBlock} aria-label={dayLabel(day)}>
        <span className={styles.weekdayName}>{weekdayShort(day)}</span>
        <span className={styles.weekDate}>{day.getDate()}</span>
      </div>
      <div className={styles.weekEntries}>
        {entries.length === 0
          ? <span className={styles.emptyDash} aria-hidden="true">—</span>
          : entries.slice(0, shown).map((e) => <EntryItem key={e.key} entry={e} size="md" ctx={ctx} />)}
        {more > 0 && <MoreButton day={day} more={more} open={moreOpen} onMore={onMore} md />}
      </div>
      {highlighted && <DropLabel ctx={ctx} />}
    </div>
  )
}

/**
 * The week as seven rows sharing the cell's height. When the days' entries
 * don't all fit, every row is capped at the same number of slots
 * (`weekRowsFit` over the measured height) and a row over it ends in
 * `+N more`.
 */
export function WeekRows({ days, entriesByDay, ctx, onMore, moreDayMs }: {
  days: Date[]
  entriesByDay: Map<string, CalendarEntry[]>
  ctx: DayContext
  onMore: (day: Date, cell: HTMLElement) => void
  moreDayMs: number | null
}) {
  const [rowsRef, rowsSize] = useElementSize()
  const entriesOf = (day: Date) => entriesByDay.get(dayKey(day)) ?? []
  const fit = weekRowsFit(rowsSize.height, days.map((d) => entriesOf(d).length))
  return (
    <div ref={rowsRef} className={styles.weekRows} data-cal-grid="rows">
      {days.map((day) => (
        <WeekRow
          key={day.getTime()}
          day={day}
          entries={entriesOf(day)}
          fit={fit}
          ctx={ctx}
          onMore={onMore}
          moreOpen={moreDayMs === day.getTime()}
        />
      ))}
    </div>
  )
}

export function WeekColumn({ day, entries, ctx }: { day: Date; entries: CalendarEntry[]; ctx: DayContext }) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  return (
    <div
      ref={setNodeRef}
      className={dayClasses(styles.weekColumn, ctx, highlighted, [isToday && styles.dayToday, washClass(entries, day, ctx.today)])}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
    >
      <div className={styles.columnHeader} aria-label={dayLabel(day)}>
        <span className={styles.weekdayName}>{weekdayShort(day)}</span>
        <span className={styles.weekDate}>{day.getDate()}</span>
      </div>
      <div className={styles.columnEntries}>
        {entries.map((e) => <EntryItem key={e.key} entry={e} size="md" wrap ctx={ctx} />)}
      </div>
      {highlighted && <DropLabel ctx={ctx} />}
    </div>
  )
}
