import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useClickOutside } from '../../hooks/use-click-outside'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { useFlashMessage } from '../../hooks/use-flash-message'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useTodoStore } from '../../stores/todo-store'
import { NotesBody } from './notes/NotesBody'
import { useTaskNotesSource } from './notes/use-task-notes-source'
import { isNotesConvertOpen } from './notes/NotesConvert'
import { TOAST_VISIBLE_MS } from '../../constants'
import { hasModalAbove, isInLayerAbove } from '../../utils/dom-layers'
import styles from './TaskNotePopover.module.css'
import { PopoverRoot } from '../shared/PopoverRoot'

// The notes' `@ # /` popup is portalled to the body, and so are the notes →
// tasks dialogs and anything opened above the popover (the popup's person /
// tag menu, the editor or confirm it opens): presses there aren't outside.
const isNotesLayer = (panel: Element | null, target: Element) =>
  target.closest('[data-nlp-popup]') !== null || isNotesConvertOpen() || (panel !== null && isInLayerAbove(panel, target))

/** The task editor's limit on the Progress text. */
const PROGRESS_MAX_LENGTH = 500
const PROGRESS_PLACEHOLDER = 'e.g. 50% done, Waiting on review...'

interface TaskNotePopoverProps {
  todoId: number
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * The task row's notes popover: the task's **Progress** (one line, as the
 * editor has it) above its **Notes** (`NotesBody` on the todo's `notes`).
 * Anchored to the row's notes cell by `usePopoverAnchor`: it flips above the
 * cell / to its right edge when it would leave the viewport, and follows it
 * on scroll and resize.
 *
 * Opens with the focus in Progress. Notes are one edit session at a time
 * (`useTaskNotesSource`: written a moment after typing stops, and at blur,
 * close, Copy and Convert); Progress saves on blur, Enter and close — each as
 * `todo-store.update` with just that field, and only when it changed. A
 * change made elsewhere shows in either field until the user types in it. Esc, Enter in Progress and an outside click
 * close it, keeping what was typed; a click on the cell is left to the cell's
 * toggle. On close the focus goes back to the cell, unless something else
 * took it.
 */
export function TaskNotePopover({ todoId, anchorRef, onClose }: TaskNotePopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const progressRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const progressId = useId()
  const [toast, flashToast] = useFlashMessage<string | null>(null)

  const notes = useTaskNotesSource({ todoId })
  const flushNotes = notes.flush

  // Progress: the stored value shows until the user types in the field;
  // `dirtyRef` = typed since the last save (a ref, so blur, Enter and the
  // close in one turn save once).
  const storedProgress = useTodoStore((s) => s.todos.find((t) => t.id === todoId)?.progress ?? '')
  const [typedProgress, setTypedProgress] = useState<string | null>(null)
  const progress = typedProgress ?? storedProgress
  const progressTextRef = useLatestRef(progress)
  const dirtyRef = useRef(false)
  const saveProgress = useCallback(() => {
    if (!dirtyRef.current) return
    // The notes typed so far are their own edit, written first.
    void flushNotes()
    dirtyRef.current = false
    const text = progressTextRef.current
    setTypedProgress(null)
    const stored = useTodoStore.getState().todos.find((t) => t.id === todoId)?.progress ?? ''
    if (text === stored) return
    void useTodoStore.getState().update(todoId, { progress: text ? text : undefined })
  }, [progressTextRef, todoId, flushNotes])

  // Whatever closes it (Esc, Enter, an outside click, the cell's toggle) keeps what was typed.
  const saveProgressRef = useLatestRef(saveProgress)
  useEffect(() => () => saveProgressRef.current(), [saveProgressRef])

  // Remember what had focus (the notes cell), then focus Progress.
  useLayoutEffect(() => {
    const previous = document.activeElement
    if (previous instanceof HTMLElement && previous !== document.body && !containerRef.current?.contains(previous)) {
      returnFocusRef.current = previous
    } else if (anchorRef.current) {
      returnFocusRef.current = anchorRef.current
    }
    progressRef.current?.focus({ preventScroll: true })
  }, [anchorRef])
  // On close hand the focus back, unless something else took it.
  useLayoutEffect(() => {
    const container = containerRef.current
    return () => {
      const target = returnFocusRef.current
      const active = document.activeElement
      const focusIsOurs = !active || active === document.body || !active.isConnected || !!container?.contains(active)
      if (target && target.isConnected && focusIsOurs) target.focus({ preventScroll: true })
    }
  }, [])

  // Outside clicks and Escape stay here: both must leave the notes' own
  // layers (the `@ # /` popup, the convert dialogs) alone.
  const isInside = useCallback(
    (target: Element) => isNotesLayer(containerRef.current, target) || (anchorRef.current?.contains(target) ?? false),
    [anchorRef],
  )
  useClickOutside(containerRef, onClose, true, isInside)
  const { panelRef, style, caret } = usePopoverAnchor({
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
    caret: true,
  })
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    panelRef(el)
  }, [panelRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // While a convert dialog is open, Esc belongs to it; so does an Esc in
      // a layer above (a menu, an editor, a confirm) or, with nothing
      // focused, to a modal above.
      if (e.key !== 'Escape' || isNotesConvertOpen()) return
      const panel = containerRef.current
      const target = e.target instanceof Node ? e.target : null
      if (panel && target && !panel.contains(target)) {
        if (isInLayerAbove(panel, target)) return
        if ((target === document.body || target === document.documentElement) && hasModalAbove(panel)) return
      }
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const handleToast = useCallback((message: string) => flashToast(message, TOAST_VISIBLE_MS), [flashToast])

  const onProgressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    saveProgress()
    onClose()
  }

  return (
    <PopoverRoot
      ref={setPanel}
      caret={caret}
      className={styles.popover}
      // The hook's viewport cap, tightened to the popover's own 60vh.
      style={{ ...style, maxHeight: `min(60vh, ${style.maxHeight}px)` }}
      // The popover is portaled but React events still bubble to the row
      // (select / drag / open-detail / task menu handlers) — keep them
      // inside. Keys still reach the app's shortcuts (text-field rules).
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Progress and notes"
    >
      <div className={styles.progress}>
        <label className={styles.label} htmlFor={progressId}>Progress</label>
        <input
          id={progressId}
          ref={progressRef}
          className={styles.progressInput}
          value={progress}
          maxLength={PROGRESS_MAX_LENGTH}
          placeholder={PROGRESS_PLACEHOLDER}
          autoComplete="off"
          onChange={(e) => { dirtyRef.current = true; setTypedProgress(e.target.value) }}
          onBlur={saveProgress}
          onKeyDown={onProgressKeyDown}
        />
      </div>
      <div className={`${styles.label} ${styles.notesLabel}`}>Notes</div>
      <NotesBody
        source={notes.source}
        showToolbar
        placeholder="Add notes…"
        onConvertToast={handleToast}
      />
      {toast && <div className={styles.toast}>{toast}</div>}
    </PopoverRoot>
  )
}
