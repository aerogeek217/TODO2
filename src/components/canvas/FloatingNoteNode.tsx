import { memo, useRef, useCallback } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { FloatingNote } from '../../models'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { NotesBody } from '../shared/notes/NotesBody'
import { WidgetHeader } from '../shared/WidgetHeader'
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

  return (
    <div className={styles.note} style={{ width, height }}>
      <WidgetHeader
        kind="notes"
        title="Notes · Inbox"
        onDock={handleDock}
        onClose={handleClose}
        floating
      />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <NotesBody
          dock="floating"
          showToolbar
          hideFooter
        />
      </div>

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onMouseDown={(e) => {
          e.stopPropagation()
          const startX = e.clientX
          const startY = e.clientY
          const startW = width
          const startH = height
          const zoom = getZoom()
          const nodeEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          const noteDiv = nodeEl?.querySelector('.' + styles.note) as HTMLElement | null

          const onMouseMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX
            const dy = ev.clientY - startY
            const newW = Math.max(160, startW + dx / zoom)
            const newH = Math.max(120, startH + dy / zoom)
            if (noteDiv) {
              noteDiv.style.width = `${newW}px`
              noteDiv.style.height = `${newH}px`
            }
          }

          const onMouseUp = (ev: MouseEvent) => {
            const newW = Math.max(160, startW + (ev.clientX - startX) / zoom)
            const newH = Math.max(120, startH + (ev.clientY - startY) / zoom)
            if (note.id != null && onResize) onResize(note.id, newW, newH)
            resizeCleanupRef.current?.()
          }

          const cleanup = () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            resizeCleanupRef.current = null
          }
          resizeCleanupRef.current = cleanup
          window.addEventListener('mousemove', onMouseMove)
          window.addEventListener('mouseup', onMouseUp)
        }}
      />
    </div>
  )
}

export const FloatingNoteNode = memo(FloatingNoteNodeInner)
