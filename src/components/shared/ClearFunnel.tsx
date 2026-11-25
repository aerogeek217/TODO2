import type { MouseEvent } from 'react'
import { FunnelIcon } from './icons'
import styles from './ClearFunnel.module.css'

/**
 * A filtering field's clear, at its left inside the box: the top bar's
 * funnel in a field's size (24px). Red while the field holds something, and
 * a click clears it; dim, inert and click-through (a press lands on the
 * field) while it holds nothing. A mouse target only — not a Tab stop — and
 * its press keeps the focus and the caret in the field. The Review widget's
 * field and a list's prompt field use it.
 */
export function ClearFunnel({ active, label, tooltip, onClear }: {
  /** The field holds something to clear. */
  active: boolean
  /** The accessible name (`Clear Person`). */
  label: string
  /** The app's tooltip while active (default: the label). */
  tooltip?: string
  onClear: () => void
}) {
  return (
    <button
      type="button"
      className={`${styles.funnel} ${active ? styles.active : ''}`}
      aria-label={label}
      data-tooltip={active ? (tooltip ?? label) : undefined}
      data-clear-funnel=""
      disabled={!active}
      tabIndex={-1}
      onMouseDown={(e: MouseEvent) => e.preventDefault()}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onClear()
      }}
    >
      <FunnelIcon size={14} />
    </button>
  )
}
