import type { TabBadgeCounts } from '../../utils/tab-badges'
import styles from './BadgeCapsule.module.css'

/**
 * Due and follow-up counts in one capsule (magenta, yellow), each part solid
 * while any of it is overdue; a part with nothing counted is left out. A
 * list tab's badge and the top bar's counter. With `label` it is an image
 * so named; without, its host names it and it is hidden from assistive tech.
 */
export function BadgeCapsule({ counts, label, ...rest }: {
  counts: TabBadgeCounts
  label?: string
} & Record<`data-${string}`, string>) {
  const { due, dueOverdue, followup, followupOverdue } = counts
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return (
    <span {...rest} className={styles.badge} {...a11y}>
      {due > 0 && <span className={`${styles.due} ${dueOverdue > 0 ? styles.dueOverdue : ''}`} data-badge-part="due">{due}</span>}
      {followup > 0 && <span className={`${styles.followup} ${followupOverdue > 0 ? styles.followupOverdue : ''}`} data-badge-part="followup">{followup}</span>}
    </span>
  )
}
