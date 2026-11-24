import type { MouseEvent } from 'react'
import { UnfoldIcon } from '../shared/icons'
import styles from './TrackExpandButton.module.css'

/**
 * Expand row / Expand column: the one button a collapsed row's header and a
 * collapsed column's strip show — a small bordered button holding the unfold
 * icon, up and down for a row, left and right for a column. Placement is the
 * caller's (`className`).
 */
export function TrackExpandButton({ axis, label, onClick, touch = false, tooltip = true, className }: {
  axis: 'rows' | 'columns'
  /** Its name (and tooltip): "Expand row" unless given. */
  label?: string
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  /** The phone's size. */
  touch?: boolean
  tooltip?: boolean
  className?: string
}) {
  const name = label ?? (axis === 'rows' ? 'Expand row' : 'Expand column')
  return (
    <button
      type="button"
      className={[styles.button, touch ? styles.touch : '', className ?? ''].join(' ')}
      aria-label={name}
      aria-expanded={false}
      data-tooltip={tooltip ? name : undefined}
      data-track-expand={axis}
      onClick={onClick}
    >
      <UnfoldIcon axis={axis} size={touch ? 16 : 14} />
    </button>
  )
}
