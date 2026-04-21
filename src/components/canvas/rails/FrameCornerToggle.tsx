import { forwardRef, type KeyboardEvent } from 'react'
import type { Corner, CornerOwner, RailSide, RailsState } from '../../../models/canvas-rails'
import { resolveCorner } from '../../../models/canvas-rails'
import styles from './FrameCornerToggle.module.css'

const CORNER_LABEL: Record<Corner, string> = {
  nw: 'northwest',
  ne: 'northeast',
  sw: 'southwest',
  se: 'southeast',
}

const CORNER_ADJACENT: Record<Corner, { horizontal: RailSide; vertical: RailSide }> = {
  nw: { horizontal: 'top', vertical: 'left' },
  ne: { horizontal: 'top', vertical: 'right' },
  sw: { horizontal: 'bottom', vertical: 'left' },
  se: { horizontal: 'bottom', vertical: 'right' },
}

/**
 * Icon pointing toward the rail that would receive the corner if the user
 * clicks. When 'v' owns, the click gives the corner to the horizontal rail →
 * arrow points north (for nw/ne) or south (for sw/se). When 'h' owns, the
 * click gives the corner to the vertical rail → arrow points west (nw/sw) or
 * east (ne/se).
 */
function glyphFor(corner: Corner, owner: CornerOwner): string {
  if (owner === 'v') {
    return corner === 'nw' || corner === 'ne' ? '▲' : '▼'
  }
  return corner === 'nw' || corner === 'sw' ? '◀' : '▶'
}

interface FrameCornerToggleProps {
  corner: Corner
  rails: RailsState
  onToggle: (corner: Corner, next: CornerOwner) => void
  onArrowNav: (fromCorner: Corner, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => void
  tabIndex: number
}

export const FrameCornerToggle = forwardRef<HTMLButtonElement, FrameCornerToggleProps>(
  function FrameCornerToggle({ corner, rails, onToggle, onArrowNav, tabIndex }, ref) {
    const adj = CORNER_ADJACENT[corner]
    const disabled = rails[adj.horizontal] == null || rails[adj.vertical] == null
    const owner = resolveCorner(rails, corner)
    const pressed = owner === 'h'

    const handleClick = () => {
      if (disabled) return
      onToggle(corner, owner === 'v' ? 'h' : 'v')
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        onArrowNav(corner, e.key)
      }
    }

    const classes = [styles.toggle, styles[corner]]
    if (disabled) classes.push(styles.disabled)

    const nextOwnerLabel = owner === 'v' ? 'horizontal rail' : 'vertical rail'
    const label = disabled
      ? `Toggle ${CORNER_LABEL[corner]} corner (disabled — both adjacent rails required)`
      : `Give ${CORNER_LABEL[corner]} corner to ${nextOwnerLabel}`

    return (
      <button
        ref={ref}
        type="button"
        className={classes.join(' ')}
        data-corner={corner}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        title={label}
        tabIndex={tabIndex}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.icon} aria-hidden="true">{glyphFor(corner, owner)}</span>
      </button>
    )
  },
)
