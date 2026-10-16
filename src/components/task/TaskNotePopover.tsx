import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useClickOutside } from '../../hooks/use-click-outside'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { useFlashMessage } from '../../hooks/use-flash-message'
import { useTodoStore } from '../../stores/todo-store'
import { NotesBody, type NotesSource } from './notes/NotesBody'
import { isNotesConvertOpen } from './notes/NotesConvert'
import { TOAST_VISIBLE_MS } from '../../constants'
import styles from './TaskNotePopover.module.css'

// The notes' `@ # /` popup is portalled to the body, and so are the notes →
// tasks dialogs: clicks there aren't outside clicks.
const isNotesLayer = (target: Element) => target.closest('[data-nlp-popup]') !== null || isNotesConvertOpen()

interface TaskNotePopoverProps {
  todoId: number
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * Popover anchored below a TaskRow's notes-icon that mounts `NotesBody`
 * against the todo's `notes` field. Placed by `usePopoverAnchor`: it flips
 * above the icon / to its right edge when it would leave the viewport, and
 * follows the icon on scroll and resize. Closes on outside-click or Escape;
 * a click on the icon itself is left to the icon's toggle.
 */
export function TaskNotePopover({ todoId, anchorRef, onClose }: TaskNotePopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [toast, flashToast] = useFlashMessage<string | null>(null)

  const initialNotes = useMemo(() => {
    const t = useTodoStore.getState().todos.find(x => x.id === todoId)
    return t?.notes ?? ''
  }, [todoId])

  const draftRef = useRef<string>(initialNotes)
  const [, setDraft] = useState<string>(initialNotes)

  // Outside clicks and Escape stay here: both must leave the notes' own
  // layers (the `@ # /` popup, the convert dialogs) alone.
  const isInside = useCallback(
    (target: Element) => isNotesLayer(target) || (anchorRef.current?.contains(target) ?? false),
    [anchorRef],
  )
  useClickOutside(containerRef, onClose, true, isInside)
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    onClose,
    // The panel's height changes after it opens (the editor mounting, text,
    // the toast line): re-place so the flip / clamp use the new height.
    observeSize: true,
  })
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    panelRef(el)
  }, [panelRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a convert dialog is open, Esc belongs to it.
      if (e.key === 'Escape' && !isNotesConvertOpen()) {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const source = useMemo<NotesSource>(() => ({
    get: () => draftRef.current,
    set: (next) => {
      draftRef.current = next
      setDraft(next)
      void useTodoStore.getState().update(todoId, { notes: next ? next : undefined })
    },
  }), [todoId])

  const handleToast = useCallback((message: string) => flashToast(message, TOAST_VISIBLE_MS), [flashToast])

  return (
    <div
      ref={setPanel}
      className={styles.popover}
      // The hook's viewport cap, tightened to the popover's own 60vh.
      style={{ ...style, maxHeight: `min(60vh, ${style.maxHeight}px)` }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Task notes"
    >
      <NotesBody
        source={source}
        showToolbar
        placeholder="Add notes…"
        onConvertToast={handleToast}
      />
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  )
}
