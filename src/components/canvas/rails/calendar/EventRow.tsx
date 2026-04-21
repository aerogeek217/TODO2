import { memo } from 'react'
import type { PersistedTodoItem, Person, Org, Status } from '../../../../models'
import { StatusIcon } from '../../../shared/StatusIcon'
import { AvatarStack } from '../../../shared/AvatarStack'
import styles from './EventRow.module.css'

export interface EventRowEntry {
  todo: PersistedTodoItem
  isVirtual: boolean
  people: Person[]
  orgs: Org[]
  status: Status | undefined
}

interface EventRowProps {
  entry: EventRowEntry
  onClick?: () => void
}

export const EventRow = memo(function EventRow({ entry, onClick }: EventRowProps) {
  const { todo, isVirtual, people, orgs, status } = entry
  const className = [
    styles.event,
    todo.isCompleted && styles.eventCompleted,
    isVirtual && styles.eventVirtual,
  ].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      onClick={onClick}
      title={isVirtual ? `Recurring instance of "${todo.title}"` : todo.title}
    >
      <span className={styles.status} style={status ? { color: status.color } : undefined} aria-label={status ? `Status: ${status.name}` : 'No status'}>
        {status
          ? <StatusIcon icon={status.icon || 'circle'} filled />
          : <span className={styles.statusEmpty} aria-hidden="true" />}
      </span>
      {todo.scheduledDate && (
        <span className={`${styles.marker} ${styles.markerScheduled}`} aria-label="Scheduled">
          <StatusIcon icon="calendar" />
        </span>
      )}
      {todo.dueDate && (
        <span className={`${styles.marker} ${styles.markerDeadline}`} aria-label="Deadline">
          <StatusIcon icon="clock" />
        </span>
      )}
      {todo.recurrenceRule && (
        <span className={styles.marker} title={`Repeats ${todo.recurrenceRule.type}`} aria-label="Recurring">&#x21bb;</span>
      )}
      <span className={styles.title}>{todo.title}</span>
      {people.length > 0 && (
        <AvatarStack people={people} max={3} size="sm" />
      )}
      {orgs.length > 0 && (
        <AvatarStack people={orgs} max={2} size="sm" variant="hollow" />
      )}
    </div>
  )
})
