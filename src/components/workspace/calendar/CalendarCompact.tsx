import { dayDots, type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel } from '../../../utils/calendar-grid'
import { dayHeat } from '../../../utils/calendar-heat'
import { dayKey } from '../../../utils/date'
import styles from './CalendarWidget.module.css'
import { type DayContext, useDayTarget, dayClasses, washClass } from './calendar-day'
import { EntryItem } from './CalendarDayParts'

/** The calendar's compact month (narrow or phone): a day of dots, and the picked day's list. */

/** A compact-month day: up to three dots (titles on), or the heat tint with the count under the number. */
export function CompactDay({ day, month, entries, selected, titles, ctx, onSelect }: {
  day: Date
  month: number
  entries: CalendarEntry[]
  selected: boolean
  titles: boolean
  ctx: DayContext
  onSelect: (day: Date) => void
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const outside = day.getMonth() !== month
  const count = entries.length
  const heat = titles ? null : dayHeat(entries, day, ctx.today)
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={dayClasses(styles.compactDay, ctx, highlighted, [
        outside && styles.dayOutside,
        selected && styles.compactSelected,
        heat ? styles.compactHeat : washClass(entries, day, ctx.today),
      ])}
      aria-pressed={selected}
      aria-label={`${dayLabel(day)}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-outside={outside ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
      data-heat={heat?.step}
      data-late={heat?.late ?? undefined}
      onClick={() => onSelect(day)}
    >
      <span className={isToday ? styles.todayPill : styles.compactNumber}>{day.getDate()}</span>
      {heat ? (
        <span className={styles.compactCount} aria-hidden="true">{count > 0 ? count : ''}</span>
      ) : (
        <span className={styles.dots} aria-hidden="true">
          {dayDots(entries).map((d, i) => <span key={i} className={styles.dot} data-dot={d} />)}
        </span>
      )}
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
