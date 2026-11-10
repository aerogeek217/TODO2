import styles from './TaskDetails.module.css'

/**
 * The task layout's writing-side classes (board BJ), for the sections a
 * host renders into `TaskDetailsBody`'s slots — the task editor's and the
 * review card's alike, so both read the same: a section of the writing
 * (Subtasks, Status updates) and its label.
 */
export const taskLayoutClasses = {
  /** A section of the writing: its label, then its body. */
  section: styles.writingSection,
  /** A section's label (`SUBTASKS`, `STATUS UPDATES`). */
  label: styles.sectionLabel,
} as const
