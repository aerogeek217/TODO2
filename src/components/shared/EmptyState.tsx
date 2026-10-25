import type { ReactElement, ReactNode } from 'react'
import styles from './EmptyState.module.css'

/** The empty states' line drawings (D19): the icon family's 1.6 stroke, round, at 48px. */
export type EmptyIllustration = 'list' | 'layout' | 'person'

const ILLUSTRATIONS: Record<EmptyIllustration, ReactElement> = {
  // A list sheet with a tick badge: nothing left to show.
  list: (
    <>
      <rect x="9" y="7" width="30" height="36" rx="4" />
      <path d="M16 17h16M16 25h11M16 33h7" />
      <circle cx="36" cy="36" r="7" style={{ fill: 'var(--color-surface)' }} />
      <path d="M33 36l2 2 4-4" />
    </>
  ),
  // A layout frame with dashed column lines: no widgets yet.
  layout: (
    <>
      <rect x="6" y="9" width="36" height="30" rx="4" />
      <path d="M18 9v30M30 9v30" strokeDasharray="3 3" />
      <path d="M12 19h2M12 25h2M24 19h2" />
    </>
  ),
  // A person, waiting to be picked.
  person: (
    <>
      <circle cx="24" cy="17" r="7" />
      <path d="M10 40a14 14 0 0 1 28 0" />
      <path d="M34 12l3-3M37 12l-3-3" opacity=".5" />
    </>
  ),
}

export interface EmptyStateAction {
  label: string
  onClick: () => void
}

interface EmptyStateProps {
  illustration: EmptyIllustration
  title: string
  text?: string
  /** The one action (a button under the text). */
  action?: EmptyStateAction
  /** In place of `action`, when the action is more than one button (the empty layout's widget kinds). */
  children?: ReactNode
}

/**
 * An empty widget or layout (D19): a line illustration, a title, a line of
 * text and one action, centred in the space it fills.
 */
export function EmptyState({ illustration, title, text, action, children }: EmptyStateProps): ReactElement {
  return (
    <div className={styles.empty} data-empty-state={illustration}>
      <svg
        className={styles.illustration}
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {ILLUSTRATIONS[illustration]}
      </svg>
      <span className={styles.title}>{title}</span>
      {text && <span className={styles.text}>{text}</span>}
      {action && (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {children}
    </div>
  )
}
