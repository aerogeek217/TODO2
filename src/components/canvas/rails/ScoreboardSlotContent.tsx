import styles from './ScoreboardSlotContent.module.css'

/**
 * Stub body for the `scoreboard` widget kind. Phase 4 of
 * stats-widgets-2026-04-25 replaces this with the three-card defer / completion
 * / lag metric grid backed by `selectDisciplineMetrics`.
 */
export function ScoreboardSlotContent() {
  return (
    <div className={styles.wrap}>
      <div className={styles.empty}>Coming soon.</div>
    </div>
  )
}
