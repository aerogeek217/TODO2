import type { ReactNode } from 'react'
import styles from './TaskDetails.module.css'

/** One follow-up field's parts: the field, then (Next) the quick intervals, and its help line. */
export interface FollowupFieldParts {
  /** The date field (`FactDateField` around its input wrap). */
  field: ReactNode
  /** The quick intervals (`FollowupQuickButtons`), after the field. */
  quick?: ReactNode
  /** What the typed text means, or why it isn't a date (an `aria-live` span), cut with an ellipsis. */
  help?: ReactNode
}

/**
 * The task layout's follow-up fields (task layout B, feedback 2026-11-15):
 * in the host's footer, just before Mark followed up — the task editor's
 * and the review card's alike, each host keeping its own state —
 * `Last [field] · Next [field] [1w][2w][1m][3m]`. Each label is the field's
 * picture (the field's own name says it). The help lines (what the typed
 * text means, a field's hint) share one slot before the fields, taking the
 * footer's spare room and cut with an ellipsis (`placement: 'footer'`), or
 * after them (`'row'`: the Review widget's medium face, Next alone). As the
 * footer narrows (its host's container queries) the quick intervals go
 * first, then the fields' words shorten to the date alone, then the labels
 * go. `last` absent: Next alone (a draft task, the medium face).
 */
export function TaskFollowupFields({ next, last, placement = 'footer' }: {
  next: FollowupFieldParts
  last?: FollowupFieldParts
  placement?: 'footer' | 'row'
}) {
  const help = (last?.help != null || next.help != null) && (
    <div className={styles.followupHelp} data-followup-help="">
      {last?.help}
      {next.help}
    </div>
  )
  return (
    <div className={styles.followupFields} data-task-followup="" data-placement={placement}>
      {placement === 'footer' && help}
      {last && <FollowupField which="last" label="Last" parts={last} />}
      <FollowupField which="next" label="Next" parts={next} />
      {placement === 'row' && help}
    </div>
  )
}

function FollowupField({ which, label, parts }: { which: 'next' | 'last'; label: string; parts: FollowupFieldParts }) {
  return (
    <div className={styles.followupField} data-followup-field={which}>
      {/* The field's own name says it (`aria-label`); the label is its picture. */}
      <span className={styles.followupLabel} aria-hidden="true" data-followup-label="">{label}</span>
      {parts.field}
      {parts.quick && <div className={styles.followupQuick} data-followup-quick="">{parts.quick}</div>}
    </div>
  )
}
