import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem } from '../../../models'
import { useBlockTouchScroll } from '../../../hooks/use-block-touch-scroll'
import { useSubtasks, useSubtaskStore } from '../../../stores/subtask-store'
import { tabbables } from '../../../utils/focusables'
import { subtaskCount } from '../../../utils/subtasks'
import type { MenuEntry } from '../../shared/MenuPopover'
import { SubtaskChecklist, type ChecklistItem } from './SubtaskChecklist'
import { storedSubtaskMenuEntries } from './subtask-menu'
import styles from './Subtasks.module.css'
import { KEEP_EVENTS_INSIDE } from '../../shared/keep-events-inside'

/**
 * The phone's checklist (cr28, T2): a bottom sheet over a scrim, opened by
 * the row's `2/5 subtasks` chip — the task's title and count, the checklist
 * with touch-height rows, the add row. The scrim's tap and Esc close it.
 *
 * A modal dialog (cr31 T9): it opens with the focus on the first open
 * subtask's checkbox — on the add field when there is none or `focusAdd`
 * (the menu's Add subtask…) —, Tab stays inside, Esc closes only the sheet
 * (not a dialog it was opened from), and on close the focus goes back to
 * what had it. The page behind doesn't scroll under a drag on the scrim.
 */
export function SubtasksSheet({ todo, onClose, focusAdd = false, extraMenuEntries = storedSubtaskMenuEntries }: {
  todo: PersistedTodoItem
  onClose: () => void
  focusAdd?: boolean
  extraMenuEntries?: (item: ChecklistItem) => MenuEntry[]
}) {
  const subtasks = useSubtasks(todo.id)
  const count = subtaskCount(subtasks)
  const sheetRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useBlockTouchScroll(backdropRef)

  // Esc with the focus outside it (on the page): the sheet's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // As it was on open: the checklist's later changes don't move the focus.
  const [wantsAdd] = useState(() => focusAdd || count.total === 0 || count.done === count.total)
  // What had the focus, to hand it back on close (unless something else took it).
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const sheet = sheetRef.current
    if (!wantsAdd) {
      sheet?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:checked)')?.focus({ preventScroll: true })
    }
    return () => {
      const active = document.activeElement
      // Still in the sheet, about to go with it (this runs before its nodes leave the page).
      const focusLeft = !active || active === document.body || !active.isConnected || sheet?.contains(active) === true
      if (focusLeft && opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [wantsAdd])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Here, before a dialog it was opened from (the phone's task dialog) closes too.
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !sheetRef.current) return
    const items = tabbables(sheetRef.current)
    const first = items.at(0)
    const last = items.at(-1)
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === sheetRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const store = () => useSubtaskStore.getState()
  return createPortal(
    <>
      <div ref={backdropRef} className={styles.backdrop} {...KEEP_EVENTS_INSIDE} onClick={(e) => { e.stopPropagation(); onClose() }} />
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={`Subtasks of ${todo.title}`}
        tabIndex={-1}
        data-subtasks-sheet=""
        // Long-press / right-click in it is the sheet's (the fields' copy /
        // paste), never the row's task menu; nor is a tap or press the row's.
        {...KEEP_EVENTS_INSIDE}
        onKeyDown={onKeyDown}
      >
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>{todo.title}</span>
          <span className={styles.sheetCount} data-subtask-count-text="">{count.done} of {count.total}</span>
        </div>
        <div className={styles.sheetBody}>
          <SubtaskChecklist
            items={subtasks}
            density="touch"
            label="Subtasks"
            onAdd={(title) => { void store().add(todo.id, title) }}
            onRename={(id, title) => { void store().rename(id, title) }}
            onSetDone={(id, done) => { void store().setDone(id, done) }}
            onRemove={(id) => { void store().remove(id) }}
            extraMenuEntries={extraMenuEntries}
            autoFocusAdd={wantsAdd}
          />
        </div>
      </div>
    </>,
    document.body,
  )
}
