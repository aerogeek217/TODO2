import styles from './TaskEditPopup.module.css'

/**
 * The task layout's section classes (D26 BB / BG), for the sections a host
 * renders into `TaskDetailsBody`'s slots — the task editor's and the review
 * card's alike, so both read the same: a section in the Subtasks | Notes
 * row, the Status updates section under it, and the sections' label.
 */
export const taskLayoutClasses = {
  /** A section in the Subtasks | Notes row: its label, then its body filling the cell. */
  pairSection: styles.pairSection,
  /** The Status updates section, under the row. */
  updatesSection: styles.updatesSection,
  /** A section's label (`SUBTASKS`, `NOTES`, `STATUS UPDATES`). */
  label: styles.notesLabel,
} as const
