import { Fragment, type ReactNode } from 'react'
import { trackScrollEdges } from '../../utils/scroll-edges'
import { NotesBody, type NotesSource } from './notes/NotesBody'
import type { NoteSubtaskTarget } from '../../services/note-subtasks'
import styles from './TaskDetails.module.css'

/**
 * The one task layout's body (task layout B, feedback 2026-11-15): what the
 * task editor (`TaskEditPopup`, every mode) and the review card (the Review
 * widget) show between their title and their footer.
 * First the **fact band** (`facts`: Priority · Status · People · Tags · Due,
 * `TaskFacts` / `TaskEditMetadata` — labelled cells in one row on a slightly
 * darker ground, thin dividers between them, wrapping when narrow). Then
 * **two columns**: on the left the **writing** — Subtasks, then Notes —, on
 * the right **Status updates**, oldest first and anchored to the bottom like
 * a log, the update line under them. The body is as tall as its taller column
 * (the editor's height fits its content); a host that holds it shorter (the
 * editor at its viewport cap, the review card in its cell) has each column
 * scroll inside — the log between its heading and the update line, the app's
 * edge fades showing there is more. Under 600px of body (a narrow window,
 * the phone's sheet) it is one column — Subtasks, Notes, Status updates —
 * and the body scrolls as one. The follow-up fields are the host's footer's
 * (`TaskFollowupFields`).
 */
export function TaskDetailsBody({ facts, notes, subtasks, statusUpdates }: {
  /** The fact band's cells (`FactSection`s). */
  facts: ReactNode
  notes: ReactNode
  subtasks: ReactNode
  statusUpdates: ReactNode
}) {
  return (
    <div className={styles.bodyFrame} data-task-frame="">
      <div className={styles.factBand} data-task-facts="">
        <div className={styles.factCells}>{facts}</div>
      </div>
      {/* Scrolls as one only in the one-column layout; the columns scroll inside otherwise. */}
      <div ref={trackScrollEdges} className={styles.body} data-task-body="">
        <div ref={trackScrollEdges} className={styles.writing} data-task-writing="">
          {/* A slot each: the hosts key their sections by the task, and two siblings mustn't share a key. */}
          <Fragment key="subtasks">{subtasks}</Fragment>
          <Fragment key="notes">{notes}</Fragment>
        </div>
        <div className={styles.updates} data-task-updates="">
          {statusUpdates}
        </div>
      </div>
    </div>
  )
}

/**
 * The task layout's Notes, after Subtasks in the writing (task layout B):
 * the label and the notes editor in its dark box — always there, one line
 * with its placeholder while empty, growing as it is written to 300px (then
 * it scrolls inside); it takes no more room than its text. The formatting
 * toolbar sits at the label line's right end, shown only while Notes has
 * the focus (`visibility`, so nothing shifts).
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
