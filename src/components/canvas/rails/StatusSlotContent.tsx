import styles from './StatusSlotContent.module.css'

/**
 * Stub body for the `status` widget kind. Phase 2 of stats-widgets-2026-04-25
 * replaces this with the real stacked-bar + legend implementation backed by
 * `selectStatusBreakdown`.
 */
export function StatusSlotContent() {
  return (
    <div className={styles.wrap}>
      <div className={styles.empty}>Coming soon.</div>
    </div>
  )
}
