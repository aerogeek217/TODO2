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

  const frameStyle: CSSProperties = {
    '--left-size': rails.left ? `${railSize(rails, 'left')}px` : '0px',
    '--right-size': rails.right ? `${railSize(rails, 'right')}px` : '0px',
    '--top-size': rails.top ? `${railSize(rails, 'top')}px` : '0px',
    '--bottom-size': rails.bottom ? `${railSize(rails, 'bottom')}px` : '0px',
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
