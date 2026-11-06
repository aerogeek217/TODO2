import { useCallback, useLayoutEffect, useRef } from 'react'
import { type CalendarDateTypes } from '../../../models/workspace-layout'
import { type CalendarEntry } from '../../../services/calendar-entries'
import { dayLabel, monthCellFit, MONTH_ROW_MIN, dayOverflow, weekdayLabels } from '../../../utils/calendar-grid'
import { dayHeat, heatLegendLabel, heatSummary, latestLateDay, HEAT_LEGEND, type LateDay } from '../../../utils/calendar-heat'
import { dayKey } from '../../../utils/date'
import { useElementSize } from '../../../hooks/use-element-size'
import { useTooltip } from '../../shared/use-tooltip'
import styles from './CalendarWidget.module.css'
import { MONTH_GRID_PAD, MONTH_GRID_GAP, type DayContext, useDayTarget, dayClasses, washClass } from './calendar-day'
import { DropLabel, EntryItem, MoreButton } from './CalendarDayParts'

/** The calendar's month: the grid of days, a heat-map day and its legend. */

function MonthDay({ day, month, entries, fit, ctx, onMore, moreOpen }: {
  day: Date
  month: number
  entries: CalendarEntry[]
  fit: number
  ctx: DayContext
  onMore: (day: Date, cell: HTMLElement) => void
  moreOpen: boolean
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const outside = day.getMonth() !== month
  const { shown, more } = dayOverflow(entries.length, fit)
  return (
    <div
      ref={setNodeRef}
      className={dayClasses(styles.monthDay, ctx, highlighted, [outside && styles.dayOutside, washClass(entries, day, ctx.today)])}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-outside={outside ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
    >
      <div className={styles.dayNumber}>
        <span className={isToday ? styles.todayPill : undefined}>{day.getDate()}</span>
      </div>
      {entries.slice(0, shown).map((e) => <EntryItem key={e.key} entry={e} size="sm" ctx={ctx} />)}
      {more > 0 && <MoreButton day={day} more={more} open={moreOpen} onMore={onMore} />}
      {highlighted && <DropLabel ctx={ctx} />}
    </div>
  )
}

/**
 * A month day with titles off: tinted by its entry count (`dayHeat`), the
 * count in the corner, the number in the late colour on a past day still
 * open. Hover names the count; a day with entries is a button that opens the
 * day popover (as `+N more` does). Drops land on it as on a bar day.
 */
function MonthHeatDay({ day, month, entries, ctx, onMore, moreOpen }: {
  day: Date
  month: number
  entries: CalendarEntry[]
  ctx: DayContext
  onMore: (day: Date, cell: HTMLElement) => void
  moreOpen: boolean
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const outside = day.getMonth() !== month
  const heat = dayHeat(entries, day, ctx.today)
  const summary = heatSummary(heat)
  const { triggerProps, tooltip } = useTooltip(moreOpen || ctx.drag ? null : summary)
  const className = dayClasses(styles.monthDay, ctx, highlighted, [
    styles.heatDay,
    outside && styles.dayOutside,
    isToday && styles.heatToday,
    moreOpen && styles.heatSelected,
  ])
  const attrs = {
    'data-day': dayKey(day),
    'data-today': isToday ? 'true' : undefined,
    'data-outside': outside ? 'true' : undefined,
    'data-drop-target': highlighted ? 'true' : undefined,
    'data-heat': heat.step,
    'data-late': heat.late ?? undefined,
  }
  const content = (
    <>
      <div className={styles.dayNumber}>
        <span className={isToday ? styles.todayPill : undefined}>{day.getDate()}</span>
      </div>
      {heat.count > 0 && <span className={styles.heatCount} aria-hidden="true">{heat.count}</span>}
      {highlighted && <DropLabel ctx={ctx} />}
    </>
  )
  if (heat.count === 0) return <div ref={setNodeRef} className={className} {...attrs}>{content}</div>
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={className}
      aria-label={`${dayLabel(day)}, ${summary}`}
      aria-haspopup="dialog"
      aria-expanded={moreOpen}
      onClick={(e) => onMore(day, e.currentTarget)}
      {...triggerProps}
      {...attrs}
    >
      {content}
      {tooltip}
    </button>
  )
}

/**
 * Under the heat map: what the tint counts, the four steps, and — when the
 * month holds one — a late day's number in its colour (the latest).
 */
export function HeatLegend({ types, lateDay }: { types: CalendarDateTypes; lateDay: LateDay | null }) {
  return (
    <div className={styles.heatLegend} data-cal-legend="">
      <span>{heatLegendLabel(types)}:</span>
      {HEAT_LEGEND.map((s) => (
        <span key={s.step} className={styles.heatLegendStep}>
          <i className={styles.heatSwatch} data-heat={s.step} aria-hidden="true" />
          {s.label}
        </span>
      ))}
      {lateDay && (
        <span>
          · <span className={styles.heatLegendLate} data-late={lateDay.late}>{lateDay.day.getDate()}</span> still open past its day
        </span>
      )}
    </div>
  )
}

export function MonthGrid({ days, month, entriesByDay, ctx, weekStartsOn, titles, onMore, moreDayMs }: {
  days: Date[]
  month: number
  entriesByDay: Map<string, CalendarEntry[]>
  ctx: DayContext
  weekStartsOn: 0 | 1
  /** Bars with titles; else the heat map. */
  titles: boolean
  onMore: (day: Date, cell: HTMLElement) => void
  moreDayMs: number | null
}) {
  const [sizeRef, gridSize] = useElementSize()
  const gridEl = useRef<HTMLDivElement | null>(null)
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    gridEl.current = el
    sizeRef(el)
  }, [sizeRef])
  const rows = Math.ceil(days.length / 7)
  const minRow = titles ? MONTH_ROW_MIN.titles : MONTH_ROW_MIN.heat
  const shared = gridSize.height > 0 ? (gridSize.height - MONTH_GRID_PAD - MONTH_GRID_GAP * (rows - 1)) / rows : 0
  // Too short for the rows at their least: they keep it and the grid scrolls.
  const scrolls = shared > 0 && shared < minRow
  const fit = monthCellFit(shared > 0 ? Math.max(shared, minRow) : 0)
  const lateDay = titles ? null : latestLateDay(days, month, (d) => entriesByDay.get(dayKey(d)) ?? [], ctx.today)
  // A scrolling month opens on today's week (when it shows today).
  const firstDayMs = days[0]?.getTime()
  useLayoutEffect(() => {
    const grid = gridEl.current
    if (!scrolls || !grid) return
    const today = grid.querySelector<HTMLElement>('[data-today="true"]')
    if (!today) { grid.scrollTop = 0; return }
    const top = today.getBoundingClientRect().top - grid.getBoundingClientRect().top + grid.scrollTop
    grid.scrollTop = top - (grid.clientHeight - today.offsetHeight) / 2
  }, [scrolls, firstDayMs, titles])
  return (
    <>
      <div className={styles.weekdays} aria-hidden="true">
        {weekdayLabels(weekStartsOn).map((w) => <span key={w}>{w}</span>)}
      </div>
      <div
        ref={gridRef}
        className={styles.monthGrid}
        style={{ gridTemplateRows: `repeat(${rows}, minmax(${minRow}px, 1fr))` }}
        data-cal-grid="month"
        data-heat-map={titles ? undefined : 'true'}
        data-scrolls={scrolls ? 'true' : undefined}
      >
        {days.map((day) => titles ? (
          <MonthDay
            key={day.getTime()}
            day={day}
            month={month}
            entries={entriesByDay.get(dayKey(day)) ?? []}
            fit={fit}
            ctx={ctx}
            onMore={onMore}
            moreOpen={moreDayMs === day.getTime()}
          />
        ) : (
          <MonthHeatDay
            key={day.getTime()}
            day={day}
            month={month}
            entries={entriesByDay.get(dayKey(day)) ?? []}
            ctx={ctx}
            onMore={onMore}
            moreOpen={moreDayMs === day.getTime()}
          />
        ))}
      </div>
      {!titles && <HeatLegend types={ctx.dateTypes} lateDay={lateDay} />}
    </>
  )
}
