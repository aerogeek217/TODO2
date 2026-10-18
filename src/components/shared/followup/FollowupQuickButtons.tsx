import { describeFollowupInterval, formatFollowupInterval, type FollowupInterval } from '../../../utils/followup'
import styles from './Followup.module.css'

interface FollowupQuickButtonsProps {
  intervals: readonly FollowupInterval[]
  /** `long` = "1 week" (popover); `short` = "1w" (task editor). */
  labelStyle: 'long' | 'short'
  onPick: (interval: FollowupInterval) => void
}

/** Row of interval chips ("1 week" … "3 months"), each counted from today. */
export function FollowupQuickButtons({ intervals, labelStyle, onPick }: FollowupQuickButtonsProps) {
  return (
    <div className={styles.quickRow} role="group" aria-label="Quick follow-up intervals">
      {intervals.map((i) => {
        const long = describeFollowupInterval(i)
        return (
          <button
            key={formatFollowupInterval(i)}
            type="button"
            className={styles.quickButton}
            onClick={() => onPick(i)}
            title={`Follow up in ${long}`}
            aria-label={`Follow up in ${long}`}
          >
            {labelStyle === 'long' ? long : formatFollowupInterval(i)}
          </button>
        )
      })}
    </div>
  )
}
