import type { DayTicks as DayTickMarks } from '../../utils/day-ticks'
import styles from './DayTicks.module.css'

/**
 * A small day cell's ticks (`utils/day-ticks.dayTicks`): a solid tick per
 * real date — a due date in the deadline color, a follow-up in the
 * follow-up color (`data-mark`) —, then a hollow one per plan, outlined in
 * the secondary text color and set a little apart, then `+N`. The marks give
 * way in a narrow cell; `+N` stays whole. The Planner's strip and the
 * Calendar's small cells draw them, so the two can't drift. `size` `sm`:
 * 8px ticks for the smallest cells. `className`: the host's hook (its own
 * placement, its container queries).
 */
export function DayTicks({ ticks, size, className }: { ticks: DayTickMarks; size?: 'sm'; className?: string }) {
  return (
    <span className={[styles.ticks, className].filter(Boolean).join(' ')} aria-hidden="true" data-day-ticks={size ?? ''}>
      <span className={styles.marks} data-day-tick-marks="">
        {ticks.dates.map((kind, i) => <span key={i} className={styles.tick} data-mark={kind} />)}
        {Array.from({ length: ticks.plans }, (_, i) => <span key={`plan-${i}`} className={`${styles.tick} ${styles.plan}`} data-mark="plan" />)}
      </span>
      {ticks.more > 0 && <span className={styles.more} data-day-ticks-more="">+{ticks.more}</span>}
    </span>
  )
}
