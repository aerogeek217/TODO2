import { memo } from 'react'
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from '@dnd-kit/core'
import type { PersistedTodoItem, Person, Org, Status } from '../../../../models'
import { TaskPillDates, TaskPillPeople, TaskPillStatus } from '../../../shared/TaskPillBar'
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
  today: Date
  weekStartsOn: 0 | 1
  /** Compact variant: tighter padding, hides org chip, limits people to 2. Used by the horizontal calendar column where space is narrow. */
  compact?: boolean
  onClick?: () => void
  /** dnd-kit draggable wiring. CalendarStrip wraps each row in a
   * `TaskDraggable` render-prop; these props splat the ref + listeners onto
   * the outer row element so the row itself is the drag source (Phase 7 of
   * the DnD unification — replaces native HTML5 drag). */
  dragRef?: (node: HTMLElement | null) => void
  dragAttributes?: DraggableAttributes
  dragListeners?: DraggableSyntheticListeners
  draggable?: boolean
}

export const EventRow = memo(function EventRow({
  entry,
  today,
  weekStartsOn,
  compact = false,
  onClick,
  dragRef,
  dragAttributes,
  dragListeners,
  draggable = false,
}: EventRowProps) {
  const { todo, isVirtual, people, orgs, status } = entry
  const className = [
    styles.event,
    compact && styles.eventCompact,
    draggable && styles.eventDraggable,
    todo.isCompleted && styles.eventCompleted,
    isVirtual && styles.eventVirtual,
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={dragRef}
      className={className}
      onClick={onClick}
      {...(dragAttributes ?? {})}
      {...(dragListeners ?? {})}
      title={isVirtual ? `Recurring instance of "${todo.title}"` : todo.title}
    >
      <TaskPillDates
        todo={todo}
        today={today}
        weekStartsOn={weekStartsOn}
        interactive={false}
        compact
      />
      <span className={styles.title}>{todo.title}</span>
      <TaskPillPeople
        people={people}
        orgs={orgs}
        interactive={false}
        compact={compact}
        density="small"
      />
      <TaskPillStatus status={status} interactive={false} />
    </div>
  )
})
