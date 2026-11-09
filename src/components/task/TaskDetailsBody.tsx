import type { ReactNode } from 'react'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { NotesBody, type NotesSource } from './notes/NotesBody'
import type { NoteSubtaskTarget } from '../../services/note-subtasks'
import styles from './TaskEditPopup.module.css'

/**
 * The one task layout's body (D26 BB / BG): what the task editor
 * (`TaskEditPopup`, every mode) and the review card (`ReviewDeck`) show
 * between their header and footer, in one order — the fields (Due + repeat,
 * People, Tags) · **Subtasks | Notes side by side** (the row grows to
 * ~240px, then each scrolls inside; stacked under 640px of window) ·
 * **Status updates** (oldest first, the add line last; ~200px, then the
 * list scrolls inside, opening at the bottom) · the **Follow-up** group
 * last. The body scrolls between the host's header and footer; a picker
 * open in the fields stops it scrolling (`dropdownOpen`), so the picker
 * stays under its row. The header and badges are the host's, above it.
 */
export function TaskDetailsBody({ fields, subtasks, notes, statusUpdates, followup, dropdownOpen = false }: {
  fields: ReactNode
  subtasks: ReactNode
  notes: ReactNode
  statusUpdates: ReactNode
  followup: ReactNode
  dropdownOpen?: boolean
}) {
  return (
    <div className={`${styles.scrollBody} ${dropdownOpen ? styles.scrollBodyDropdownOpen : ''}`} data-task-body="">
      {fields}
      <div className={styles.pair} data-task-pair="">
        <div className={styles.pairCell}>{subtasks}</div>
        <div className={styles.pairCell}>{notes}</div>
      </div>
      {statusUpdates}
      {followup}
    </div>
  )
}

/** The task layout's Notes: the label and the notes editor with its toolbar, filling its half of the row. */
export function TaskNotesSection({ source, subtaskTarget }: {
  source: NotesSource
  subtaskTarget: NoteSubtaskTarget
}) {
  return (
    <section className={styles.pairSection} aria-label="Notes" data-task-notes="">
      <div className={styles.notesLabel}>Notes</div>
      <div className={styles.notesBodyWrap}>
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

/** The Follow-up group's block, last in the layout: the inset, its heading, then the host's rows (Next, Last). */
export function FollowupBlock({ children }: { children: ReactNode }) {
  return (
    <div className={styles.followupBlock} data-task-followup="">
      <div className={styles.followupHeading}>
        <FollowupFlagIcon />
        Follow-up
      </div>
      {children}
    </div>
  )
}

/** A labelled row of the layout's blocks (the fields', the Follow-up group's): `NEXT  …`. */
export function DetailsRow({ label, labelFor, children }: {
  label: string
  /** The field the label names (a `<label>`), else a plain caption. */
  labelFor?: string
  children: ReactNode
}) {
  return (
    <div className={styles.metaRow}>
      {labelFor
        ? <label className={styles.metaLabel} htmlFor={labelFor}>{label}</label>
        : <span className={styles.metaLabel}>{label}</span>}
      {children}
    </div>
  )
}
