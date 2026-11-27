import type { ComponentPropsWithRef, ReactNode } from 'react'
import { FollowedUpIcon } from '../FollowupIcons'
import styles from './Followup.module.css'

type MarkFollowedUpButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children' | 'type'> & {
  /** Already followed up today: `data-done-today`, and dimmed unless `dimmed` says otherwise. */
  doneToday?: boolean
  /** Draws the quiet done-today look. Defaults to `doneToday`. */
  dimmed?: boolean
  /** Fills its container's width, label centred (the follow-up popover). */
  fullWidth?: boolean
  /** Shown after the label, hidden from the accessible name (a key hint such as `› ⏎`). */
  adornment?: ReactNode
  /** The label: `Mark followed up` unless the host says otherwise (a review card with no next follow-up: `Mark reviewed`). */
  label?: string
}

/**
 * The one "Mark followed up" button — the task editor's Follow-up group, the
 * follow-up popover, the review footer: the follow-up yellow, the flag-check
 * icon and the same label, but the review footer's `Mark reviewed` while it
 * would leave no next follow-up. Followed up today, it steps down to a quiet
 * button (pressing it again only moves the next date). Everything else — ref, `disabled`, tooltip
 * trigger props, `onClick` — passes through to the `<button>`.
 */
export function MarkFollowedUpButton({
  doneToday = false, dimmed = doneToday, fullWidth = false, adornment, label = 'Mark followed up', className, ...props
}: MarkFollowedUpButtonProps) {
  const classes = [
    styles.markFollowedUp,
    dimmed ? styles.markFollowedUpDone : '',
    fullWidth ? styles.markFollowedUpFull : '',
    className ?? '',
  ].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      {...props}
      className={classes}
      data-done-today={doneToday ? 'true' : undefined}
    >
      <FollowedUpIcon />
      {label}
      {adornment != null && <span className={styles.markFollowedUpAdornment} aria-hidden="true">{adornment}</span>}
    </button>
  )
}
