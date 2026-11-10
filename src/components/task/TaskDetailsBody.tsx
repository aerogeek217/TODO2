import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { NotesBody, type NotesSource } from './notes/NotesBody'
import type { NoteSubtaskTarget } from '../../services/note-subtasks'
import { PlusIcon } from '../shared/icons'
import styles from './TaskDetails.module.css'

/**
 * The one task layout's body (board BJ): what the task editor
 * (`TaskEditPopup`, every mode) and the review card (`ReviewDeck`) show
 * between their header and footer. **Two columns**: on the left the
 * **facts rail** (236px, a darker ground, `rail` — Priority, Status,
 * People, Tags, Due, then Follow-up in its yellow box, `TaskFacts`); on
 * the right **the writing** — Notes, Subtasks, Status updates, in that
 * order, each an add line while empty. The rail stays put while the writing
 * scrolls (it scrolls on its own only when it is taller than the body), so
 * Follow-up never leaves the screen. Under 640px of body (a narrow window,
 * the phone's sheet) the rail goes above the writing, its facts in two
 * columns, and the body scrolls as one. The header and footer are the
 * host's.
 */
export function TaskDetailsBody({ rail, notes, subtasks, statusUpdates }: {
  rail: ReactNode
  notes: ReactNode
  subtasks: ReactNode
  statusUpdates: ReactNode
}) {
  return (
    <div className={styles.bodyFrame}>
      <div className={styles.body} data-task-body="">
        <div className={styles.rail} data-task-rail="">{rail}</div>
        <div className={styles.writing} data-task-writing="">
          {/* A slot each: the hosts key their sections by the task, and two siblings mustn't share a key. */}
          <Fragment key="notes">{notes}</Fragment>
          <Fragment key="subtasks">{subtasks}</Fragment>
          <Fragment key="updates">{statusUpdates}</Fragment>
        </div>
      </div>
    </div>
  )
}

/**
 * The task layout's Notes, first in the writing: the label and the notes
 * editor in its dark box, its toolbar along the top. Empty, it is one line
 * — `+ Add notes` — that opens the editor, focused; it stays open for the
 * rest of the visit (and opens by itself when notes come in from elsewhere:
 * an undo, a check-in reply).
 */
export function TaskNotesSection({ source, subtaskTarget }: {
  source: NotesSource
  subtaskTarget: NoteSubtaskTarget
}) {
  const hasText = source.get() !== ''
  const [opened, setOpened] = useState(hasText)
  // `+ Add notes` pressed: the editor, once there, takes the focus.
  const focusOnOpen = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const open = opened || hasText

  // The notes editor makes its view in an effect of its own: focus it a frame later.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return
    let frame = 0
    let tries = 0
    // The flag stays until the focus lands (a re-run of the effect — StrictMode's — tries again).
    const focus = () => {
      const content = boxRef.current?.querySelector<HTMLElement>('.cm-content')
      if (content) {
        focusOnOpen.current = false
        content.focus()
      } else if (++tries < 10) {
        frame = requestAnimationFrame(focus)
      } else {
        focusOnOpen.current = false
      }
    }
    // From the next frame: the editor's view is the one that stays (StrictMode makes and unmakes one first).
    frame = requestAnimationFrame(focus)
    return () => cancelAnimationFrame(frame)
  }, [open])

  if (!open) {
    return (
      <section className={styles.writingSection} aria-label="Notes" data-task-notes="" data-empty="">
        <button
          type="button"
          className={styles.addLine}
          onClick={() => { focusOnOpen.current = true; setOpened(true) }}
        >
          <span className={styles.addLineIcon} aria-hidden="true"><PlusIcon size={13} strokeWidth={2} /></span>
          Add notes
        </button>
      </section>
    )
  }
  return (
    <section className={styles.writingSection} aria-label="Notes" data-task-notes="">
      <div className={styles.sectionLabel}>Notes</div>
      <div className={styles.notesBox} ref={boxRef}>
        <NotesBody
          source={source}
          showToolbar
          placeholder="Add notes..."
          subtaskTarget={subtaskTarget}
        />
      </div>
    </section>
  )
}
