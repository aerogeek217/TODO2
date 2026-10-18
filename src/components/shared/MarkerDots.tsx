import type { MarkerSummary } from '../../utils/markers'
import styles from './MarkerDots.module.css'

/**
 * A task's markers as three dots in a column, top to bottom Focus · Urgent ·
 * Important (off = a faint dot; urgent only by its due date = a ring).
 * Display only: the row's gutter button or the phone row's label carries the
 * name.
 */
export function MarkerDots({ summary, dim = false }: { summary: MarkerSummary; dim?: boolean }) {
  return (
    <span className={`${styles.dots} ${dim ? styles.dim : ''}`} aria-hidden="true" data-marker-dots="">
      <span className={`${styles.dot} ${summary.focus ? styles.focus : ''}`} data-dot="focus" data-on={summary.focus || undefined} />
      <span
        className={`${styles.dot} ${summary.urgent === 'flag' ? styles.urgent : summary.urgent === 'date' ? styles.urgentRing : ''}`}
        data-dot="urgent"
        data-on={summary.urgent ?? undefined}
      />
      <span className={`${styles.dot} ${summary.important ? styles.important : ''}`} data-dot="important" data-on={summary.important || undefined} />
    </span>
  )
}
