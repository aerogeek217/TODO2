import styles from './SnoozeGraveyardSlotContent.module.css'

/**
 * Stub body for the `snoozeGraveyard` widget kind. Phase 5 of
 * stats-widgets-2026-04-25 replaces this with the top-N most-rescheduled
 * todo list backed by `selectMostDeferred`.
 */
export function SnoozeGraveyardSlotContent() {
  return (
    <div className={styles.wrap}>
      <div className={styles.empty}>Coming soon.</div>
    </div>
  )
}
