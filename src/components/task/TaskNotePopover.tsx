import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useTodoStore } from '../../stores/todo-store'
import { NotesBody, type NotesSource } from '../shared/notes/NotesBody'
import styles from './TaskNotePopover.module.css'

interface TaskNotePopoverProps {
  todoId: number
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * Popover anchored below a TaskRow's notes-icon that mounts `NotesBody`
 * against the todo's `notes` field. Closes on outside-click or Escape.
 */
export function TaskNotePopover({ todoId, anchorRef, onClose }: TaskNotePopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })
  const [toast, setToast] = useState<string | null>(null)

  const initialNotes = useMemo(() => {
    const t = useTodoStore.getState().todos.find(x => x.id === todoId)
    return t?.notes ?? ''
  }, [todoId])

  const draftRef = useRef<string>(initialNotes)
  const [, setDraft] = useState<string>(initialNotes)

  useClickOutside(containerRef, onClose, true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Track anchor position continuously (handles scroll / layout shifts).
  useEffect(() => {
    let raf = 0
    let prevTop = -9999
    let prevLeft = -9999
    const tick = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect) {
        const top = rect.bottom + 4
        const left = rect.left
        if (top !== prevTop || left !== prevLeft) {
          prevTop = top
          prevLeft = left
          setPos({ top, left })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [anchorRef])

  const source = useMemo<NotesSource>(() => ({
    get: () => draftRef.current,
    set: (next) => {
      draftRef.current = next
      setDraft(next)
      const t = useTodoStore.getState().todos.find(x => x.id === todoId)
      if (t) {
        void useTodoStore.getState().update({
          ...t,
          notes: next ? next : undefined,
          modifiedAt: new Date(),
        })
      }
    },
  }), [todoId])

  const handleToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  return (
    <div
      ref={containerRef}
      className={styles.popover}
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Task notes"
    >
      <NotesBody
        source={source}
        showToolbar
        hideFooter
        placeholder="Add notes…"
        onConvertToast={handleToast}
      />
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  )
}
