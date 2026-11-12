import { Fragment, type ReactNode } from 'react'
import { trackScrollEdges } from '../../utils/scroll-edges'
import { NotesBody, type NotesSource } from './notes/NotesBody'
import type { NoteSubtaskTarget } from '../../services/note-subtasks'
import styles from './TaskDetails.module.css'

/**
 * The one task layout's body (boards BJ, BL; task layout A, 2026-11-10):
 * what the task editor (`TaskEditPopup`, every mode) and the review card
 * (the Review widget) show between their header and footer.
 * **Two columns**: on the left the **facts rail** (268px, giving way to
 * 220px in a small card; a darker ground — Priority, Status, People, Tags,
 * Due, `TaskFacts`; the editor's Created · Modified at its foot); on the
 * right **the writing** — Notes and Subtasks, which scroll (the app's edge
 * fades while there is more), above the **dock**: Status updates (its
 * heading, the log, the update line), then under a hairline the follow-up
 * rows (`followup`: Next and Last follow-up, `TaskFollowupRows`), on the
 * rail's darker ground. The dock never scrolls out of view: when the card is
 * short the writing gives way down to 120px, then the dock's log down to one
 * entry; the update line and the follow-up rows never shrink. A card taller
 * than what is written leaves the spare room empty above the dock. The rail
 * scrolls on its own only when it is taller than the body. Under 600px of
 * body (a narrow window, the phone's sheet) the rail goes above the writing,
 * its facts in two columns, and the body scrolls as one (not pinned). The
 * header and footer are the host's.
 */
export function TaskDetailsBody({ rail, notes, subtasks, statusUpdates, followup }: {
  rail: ReactNode
  notes: ReactNode
  subtasks: ReactNode
  statusUpdates: ReactNode
  /** The follow-up rows, last in the dock under a hairline. */
  followup: ReactNode
}) {
  return (
    <div className={styles.bodyFrame}>
      <div className={styles.body} data-task-body="">
        {/* Scrolls only when taller than the body: then its edge fades say there is more. */}
        <div ref={trackScrollEdges} className={styles.rail} data-task-rail="">{rail}</div>
        <div className={styles.writing} data-task-writing="">
          <div ref={trackScrollEdges} className={styles.writingScroll} data-task-writing-scroll="">
            {/* A slot each: the hosts key their sections by the task, and two siblings mustn't share a key. */}
            <Fragment key="notes">{notes}</Fragment>
            <Fragment key="subtasks">{subtasks}</Fragment>
          </div>
          <div className={styles.dock} data-task-dock="">
            {statusUpdates}
            <div className={styles.followup} data-task-followup="">{followup}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The foot of the facts rail (the task editor's `Created … · Modified …`):
 * small and muted, pushed to the rail's bottom.
 */
export function TaskRailFoot({ children }: { children: ReactNode }) {
  return <div className={styles.railFoot} data-task-rail-foot="">{children}</div>
}

/**
 * The task layout's Notes, first in the writing (board BL, task layout A):
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
