import { useRef, useState, type CSSProperties } from 'react'
import { useWeekLoad } from '../../../hooks/use-week-load'
import { WEEK_LOAD_KINDS } from '../../../services/stats/week-load'
import { meterLabel, thisWeek, usualShown, WEEK_LOAD_COLOR, weekKindTotals } from './week-load-words'
import { WeekLoadPopover } from './WeekLoadPopover'
import styles from './WeekLoad.module.css'

/**
 * The **week load meter** in the Planner's top line, before Reset plan: a
 * 56 × 6px bar of this week's dates in the kinds' solid colors — due, then
 * follow-up, then planned, each as long as its count — with a dashed mark at
 * the usual week, then `19 / 13`. The bar's scale is the larger of the load
 * and 1.5 × the usual week. Named (and its tooltip) `This week: 19 dates,
 * usual 13`. A click opens or closes the week's popover (`WeekLoadPopover`)
 * under it; Esc hands the focus back here. It counts every task, whatever
 * the screen filter (`useWeekLoad`), and draws nothing until the events are
 * read. A widget too narrow for it drops it before Reset plan's words
 * (`WeekLoad.module.css`).
 */
export function WeekLoadMeter() {
  const load = useWeekLoad()
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const week = load ? thisWeek(load) : null
  if (!load || !week) return null
  const usual = usualShown(load)
  const totals = weekKindTotals(week)
  const scale = Math.max(week.totals.load, 1.5 * load.usual.perWeek, 1)
  const label = meterLabel(week.totals.load, usual)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.meter}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip={label}
        data-week-load-meter=""
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.meterBar} aria-hidden="true">
          <span className={styles.meterFill}>
            {WEEK_LOAD_KINDS.map((k) => totals[k] > 0 && (
              <span key={k} className={styles.meterPart} style={{ width: `${(100 * totals[k]) / scale}%`, '--c': WEEK_LOAD_COLOR[k] } as CSSProperties} />
            ))}
          </span>
          {load.usual.perWeek > 0 && <span className={styles.meterMark} style={{ left: `${(100 * load.usual.perWeek) / scale}%` }} />}
        </span>
        <span className={styles.meterFigures} aria-hidden="true">
          {week.totals.load}<span className={styles.meterUsual}> / {usual}</span>
        </span>
      </button>
      {open && <WeekLoadPopover load={load} anchorRef={ref} placement="bottom-end" onClose={() => setOpen(false)} />}
    </>
  )
}
