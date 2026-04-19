import { memo, useRef, useState, useCallback } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { PersistedNote } from '../../models'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useUIStore } from '../../stores/ui-store'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { NotesBody } from '../shared/notes/NotesBody'
import styles from './FloatingNoteNode.module.css'

const PRESET_COLORS = [
  { label: 'Default', value: undefined, css: 'var(--color-surface)' },
  { label: 'Yellow', value: '#FFF3B0', css: '#FFF3B0' },
  { label: 'Green', value: '#B8F0C0', css: '#B8F0C0' },
  { label: 'Blue', value: '#B0D4FF', css: '#B0D4FF' },
  { label: 'Pink', value: '#FFB8D0', css: '#FFB8D0' },
  { label: 'Purple', value: '#D4B8FF', css: '#D4B8FF' },
]

export interface FloatingNoteNodeData {
  note: PersistedNote
  onDelete: (id: number) => void
  onUpdateColor: (id: number, color: string | undefined) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingNoteNodeInner({ data }: NodeProps & { data: FloatingNoteNodeData }) {
  const { note, onDelete, onUpdateColor, onResize } = data
  const { getZoom } = useReactFlow()
  const [showPalette, setShowPalette] = useState(false)
  const paletteRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useClickOutside(paletteRef, () => setShowPalette(false), showPalette)

  const bgColor = note.color
  const noteStyle: React.CSSProperties = bgColor
    ? { backgroundColor: bgColor, color: '#1a1a1a' }
    : {}

  const width = note.width ?? 240
  const height = note.height ?? 200

  const handleDelete = useCallback(() => {
    if (note.id == null) return
    const preview = note.content.trim().split('\n')[0]?.slice(0, 40) || 'note'
    if (note.content.trim()) {
      useUIStore.getState().showBulkConfirmation('custom', [note.id], {
        title: 'Delete note',
        message: `Delete "${preview}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        onConfirm: () => onDelete(note.id!),
      })
    } else {
      onDelete(note.id)
    }
  }, [note.id, note.content, onDelete])

  return (
    <div className={styles.note} style={{ width, height, ...noteStyle }}>
      <div className={styles.titleBar}>
        <div style={{ position: 'relative' }} ref={paletteRef}>
          <div
            className={`${styles.colorDot} nopan nodrag`}
            style={{ backgroundColor: note.color || 'var(--color-surface)' }}
            onClick={(e) => { e.stopPropagation(); setShowPalette(!showPalette) }}
            onDoubleClick={(e) => { e.stopPropagation(); if (note.id != null) onUpdateColor(note.id, undefined) }}
            title="Set color (double-click to reset)"
          />
          {showPalette && (
            <div className={`${styles.palette} nopan nodrag`}>
              {PRESET_COLORS.map((c) => (
                <div
                  key={c.label}
                  className={`${styles.paletteSwatch} ${note.color === c.value || (!note.color && !c.value) ? styles.paletteSwatchActive : ''}`}
                  style={{ backgroundColor: c.css }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (note.id != null) onUpdateColor(note.id, c.value)
                    setShowPalette(false)
                  }}
                  title={c.label}
                />
              ))}
            </div>
          )}
        </div>
        <span className={styles.noteLabel}>Note</span>
        <button
          className={`${styles.deleteButton} nopan nodrag`}
          onClick={() => {
            if (note.id == null) return
            useCanvasRailsStore.getState().createAndDockSlot('notes')
            onDelete(note.id)
          }}
          aria-label="Dock notes to rail"
          title="Dock to rail (opens rail notes; this floating note is moved to undo)"
        >
          ↙
        </button>
        <button
          className={`${styles.deleteButton} nopan nodrag`}
          onClick={handleDelete}
          aria-label="Delete note"
        >
          &times;
        </button>
      </div>

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <NotesBody
          dock="floating"
          activeIdOverride={note.id}
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
