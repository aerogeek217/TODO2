import { memo, useEffect, useRef, useCallback, useState } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { FloatingNote } from '../../models'
import type { SlotKind } from '../../models/canvas-rails'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { NotesBody } from '../shared/notes/NotesBody'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { convertFloatingKind } from '../../services/float-kind-switch'
import styles from './FloatingNoteNode.module.css'

export interface FloatingNoteNodeData {
  note: FloatingNote
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingNoteNodeInner({ data }: NodeProps & { data: FloatingNoteNodeData }) {
  const { note, onDelete, onResize } = data
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const [kindAnchor, setKindAnchor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  const width = note.width
  const height = note.height

  const handleClose = useCallback(() => {
    if (note.id == null) return
    onDelete(note.id)
  }, [note.id, onDelete])

  const handleDock = useCallback(() => {
    if (note.id == null) return
    useCanvasRailsStore.getState().createAndDockSlot('notes')
    onDelete(note.id)
  }, [note.id, onDelete])

  const handleChangeKind = useCallback(async (nextKind: SlotKind) => {
    if (note.id == null) return
    if (nextKind === 'notes') return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (canvasId == null) return
    await convertFloatingKind({
      sourceKind: 'notes',
      sourceId: note.id,
      canvasId,
      rect: { x: note.x, y: note.y, width, height },
      nextKind,
    })
  }, [note.id, note.x, note.y, width, height])

  return (
    <div className={styles.note} style={{ width, height }}>
      <WidgetHeader
        kind="notes"
        title="Notes · Inbox"
        onDock={handleDock}
        onClose={handleClose}
        onTitleClick={(a) => setKindAnchor(a)}
        titleMenuOpen={kindAnchor !== null}
        floating
      />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <NotesBody
          dock="floating"
          showToolbar
        />
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
          const noteDiv = nodeEl?.querySelector('.' + styles.note) as HTMLElement | null
          let active = true

          const onPointerMove = (ev: PointerEvent) => {
            if (!active) return
            const dx = ev.clientX - startX
            const dy = ev.clientY - startY
            const newW = Math.max(160, startW + dx / zoom)
            const newH = Math.max(120, startH + dy / zoom)
            if (noteDiv) {
              noteDiv.style.width = `${newW}px`
              noteDiv.style.height = `${newH}px`
            }
          }

          const onPointerUp = (ev: PointerEvent) => {
            if (!active) return
            const newW = Math.max(160, startW + (ev.clientX - startX) / zoom)
            const newH = Math.max(120, startH + (ev.clientY - startY) / zoom)
            if (note.id != null && onResize) onResize(note.id, newW, newH)
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
          currentKind="notes"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingNoteNode = memo(FloatingNoteNodeInner)
