import { type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel } from '../../../utils/calendar-grid'
import { dayKey } from '../../../utils/date'
import { dayTicks, entryDayMarks } from '../../../utils/day-ticks'
import { DayTicks } from '../../shared/DayTicks'
import styles from './CalendarWidget.module.css'
import { type DayContext, useDayTarget, dayClasses, washClass } from './calendar-day'
import { EntryItem } from './CalendarDayParts'

/** The calendar's compact month (narrow or phone): a day of ticks, and the picked day's list. */

/**
 * A compact-month day: its number over its ticks (`shared/DayTicks`, the
 * Planner strip's: a solid tick per due date and follow-up, a hollow one
 * per plan, `+N` past eight); a past day still open washed in its late
 * colour.
 */
export function CompactDay({ day, month, entries, selected, ctx, onSelect }: {
  day: Date
  month: number
  entries: CalendarEntry[]
  selected: boolean
  ctx: DayContext
  onSelect: (day: Date) => void
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const outside = day.getMonth() !== month
  const count = entries.length
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={dayClasses(styles.compactDay, ctx, highlighted, [
        outside && styles.dayOutside,
        selected && styles.compactSelected,
        washClass(entries, day, ctx.today),
      ])}
      aria-pressed={selected}
      aria-label={`${dayLabel(day)}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-outside={outside ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
      onClick={() => onSelect(day)}
    >
      <span className={isToday ? styles.todayPill : styles.compactNumber}>{day.getDate()}</span>
      <DayTicks ticks={dayTicks(entryDayMarks(entries))} size="sm" className={styles.compactTicks} />
    </button>
  )
}

export function DayList({ day, entries, ctx, touch }: { day: Date; entries: CalendarEntry[]; ctx: DayContext; touch: boolean }) {
  const isToday = day.getTime() === ctx.today.getTime()
  return (
    <div className={styles.dayList} data-cal-day-list={dayKey(day)}>
      <div className={styles.dayListHeader}>
        <span className={styles.dayListTitle}>{dayLabel(day)}</span>
        {isToday && <span className={styles.dayListToday}>Today</span>}
        <span className={styles.dayListCount}>{entries.length} {entries.length === 1 ? 'task' : 'tasks'}</span>
      </div>
      <div className={styles.dayListEntries}>
        {entries.map((e) => <EntryItem key={e.key} entry={e} size={touch ? 'touch' : 'md'} ctx={ctx} />)}
      </div>
    </div>
  )
}
