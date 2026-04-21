import { useDroppable } from '@dnd-kit/core'
import type { EmptySideClaim, RailSide } from '../../../models/canvas-rails'
import { encodeRailsDropId, RAILS_DRAG_TYPE } from '../../../utils/rail-dnd'
import styles from './DockOverlay.module.css'

interface DockOverlayProps {
  emptySides: RailSide[]
}

const SIDE_LABEL: Record<RailSide, string> = {
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
}

const CLAIM_LABEL: Record<RailSide, Record<EmptySideClaim, string>> = {
  top: { start: 'northwest', end: 'northeast' },
  bottom: { start: 'southwest', end: 'southeast' },
  left: { start: 'northwest', end: 'southwest' },
  right: { start: 'northeast', end: 'southeast' },
}

function stripPart(side: RailSide, claim?: EmptySideClaim): string {
  // Maps an empty-side strip sub-zone to one of 12 CSS classes:
  //   {side}_{start|center|end}
  // Each class positions the sub-zone absolutely at the frame edge with
  // width/height keyed off `--left-size`/`--right-size`/`--top-size`/
  // `--bottom-size`, so corner sub-zones collapse to 0 when the perpendicular
  // rail is absent (nothing to claim).
  return `${side}_${claim ?? 'center'}`
}

function SubZone({ side, claim }: { side: RailSide; claim?: EmptySideClaim }) {
  const id = encodeRailsDropId({ kind: 'empty-side', side, claim })
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: RAILS_DRAG_TYPE } })
  const label = claim
    ? `Dock to ${SIDE_LABEL[side]} rail, claim ${CLAIM_LABEL[side][claim]} corner`
    : `Dock to ${SIDE_LABEL[side]} rail`
  const classes = [styles.zone, styles[stripPart(side, claim)]]
  if (claim) classes.push(styles.corner)
  if (isOver) classes.push(styles.over)
  return (
    <div
      ref={setNodeRef}
      className={classes.join(' ')}
      role="button"
      aria-label={label}
      data-drop-id={id}
    >
      {!claim && <span className={styles.label}>Dock {side}</span>}
    </div>
  )
}

export function DockOverlay({ emptySides }: DockOverlayProps) {
  if (emptySides.length === 0) return null
  return (
    <div className={styles.overlay} role="group" aria-label="Rail drop zones">
      {emptySides.map((side) => (
        <div key={side} className={styles.strip}>
          <SubZone side={side} claim="start" />
          <SubZone side={side} />
          <SubZone side={side} claim="end" />
        </div>
      ))}
    </div>
  )
}
