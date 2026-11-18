import type { DateLevel } from '../../utils/row-date-state'
import styles from './DateBar.module.css'

/**
 * A date's bar before its text (date styling 2026-11-17): the calendar
 * entry's mark on a row date — its colour the date type (due magenta,
 * follow-up yellow), its strength `level` (faint later, full soon, heavier
 * late). A 3px box whatever the level, so the text after it never moves.
 */
export function DateBar({ type, level }: { type: 'due' | 'followup'; level: DateLevel }) {
  return <span className={styles.bar} data-date-bar={type} data-level={level} aria-hidden="true" />
}
