import { useMemo } from 'react'
import { useTodoStore } from '../../../stores/todo-store'
import { useStatusStore } from '../../../stores/status-store'
import { StatusIcon } from '../../shared/StatusIcon'
import { selectStatusBreakdown } from '../../../services/stats/status-breakdown'
import styles from './StatusSlotContent.module.css'

/**
 * Rail/float widget body for the `status` widget kind. Renders a stacked
 * hero bar (segments proportional to per-status open counts) above a legend
 * row per status (icon · label · count · percent). Driven by
 * `selectStatusBreakdown` over the live todo + status stores.
 */
export function StatusSlotContent() {
  const todos = useTodoStore((s) => s.todos)
  // todosVersion bumps on field-only edits (e.g. statusId change) where the
  // `todos` array reference is stable — subscribe so the breakdown reflows.
  const todosVersion = useTodoStore((s) => s.todosVersion)
  const statuses = useStatusStore((s) => s.statuses)

  const entries = useMemo(
    () => selectStatusBreakdown(todos, statuses),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todos, todosVersion, statuses],
  )

  const total = entries.reduce((sum, e) => sum + e.count, 0)

  if (total === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>No open tasks</div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.heroBar} role="img" aria-label={`${total} open tasks by status`}>
        {entries.map((e) => (
          e.count > 0 ? (
            <div
              key={e.id ?? 'none'}
              className={styles.heroSegment}
              style={{ flexGrow: e.count, background: e.color }}
              title={`${e.label}: ${e.count}`}
            />
          ) : null
        ))}
      </div>
      <div className={styles.legendRows}>
        {entries.map((e) => {
          const pct = total > 0 ? Math.round((e.count / total) * 100) : 0
          return (
            <div key={e.id ?? 'none'} className={styles.legendRow}>
              <span className={styles.legendIcon} style={{ color: e.color }}>
                <StatusIcon icon={e.icon} filled />
              </span>
              <span className={styles.legendLabel}>{e.label}</span>
              <span className={styles.legendCount}>{e.count}</span>
              <span className={styles.legendPct}>{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
