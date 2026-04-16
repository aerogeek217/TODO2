import { useCallback, memo } from 'react'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useBulkActions } from '../../hooks/use-bulk-actions'
import { getPriorityColor } from '../shared/PriorityMenu'
import { StatusIcon } from '../shared/StatusIcon'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import styles from './MobileTaskRow.module.css'

interface MobileTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  assignedTags?: Tag[]
  indentLevel?: number
  hasChildren?: boolean
  isExpanded?: boolean
  isSelected?: boolean
  ghost?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onToggleExpand?: (todoId: number) => void
  onOpenDetail?: (todoId: number) => void
  cut?: boolean
}

function formatDueDate(date: Date): { text: string; overdue: boolean; dueToday: boolean; urgent: boolean; approaching: boolean } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const due = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, overdue: true, dueToday: false, urgent: false, approaching: false }
  if (diff === 0) return { text: 'Today', overdue: false, dueToday: true, urgent: false, approaching: false }
  if (diff === 1) return { text: 'Tomorrow', overdue: false, dueToday: false, urgent: true, approaching: false }
  if (diff <= 3) return { text: due.toLocaleDateString('en-US', { weekday: 'short' }), overdue: false, dueToday: false, urgent: false, approaching: true }
  if (diff <= 7) return { text: due.toLocaleDateString('en-US', { weekday: 'short' }), overdue: false, dueToday: false, urgent: false, approaching: false }
  return { text: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: false, dueToday: false, urgent: false, approaching: false }
}

export const MobileTaskRow = memo(function MobileTaskRow({
  todo, assignedPeople, assignedTags, indentLevel = 0,
  hasChildren, isExpanded, isSelected, ghost,
  onSelect, onToggleExpand, onOpenDetail, cut,
}: MobileTaskRowProps) {
  const assignedOrgsForTodo = useOrgStore((s) => s.assignedOrgsMap.get(todo.id))
  const bulk = useBulkActions()
  const priorityColor = getPriorityColor(todo.priority)
  const dueInfo = todo.dueDate ? formatDueDate(new Date(todo.dueDate)) : null
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
  const tags = assignedTags ?? []
  const hasMetadata = dueInfo || people.length > 0 || tags.length > 0 || assignedOrgs.length > 0 || !!todo.notes || !!todo.progress || !!todo.isHardDeadline

  return (
    <div
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${ghost ? styles.ghost : ''} ${cut ? styles.cut : ''} ${isSelected ? styles.selected : ''}`}
      style={indentLevel > 0 ? { paddingLeft: `${4 + indentLevel * 16}px` } : undefined}
      data-todo-id={todo.id}
      role="button"
      tabIndex={0}
      onClick={handleRowTap}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowTap(e as unknown as React.MouseEvent) } }}
    >
      {/* Line 1 */}
      <div className={styles.primaryRow}>
        <div
          className={`${styles.priorityStrip} ${!priorityColor ? styles.priorityStripNormal : ''}`}
          style={priorityColor ? { background: priorityColor, borderColor: priorityColor } : undefined}
        />

        {!hasChildren && (
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={todo.isCompleted}
            onChange={handleToggleComplete}
            onClick={(e) => e.stopPropagation()}
            aria-label="Toggle complete"
          />
        )}

        {hasChildren && (
          <button
            className={`${styles.expandToggle} ${isExpanded ? '' : styles.expandToggleCollapsed}`}
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(todo.id) }}
            aria-expanded={isExpanded}
            aria-label="Toggle subtasks"
          >
            ▾
          </button>
        )}

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
          {status?.icon ? (
            <StatusIcon icon={status.icon} filled />
          ) : status ? (
            <span className={styles.statusBadgeDot} style={{ background: status.color }} />
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
        <div className={styles.metaRow} style={hasChildren ? { paddingLeft: '70px' } : undefined}>
          {dueInfo && (
            <span className={`${styles.dueChip} ${dueInfo.overdue ? styles.dueOverdue : ''} ${dueInfo.dueToday ? styles.dueToday : ''} ${dueInfo.urgent ? styles.dueUrgent : ''} ${dueInfo.approaching ? styles.dueApproaching : ''}`}>
              {todo.recurrenceRule && <span className={styles.recurrenceIndicator}>&#x21bb;</span>}
              {dueInfo.text}
            </span>
          )}

          {todo.isHardDeadline && <span className={styles.hardDeadlineIcon} title="Hard deadline">⚑</span>}

          {people.slice(0, 2).map((p) => (
            <span key={p.id} className={styles.personChip} style={p.color ? { color: p.color } : undefined}>
              {p.initials}
            </span>
          ))}
          {people.length > 2 && <span className={styles.overflow}>+{people.length - 2}</span>}

          {tags.slice(0, 1).map((t) => (
            <span key={t.id} className={styles.tagChip} style={{ borderColor: t.color || 'var(--color-border)', color: t.color || 'var(--color-text-secondary)' }}>
              {t.name}
            </span>
          ))}
          {tags.length > 1 && <span className={styles.overflow}>+{tags.length - 1}</span>}

          {assignedOrgs.slice(0, 1).map((o) => (
            <span key={o.id} className={styles.orgChip} style={o.color ? { borderColor: o.color, color: o.color } : undefined}>
              {o.name}
            </span>
          ))}

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
