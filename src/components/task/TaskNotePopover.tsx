import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useClickOutside } from '../../hooks/use-click-outside'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { useFlashMessage } from '../../hooks/use-flash-message'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { STATUS_UPDATE_TEXT_MAX } from '../../models'
import { useStatusUpdateStore, useStatusUpdates } from '../../stores/status-update-store'
import { useUIStore } from '../../stores/ui-store'
import { formatDateNumeric } from '../../utils/date'
import { statusUpdateText } from '../../utils/status-updates'
import { NotesBody } from './notes/NotesBody'
import { useTaskNotesSource } from './notes/use-task-notes-source'
import { isNotesConvertOpen } from './notes/NotesConvert'
import { TOAST_VISIBLE_MS } from '../../constants'
import { hasModalAbove, isInLayerAbove } from '../../utils/dom-layers'
import styles from './TaskNotePopover.module.css'
import { PopoverRoot } from '../shared/PopoverRoot'

// The notes' `@ # ! /` popup is portalled to the body, and so are the notes →
// tasks dialogs and anything opened above the popover (the popup's person /
// tag menu, the editor or confirm it opens): presses there aren't outside.
const isNotesLayer = (panel: Element | null, target: Element) =>
  target.closest('[data-nlp-popup]') !== null || isNotesConvertOpen() || (panel !== null && isInLayerAbove(panel, target))

interface TaskNotePopoverProps {
  todoId: number
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * The task row's notes popover: the task's **Status** (its newest status
 * update, `History (N) →` opening the task's editor with them all, and a
 * line that adds one dated today) above its **Notes** (`NotesBody` on the
 * todo's `notes`). Anchored to the row's notes cell by `usePopoverAnchor`:
 * it flips above the cell / to its right edge when it would leave the
 * viewport, and follows it on scroll and resize.
 *
 * Opens with the focus in the Status line. Notes are one edit session at a
 * time (`useTaskNotesSource`: written a moment after typing stops, and at
 * blur, close, Copy and Convert); ⏎ in the Status line adds the update (its
 * own undo step, after the notes typed so far) and clears the line. Esc and
 * an outside click close it, keeping what was typed — a Status line with
 * text is added then; a click on the cell is left to the cell's toggle. On
 * close the focus goes back to the cell, unless something else took it.
 */
export function TaskNotePopover({ todoId, anchorRef, onClose }: TaskNotePopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const updateRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const updateId = useId()
  const [toast, flashToast] = useFlashMessage<string | null>(null)

  const notes = useTaskNotesSource({ todoId })
  const flushNotes = notes.flush

  // Status: the newest update, and the line that adds one dated today.
  const updates = useStatusUpdates(todoId)
  const newest = updates.at(0)
  const [update, setUpdate] = useState('')
  // A ref too, so a close in the same turn as the last keystroke reads it.
  const updateTextRef = useRef('')
  const addUpdate = () => {
    const text = statusUpdateText(updateTextRef.current)
    if (text === '') return
    // The notes typed so far are their own edit, written first.
    void flushNotes()
    updateTextRef.current = ''
    setUpdate('')
    void useStatusUpdateStore.getState().add(todoId, { date: new Date(), text })
  }

  // Whatever closes it (Esc, an outside click, the cell's toggle) keeps what was typed.
  const addUpdateRef = useLatestRef(addUpdate)
  useEffect(() => () => addUpdateRef.current(), [addUpdateRef])

  // Remember what had focus (the notes cell), then focus the Status line.
  useLayoutEffect(() => {
    const previous = document.activeElement
    if (previous instanceof HTMLElement && previous !== document.body && !containerRef.current?.contains(previous)) {
      returnFocusRef.current = previous
    } else if (anchorRef.current) {
      returnFocusRef.current = anchorRef.current
    }
    updateRef.current?.focus({ preventScroll: true })
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
  // layers (the `@ # ! /` popup, the convert dialogs) alone.
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

  const onUpdateKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    addUpdate()
  }

  // The task's editor, with every update: this popover closes first.
  const openHistory = () => {
    onClose()
    useUIStore.getState().openEditPopup(todoId)
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
      aria-label="Status and notes"
    >
      <div className={styles.status}>
        <div className={styles.statusHead}>
          <label className={styles.label} htmlFor={updateId}>Status</label>
          {updates.length > 0 && (
            <button type="button" className={styles.history} onClick={openHistory}>
              History ({updates.length}) →
            </button>
          )}
        </div>
        {newest && (
          <div className={styles.newest} data-newest-update="">
            <span className={styles.newestDate}>{formatDateNumeric(newest.date)}</span> {newest.text}
          </div>
        )}
        <div className={styles.addWrap}>
          <input
            id={updateId}
            ref={updateRef}
            className={styles.updateInput}
            value={update}
            maxLength={STATUS_UPDATE_TEXT_MAX}
            placeholder="Add an update…"
            autoComplete="off"
            onChange={(e) => { updateTextRef.current = e.target.value; setUpdate(e.target.value) }}
            onKeyDown={onUpdateKeyDown}
          />
          <span className={styles.addHint} aria-hidden="true">Today · ⏎</span>
        </div>
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
