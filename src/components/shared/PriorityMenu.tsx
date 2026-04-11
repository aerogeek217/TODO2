import { Priority } from '../../models'
import styles from './PriorityMenu.module.css'

const PRIORITY_OPTIONS = [
  { value: Priority.High, label: 'High', color: 'var(--color-priority-high)' },
  { value: Priority.Medium, label: 'Medium', color: 'var(--color-priority-medium)' },
  { value: Priority.Normal, label: 'Normal', color: 'var(--color-text-muted)' },
] as const

interface PriorityMenuProps {
  currentPriority: Priority
  onSelect: (priority: Priority) => void
}

export function PriorityMenu({ currentPriority, onSelect }: PriorityMenuProps) {
  return (
    <div className={styles.menu}>
      {PRIORITY_OPTIONS.map(({ value, label, color }) => (
        <button
          key={value}
          className={`${styles.option} ${currentPriority === value ? styles.optionActive : ''}`}
          onClick={(e) => { e.stopPropagation(); onSelect(value) }}
        >
          <span className={styles.dot} style={{ background: color }} />
          {label}
        </button>
      ))}
    </div>
  )
}

export function getPriorityColor(priority: Priority): string | undefined {
  return priority === Priority.High
    ? 'var(--color-priority-high)'
    : priority === Priority.Medium
      ? 'var(--color-priority-medium)'
      : undefined
}

export function getPriorityLabel(priority: Priority): string {
  return priority === Priority.High ? 'High' : priority === Priority.Medium ? 'Medium' : 'Normal'
}
