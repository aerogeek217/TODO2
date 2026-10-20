import styles from './EntityEditor.module.css'

/** A People / Tags editor row's task count (open and completed): blank at 0, `N tasks` in its tooltip. */
export function TaskCount({ count }: { count: number }) {
  return (
    <span className={styles.initials} title={count === 1 ? '1 task' : `${count} tasks`} data-testid="entity-task-count">
      {count > 0 ? count : ''}
    </span>
  )
}
