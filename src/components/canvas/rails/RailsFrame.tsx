import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react'
import { useCanvasRailsStore } from '../../../stores/canvas-rails-store'
import { useUIStore } from '../../../stores/ui-store'
import { useDefaultRails } from '../../../hooks/use-default-rails'
import { useRailsDragMonitor } from '../../../hooks/use-rails-drag-monitor'
import type { RailSide } from '../../../models/canvas-rails'
import { computeRailGridArea, isRailCollapsed, railSize } from '../../../models/canvas-rails'
import { RailContainer } from './RailContainer'
import { SlotDivider } from './SlotDivider'
import { SlotRenderer } from './SlotRenderer'
import { DockOverlay } from './DockOverlay'
import styles from './RailsFrame.module.css'

interface RailsFrameProps {
  children: ReactNode
}

export function RailsFrame({ children }: RailsFrameProps) {
  const rails = useDefaultRails()
  const setRailSize = useCanvasRailsStore((s) => s.setRailSize)
  const { draggingSlot, announcement } = useRailsDragMonitor()
  const railsDragging = draggingSlot !== null
  const floatDragActive = useUIStore((s) => s.floatDrag !== null)
  const floatAnnouncement = useUIStore((s) => s.floatAnnouncement)

  const emptySides = useMemo(() => {
    const out: RailSide[] = []
    for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
      if (!rails[side]) out.push(side)
    }
    return out
  }, [rails])

  const renderRail = (side: RailSide) => {
    const rail = rails[side]
    if (!rail) return null
    const area = computeRailGridArea(rails, side)
    const gridStyle: CSSProperties = {
      gridColumn: `${area.colStart} / ${area.colEnd}`,
      gridRow: `${area.rowStart} / ${area.rowEnd}`,
    }
    const collapsed = isRailCollapsed(rails, side)
    return (
      <RailContainer
        side={side}
        rail={rail}
        size={railSize(rails, side)}
        collapsed={collapsed}
        onResize={(px) => setRailSize(side, px)}
        style={gridStyle}
      >
        {rail.slots.map((slot, idx) => {
          const nextSlot = rail.slots[idx + 1]
          return (
            <Fragment key={slot.id}>
              <SlotRenderer slot={slot} fromSide={side} />
              {nextSlot && (
                <SlotDivider
                  side={side}
                  aboveSlotId={slot.id}
                  belowSlotId={nextSlot.id}
                />
              )}
            </Fragment>
          )
        })}
      </RailContainer>
    )
  }

  // Only emit a `--{side}-size` var when the rail exists. Consumers fall back
  // via `var(--{side}-size, 0px)` for grid sizing (rail cell collapses to 0)
  // and `var(--{side}-size, 80px)` for `DockOverlay`'s corner sub-zones — the
  // 80 px fallback only applies when the perpendicular rail is absent (no rail
  // to size against), so corner-claim drops still have a hit-targettable
  // surface. With the rail present (collapsed at 28 px or expanded at any
  // size) the corner sub-zone shrinks to exactly that, leaving the rail's own
  // slot stubs / slot bodies clear of overlay occlusion (Phase 6.5.2 of
  // real-browser-testing plan).
  const frameStyle: CSSProperties = {
    ...(rails.left && { '--left-size': `${railSize(rails, 'left')}px` }),
    ...(rails.right && { '--right-size': `${railSize(rails, 'right')}px` }),
    ...(rails.top && { '--top-size': `${railSize(rails, 'top')}px` }),
    ...(rails.bottom && { '--bottom-size': `${railSize(rails, 'bottom')}px` }),
  } as CSSProperties

  return (
    <div className={styles.frame} style={frameStyle}>
      {renderRail('left')}
      {renderRail('top')}
      <div className={styles.canvasHost}>
        {children}
      </div>
      {renderRail('bottom')}
      {renderRail('right')}
      {(railsDragging || floatDragActive) && (
        <DockOverlay emptySides={emptySides} floatDragActive={floatDragActive} />
      )}
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {floatAnnouncement}
      </div>
    </div>
  )
}
