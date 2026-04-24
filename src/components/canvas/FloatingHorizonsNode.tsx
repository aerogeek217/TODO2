import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { FloatingHorizons } from '../../models'
import type { SlotKind } from '../../models/canvas-rails'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { HorizonsSlotContent } from './rails/HorizonsSlotContent'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { convertFloatingKind } from '../../services/float-kind-switch'
import styles from './FloatingHorizonsNode.module.css'

export interface FloatingHorizonsNodeData {
  horizons: FloatingHorizons
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingHorizonsNodeInner({ data }: NodeProps & { data: FloatingHorizonsNodeData }) {
  const { horizons, onDelete, onResize } = data
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  const width = horizons.width
  const height = horizons.height

  const handleDelete = useCallback(() => {
    if (horizons.id != null) onDelete(horizons.id)
  }, [horizons.id, onDelete])

  const handleDock = useCallback(() => {
    if (horizons.id == null) return
    useCanvasRailsStore.getState().createAndDockSlot('horizons')
    onDelete(horizons.id)
  }, [horizons.id, onDelete])

  const [kindAnchor, setKindAnchor] = useState<{ x: number; y: number } | null>(null)

  const handleChangeKind = useCallback(async (nextKind: SlotKind) => {
    if (horizons.id == null) return
    if (nextKind === 'horizons') return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (canvasId == null) return
    await convertFloatingKind({
      sourceKind: 'horizons',
      sourceId: horizons.id,
      canvasId,
      rect: { x: horizons.x, y: horizons.y, width, height },
      nextKind,
    })
  }, [horizons.id, horizons.x, horizons.y, width, height])

  return (
    <div className={styles.horizons} style={{ width, height }}>
      <WidgetHeader
        kind="horizons"
        title="Horizons"
        onDock={handleDock}
        onClose={handleDelete}
        onTitleClick={(a) => setKindAnchor(a)}
        titleMenuOpen={kindAnchor !== null}
        floating
      />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <HorizonsSlotContent />
      </div>

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onPointerDown={(e) => {
          e.stopPropagation()
          resizeCleanupRef.current?.()
          const handle = e.currentTarget as HTMLDivElement
          const pointerId = e.pointerId
          try { handle.setPointerCapture(pointerId) } catch { /* noop */ }

          const startX = e.clientX
          const startY = e.clientY
          const startW = width
          const startH = height
          const zoom = getZoom()
          const nodeEl = handle.closest('.react-flow__node')
          const div = nodeEl?.querySelector('.' + styles.horizons) as HTMLElement | null
          let active = true

          const onPointerMove = (ev: PointerEvent) => {
            if (!active) return
            const dx = ev.clientX - startX
            const dy = ev.clientY - startY
            const newW = Math.max(320, startW + dx / zoom)
            const newH = Math.max(240, startH + dy / zoom)
            if (div) {
              div.style.width = `${newW}px`
              div.style.height = `${newH}px`
            }
          }

          const onPointerUp = (ev: PointerEvent) => {
            if (!active) return
            const newW = Math.max(320, startW + (ev.clientX - startX) / zoom)
            const newH = Math.max(240, startH + (ev.clientY - startY) / zoom)
            if (horizons.id != null && onResize) onResize(horizons.id, newW, newH)
            cleanup()
          }

          const cleanup = () => {
            active = false
            handle.removeEventListener('pointermove', onPointerMove)
            handle.removeEventListener('pointerup', onPointerUp)
            handle.removeEventListener('pointercancel', onPointerUp)
            try {
              if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
            } catch { /* noop */ }
            resizeCleanupRef.current = null
          }
          resizeCleanupRef.current = cleanup
          handle.addEventListener('pointermove', onPointerMove)
          handle.addEventListener('pointerup', onPointerUp)
          handle.addEventListener('pointercancel', onPointerUp)
        }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="horizons"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingHorizonsNode = memo(FloatingHorizonsNodeInner)
