import { useCallback, memo } from 'react'
import type { PersistedTodoItem, Person } from '../../models'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useBulkActions } from '../../hooks/use-bulk-actions'
import { StatusIcon } from '../shared/StatusIcon'
import { AvatarStack } from '../shared/AvatarStack'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { startOfToday, formatDateShort } from '../../utils/date'
import { scheduledLabel, isScheduledPast, isDeadlinePast, resolveScheduled, daysUntil, dateIntensity } from '../../utils/effective-date'
import styles from './MobileTaskRow.module.css'

interface MobileTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  indentLevel?: number
  hasChildren?: boolean
  isSelected?: boolean
  ghost?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onOpenDetail?: (todoId: number) => void
  cut?: boolean
}

export const MobileTaskRow = memo(function MobileTaskRow({
  todo, assignedPeople, indentLevel = 0,
  hasChildren, isSelected, ghost,
  onSelect, onOpenDetail, cut,
}: MobileTaskRowProps) {
  const assignedOrgsForTodo = useOrgStore((s) => s.assignedOrgsMap.get(todo.id))
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const bulk = useBulkActions()
  const today = startOfToday()
  const scheduledPast = isScheduledPast({ scheduledDate: todo.scheduledDate }, today)
  const deadlinePast = isDeadlinePast({ dueDate: todo.dueDate }, today)
  const scheduledIntensity = dateIntensity(daysUntil(resolveScheduled(todo.scheduledDate, today), today))
  const deadlineIntensity = dateIntensity(daysUntil(todo.dueDate, today))
  const assignedOrgs = assignedOrgsForTodo ?? []

  const handleToggleComplete = useCallback(() => {
    if (!ghost) bulk.toggleComplete(todo.id)
  }, [ghost, bulk, todo.id])

  const handleChevronTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenDetail?.(todo.id)
  }, [onOpenDetail, todo.id])

  const handleRowTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.(todo.id, { shift: false, ctrl: false })
  }, [onSelect, todo.id])

  const status = useStatusStore((s) => {
    if (!todo.statusId) return undefined
    return s.statuses.find(st => st.id === todo.statusId)
  })
  const quickStatusId = useSettingsStore((s) => s.quickStatusId)

  // Metadata for line 2
  const people = assignedPeople ?? []
  const hasMetadata =
    !!todo.scheduledDate || !!todo.dueDate ||
    people.length > 0 || assignedOrgs.length > 0 ||
    !!todo.notes || !!todo.progress

  return (
    <div
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${ghost ? styles.ghost : ''} ${cut ? styles.cut : ''} ${isSelected ? styles.selected : ''}`}
      style={indentLevel > 0 ? { paddingLeft: `${4 + indentLevel * 16}px` } : undefined}
      data-todo-id={todo.id}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      role="button"
      tabIndex={0}
      onClick={handleRowTap}
      onMouseEnter={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(todo.id)}
      onMouseLeave={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(null)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowTap(e as unknown as React.MouseEvent) } }}
    >
      {/* Line 1 */}
      <div className={styles.primaryRow}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={todo.isCompleted}
          onChange={handleToggleComplete}
          onClick={(e) => e.stopPropagation()}
          aria-label="Toggle complete"
        />

        <span className={`${styles.title} ${hasChildren ? styles.parentTitle : ''} ${todo.isCompleted ? styles.completedTitle : ''}`}>
          {todo.title}
        </span>

        <button
          className={styles.statusButton}
          style={status ? { color: status.color } : undefined}
          onClick={(e) => {
            e.stopPropagation()
            if (!ghost) {
              if (!todo.statusId && quickStatusId != null) {
                useTodoStore.getState().update({ ...todo, statusId: quickStatusId, modifiedAt: new Date() })
              } else if (todo.statusId) {
                useTodoStore.getState().update({ ...todo, statusId: undefined, modifiedAt: new Date() })
              }
            }
          }}
          aria-label={status ? `Status: ${status.name}` : 'Set status'}
        >
          {status ? (
            <StatusIcon icon={status.icon || 'circle'} filled />
          ) : (
            <span className={styles.statusDotEmpty} />
          )}
        </button>

        <button className={styles.chevron} onClick={handleChevronTap} aria-label="Open task details">
          ▸
        </button>
      </div>

      {/* Line 2: metadata */}
      {hasMetadata && (
        <div className={styles.metaRow}>
          {todo.scheduledDate && (
            <span
              className={`${styles.scheduledChip} ${scheduledPast ? styles.scheduledChipPast : ''}`}
              style={{ '--date-intensity': scheduledIntensity } as React.CSSProperties}
            >
              {scheduledLabel(todo.scheduledDate, today)}
            </span>
          )}

          {todo.dueDate && (
            <span
              className={`${styles.deadlineChip} ${deadlinePast ? styles.deadlineChipPast : ''}`}
              style={{ '--date-intensity': deadlineIntensity } as React.CSSProperties}
            >
              {todo.recurrenceRule && <span className={styles.recurrenceIndicator}>&#x21bb;</span>}
              {formatDateShort(todo.dueDate)}
            </span>
          )}

          {people.length > 0 && (
            <AvatarStack people={people} max={3} size="sm" />
          )}

          {assignedOrgs.length > 0 && (
            <AvatarStack people={assignedOrgs} max={3} size="sm" variant="hollow" />
          )}

          {todo.progress && (
            <span className={styles.progressChip}>
              {todo.progress}
              {(() => {
                const m = todo.progress.match(/(\d+)\s*%/)
                if (!m) return null
                const pct = Math.min(100, Math.max(0, parseInt(m[1])))
                return (
                  <span className={styles.progressBarTrack}>
                    <span className={styles.progressBarFill} style={{ width: `${pct}%` }} />
                  </span>
                )
              })()}
            </span>
          )}

          {todo.notes && (
            <span className={styles.notesIcon}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 1.5h6.5L13 5v9a0.5 0.5 0 0 1-0.5 0.5h-9.5A0.5 0.5 0 0 1 2.5 14V2a0.5 0.5 0 0 1 0.5-0.5Z" />
                <path d="M9.5 1.5V5H13" />
                <path d="M5 8h6M5 11h4" />
              </svg>
            </span>
          )}
        </div>
      )}
    </div>
  )
})
