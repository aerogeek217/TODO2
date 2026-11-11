import type { ReactNode } from 'react'
import styles from './TaskDetails.module.css'

/** One follow-up row's parts: the field, then (Next) the quick intervals and the help line. */
export interface FollowupRowParts {
  /** The date field (`FactDateField` around its input wrap). */
  field: ReactNode
  /** The quick intervals (`FollowupQuickButtons`): after the field, wrapping under it when the row is narrow. */
  quick?: ReactNode
  /** What the typed text means, or why it isn't a date: after the quick buttons, cut with an ellipsis. */
  help?: ReactNode
}

/**
 * The task layout's follow-up rows (task layout A, 2026-11-10), in the dock
 * under the status update line — the task editor's and the review card's
 * alike, each host keeping its own state: **Next follow-up**, then **Last
 * follow-up**, always two rows (never side by side). Each is a label column,
 * then the field; on Next's row the quick intervals follow the field and
 * then the help line, both wrapping under the field (aligned with it) when
 * the row is too narrow — nothing on a row draws over anything else. The
 * labels shorten to `Next` / `Last` under 400px of dock (`labels: 'short'`
 * always: the Review widget's medium face). `last` absent: the Next row
 * alone (a draft task, the medium face).
 */
export function TaskFollowupRows({ next, last, labels = 'auto' }: {
  next: FollowupRowParts
  last?: FollowupRowParts
  labels?: 'auto' | 'short'
}) {
  return (
    <div className={styles.followupRows} data-labels={labels}>
      <FollowupRow which="next" long="Next follow-up" short="Next" parts={next} />
      {last && <FollowupRow which="last" long="Last follow-up" short="Last" parts={last} />}
    </div>
  )
}

function FollowupRow({ which, long, short, parts }: { which: 'next' | 'last'; long: string; short: string; parts: FollowupRowParts }) {
  return (
    <div className={styles.followupRow} data-followup-row={which}>
      {/* The field's own name says it (`aria-label`); the label is its picture. */}
      <span className={styles.followupLabel} aria-hidden="true" data-followup-label="">
        <span className={styles.followupLabelLong}>{long}</span>
        <span className={styles.followupLabelShort}>{short}</span>
      </span>
      <div className={styles.followupMain}>
        {parts.field}
        {parts.quick}
        {parts.help}
      </div>
    </div>
  )
}
