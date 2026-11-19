import { useSettingsStore } from '../../../stores/settings-store'
import { describeFollowupInterval, formatFollowupInterval, type FollowupInterval } from '../../../utils/followup'
import styles from './Followup.module.css'

interface FollowupQuickButtonsProps {
  /** `long` = "1 week" (popover); `short` = "1w" (task editor). */
  labelStyle: 'long' | 'short'
  onPick: (interval: FollowupInterval) => void
}

/** Row of interval chips ("1 day" … "3 months"), each counted from today: Settings' quick follow-up intervals. */
export function FollowupQuickButtons({ labelStyle, onPick }: FollowupQuickButtonsProps) {
  const intervals = useSettingsStore((s) => s.followupQuickIntervals)
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
            data-tooltip={`Follow up in ${long}`}
            aria-label={`Follow up in ${long}`}
          >
            {labelStyle === 'long' ? long : formatFollowupInterval(i)}
          </button>
        )
      })}
    </div>
  )
}
