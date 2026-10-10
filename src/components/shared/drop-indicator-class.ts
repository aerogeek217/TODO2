import styles from './DropIndicator.module.css'

/**
 * Returns the shared "cell" drop-indicator className, or empty string when
 * the indicator should be hidden. Use when a drop target wants to toggle
 * cell-mode feedback without wrapping its DOM:
 *
 * ```tsx
 * <div className={`${styles.panel} ${dropCellClassName(isDragOver)}`}>…</div>
 * ```
 */
export function dropCellClassName(active: boolean): string {
  return active ? (styles.cell ?? '') : ''
}
