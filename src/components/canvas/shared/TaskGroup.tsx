import type { ReactNode } from 'react'
import styles from './TaskGroup.module.css'

/**
 * TaskGroup — visual-only grouping header for tasks within a project.
 *
 * Contract:
 *  - Renders a small-caps label, a task count, and a thin rule.
 *  - When `color` is set, renders an 8 px circle swatch before the label.
 *    Date-bucket and ungrouped headers don't get a color (per Q4=A).
 *  - Children are the task rows for this group (already sorted by the caller).
 *  - Does not own collapse state, drag, or editing.
 *  - For projects with a single group-by setting, use one TaskGroup per
 *    distinct value; ungrouped items render WITHOUT a header, above all groups
 *    (see ProjectTaskList).
 */
export function TaskGroup({
  label,
  count,
  color,
  children,
}: {
  label: string
  count: number
  color?: string
  children: ReactNode
}) {
  return (
    <section className={styles.group} aria-label={label}>
      <header className={styles.header}>
        {color && (
          <span
            className={styles.swatch}
            style={{ background: color }}
            aria-hidden="true"
          />
        )}
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{count}</span>
        <div className={styles.rule} aria-hidden="true" />
      </header>
      <div className={styles.rows}>{children}</div>
    </section>
  )
}
