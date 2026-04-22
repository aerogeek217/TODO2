import styles from './DropIndicator.module.css'

type DropIndicatorLineProps = {
  kind: 'line'
}

type DropIndicatorGroupProps = {
  kind: 'group'
  /** Total height of the group block in px; driven by `rows × ROW_HEIGHT_PX`. */
  height: number
}

type DropIndicatorCellProps = {
  kind: 'cell'
}

export type DropIndicatorProps =
  | DropIndicatorLineProps
  | DropIndicatorGroupProps
  | DropIndicatorCellProps

/**
 * Unified drop-target feedback used by every surface that accepts task
 * drags. Three modes:
 *
 *  - **line**: thin accent bar inserted between rows (SortableTaskList,
 *    TaskboardPanel, TaskboardNode).
 *  - **group**: dashed-border block sized to a multi-row drag selection
 *    (SortableTaskList's multi-select preview).
 *  - **cell**: whole-container tint + inset accent ring
 *    (CalendarView / CalendarStrip day cells, taskboard containers — applied
 *    via {@link dropCellClassName} on an existing element so it composes
 *    with layout classes instead of wrapping the child).
 *
 * For line / group modes the component renders a `<div>` in-place. For cell
 * mode the component returns the className; most callers prefer
 * {@link dropCellClassName} to avoid inversion of control.
 */
export function DropIndicator(props: DropIndicatorProps) {
  if (props.kind === 'line') {
    return <div className={styles.line} aria-hidden="true" />
  }
  if (props.kind === 'group') {
    return <div className={styles.group} style={{ height: `${props.height}px` }} aria-hidden="true" />
  }
  // kind === 'cell' — callers usually reach for dropCellClassName instead;
  // this branch keeps the API symmetric.
  return <div className={styles.cell} aria-hidden="true" />
}

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
  return active ? styles.cell : ''
}
