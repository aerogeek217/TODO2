import { Fragment, type ReactNode } from 'react'
import { NotesBody, type NotesSource } from './notes/NotesBody'
import type { NoteSubtaskTarget } from '../../services/note-subtasks'
import styles from './TaskDetails.module.css'

/**
 * The one task layout's body (boards BJ, BL): what the task editor
 * (`TaskEditPopup`, every mode) and the review card (`ReviewDeck`, the
 * Review widget) show between their header and footer. **Two columns**: on
 * the left the **facts rail** (268px, giving way to 220px in a small card;
 * a darker ground, `rail` — Priority, Status, People, Tags, Due, then
 * Follow-up in its yellow box, `TaskFacts`); on the right **the writing** —
 * Notes and Subtasks, which scroll when a lot is written, above the
 * **updates dock**: Status updates (its heading, the log, the add line) on
 * the rail's darker ground under a hairline, at the bottom of the column —
 * so the line typed into sits just above the host's footer on every task.
 * A body taller than what is written gives the room to Notes. The rail
 * stays put while the writing scrolls (it scrolls on its own only when it
 * is taller than the body), so Follow-up never leaves the screen. Under
 * 640px of body (a narrow window, the phone's sheet) the rail goes above
 * the writing, its facts in two columns, and the body scrolls as one. The
 * header and footer are the host's.
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
          <div className={styles.writingScroll} data-task-writing-scroll="">
            {/* A slot each: the hosts key their sections by the task, and two siblings mustn't share a key. */}
            <Fragment key="notes">{notes}</Fragment>
            <Fragment key="subtasks">{subtasks}</Fragment>
          </div>
          <div className={styles.dock} data-task-dock="">{statusUpdates}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * The task layout's Notes, first in the writing (board BL): the label and
 * the notes editor in its dark box, its toolbar along the top — always
 * there, with a placeholder and room for four lines while empty. The box
 * grows with its text, and takes whatever room the writing has to spare.
 */
export function TaskNotesSection({ source, subtaskTarget }: {
  source: NotesSource
  subtaskTarget: NoteSubtaskTarget
}) {
  return (
    <section className={styles.notesSection} aria-label="Notes" data-task-notes="">
      <div className={styles.sectionLabel}>Notes</div>
      <div className={styles.notesBox} data-task-notes-box="">
        <NotesBody
          source={source}
          showToolbar
          placeholder="Add notes…"
          showPlaceholder
          subtaskTarget={subtaskTarget}
        />
      </div>
    </section>
  )
}
