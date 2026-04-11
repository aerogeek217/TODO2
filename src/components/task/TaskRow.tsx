import { useRef, useState, useCallback, useMemo, memo } from 'react'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { Priority } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useUIStore } from '../../stores/ui-store'
import { useBulkActions } from '../../hooks/use-bulk-actions'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useInlineEdit } from '../../hooks/use-inline-edit'
import { generateInitials } from '../../utils/person'
import { toDateInputValue } from '../../utils/date'
import { INDENT_PX, TASK_ROW_PADDING_LEFT } from '../../constants'
import { ChipSelector } from '../shared/ChipSelector'
import { PriorityMenu, getPriorityColor } from '../shared/PriorityMenu'
import styles from './TaskRow.module.css'

interface TaskRowProps {
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
  /** Show compact people chips (initials only) */
  compact?: boolean
  /** Task is in clipboard (cut) */
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

export const TaskRow = memo(function TaskRow({
  todo, assignedPeople, assignedTags, indentLevel = 0,
  hasChildren, isExpanded, isSelected, ghost,
  onSelect, onToggleExpand, onOpenDetail, compact, cut,
}: TaskRowProps) {
  const dateRef = useRef<HTMLInputElement>(null)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<'people' | 'tags' | null>(null)
  const priorityMenuRef = useRef<HTMLDivElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)

  // Read entity lists from stores
  const allPeople = usePersonStore((s) => s.people)
  const allTags = useTagStore((s) => s.tags)
  const allOrgs = useOrgStore((s) => s.orgs)
  const assignedOrgsForTodo = useOrgStore((s) => s.assignedOrgsMap.get(todo.id))
  const assignedOrgIds = useMemo(() => new Set((assignedOrgsForTodo ?? []).map(o => o.id!)), [assignedOrgsForTodo])

  // Bulk-aware mutation callbacks
  const bulk = useBulkActions()

  // Inline title editing
  const handleSaveTitle = useCallback((newTitle: string) => {
    useTodoStore.getState().update({ ...todo, title: newTitle, modifiedAt: new Date() })
  }, [todo])
  const edit = useInlineEdit(todo.title, handleSaveTitle)

  const priorityColor = getPriorityColor(todo.priority)

  const dueInfo = todo.dueDate ? formatDueDate(new Date(todo.dueDate)) : null
  const dateValue = toDateInputValue(todo.dueDate)
  const assignedOrgs = assignedOrgsForTodo ?? []
  const hasPeople = (assignedPeople && assignedPeople.length > 0) || assignedOrgs.length > 0
  const hasTags = assignedTags && assignedTags.length > 0

  // Click-outside handlers
  const closePriority = useCallback(() => setShowPriorityMenu(false), [])
  const closeDropdown = useCallback(() => setOpenDropdown(null), [])
  useClickOutside(priorityMenuRef, closePriority, showPriorityMenu)
  useClickOutside(peopleRef, closeDropdown, openDropdown === 'people')
  useClickOutside(tagsRef, closeDropdown, openDropdown === 'tags')

  // Ghost rows are non-interactive (drag overlay visuals)
  const handleToggleComplete = useCallback(() => { if (!ghost) bulk.toggleComplete(todo.id) }, [ghost, bulk, todo.id])
  const handleToggleStar = useCallback(() => { if (!ghost) bulk.toggleStar(todo.id) }, [ghost, bulk, todo.id])
  const handleDelete = useCallback(() => { if (!ghost) bulk.remove(todo.id) }, [ghost, bulk, todo.id])
  const handleSetPriority = useCallback((p: Priority) => { if (!ghost) bulk.setPriority(todo.id, p) }, [ghost, bulk, todo.id])
  const handleSetDueDate = useCallback((date: Date | undefined) => { if (!ghost) bulk.setDueDate(todo.id, date) }, [ghost, bulk, todo.id])

  const togglePerson = (id: number) => {
    if (ghost) return
    const isAssigned = assignedPeople?.some((p) => p.id === id)
    if (isAssigned) bulk.quickUnassignPerson(todo.id, id)
    else bulk.quickAssignPerson(todo.id, id)
  }

  const toggleTag = (id: number) => {
    if (ghost) return
    const isAssigned = assignedTags?.some((t) => t.id === id)
    if (isAssigned) bulk.quickUnassignTag(todo.id, id)
    else bulk.quickAssignTag(todo.id, id)
  }

  const toggleOrg = (orgId: number) => {
    if (ghost) return
    if (assignedOrgIds.has(orgId)) bulk.quickUnassignOrg(todo.id, orgId)
    else bulk.quickAssignOrg(todo.id, orgId)
  }

  const handleCreatePerson = async (name: string) => {
    if (ghost) return
    const id = await usePersonStore.getState().add(name, generateInitials(name))
    bulk.quickAssignPerson(todo.id, id)
  }

  const handleCreateTag = async (name: string) => {
    if (ghost) return
    const id = await useTagStore.getState().add(name)
    bulk.quickAssignTag(todo.id, id)
  }

  const assignedPeopleIds = useMemo(() => new Set((assignedPeople ?? []).map(p => p.id!)), [assignedPeople])
  const assignedTagIds = useMemo(() => new Set((assignedTags ?? []).map(t => t.id!)), [assignedTags])

  return (
    <div
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${todo.isAssigned ? styles.assigned : ''} ${ghost ? styles.ghost : ''} ${cut ? styles.cut : ''} ${showPriorityMenu || openDropdown ? styles.rowDropdownOpen : ''}`}
      style={indentLevel > 0 ? { paddingLeft: `${TASK_ROW_PADDING_LEFT + indentLevel * INDENT_PX}px` } : undefined}
      data-todo-id={todo.id}
      onClick={(e) => { e.stopPropagation(); onSelect?.(todo.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }) }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        edit.cancelScheduledEdit()
        if (!edit.isEditing) onOpenDetail?.(todo.id)
      }}
    >
      <span className={styles.dragHandle} aria-hidden="true">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </span>

      {hasChildren && (
        <button
          className={`${styles.expandToggle} ${isExpanded ? '' : styles.expandToggleCollapsed}`}
          onClick={(e) => { e.stopPropagation(); onToggleExpand?.(todo.id) }}
          aria-label={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
        >
          ▾
        </button>
      )}

      {/* Priority strip */}
      <div className={styles.priorityStripWrapper} ref={priorityMenuRef}>
        <button
          className={`${styles.priorityStrip} ${!priorityColor ? styles.priorityStripNormal : ''}`}
          style={priorityColor ? { background: priorityColor, borderColor: priorityColor } : undefined}
          onClick={(e) => { e.stopPropagation(); if (!ghost) setShowPriorityMenu((v) => !v) }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); useUIStore.getState().showFilteredList(e.clientX, e.clientY, { type: 'priority', priority: todo.priority }) }}
          title="Set priority"
          aria-label="Set priority"
        />
        {showPriorityMenu && !ghost && (
          <PriorityMenu currentPriority={todo.priority} onSelect={(p) => { handleSetPriority(p); setShowPriorityMenu(false) }} />
        )}
      </div>

      <input
        type="checkbox"
        className={styles.checkbox}
        checked={todo.isCompleted}
        onChange={handleToggleComplete}
        onClick={(e) => e.stopPropagation()}
        aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
      />

      {edit.isEditing ? (
        <input
          ref={edit.inputRef}
          className={styles.titleInput}
          value={edit.editTitle}
          maxLength={500}
          onChange={(e) => edit.setEditTitle(e.target.value)}
          onBlur={edit.save}
          onKeyDown={edit.handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={`${styles.title} ${todo.isCompleted ? styles.completedTitle : ''}`}
          title={todo.title}
          onClick={(e) => {
            e.stopPropagation()
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
              onSelect?.(todo.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
            } else if (isSelected) {
              edit.scheduleEdit()
            } else {
              onSelect?.(todo.id, { shift: false, ctrl: false })
            }
          }}
        >
          {todo.title}
        </span>
      )}

      {/* Notes indicator */}
      {todo.notes && (
        <span className={styles.notesIndicator} title="Has notes">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 2.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 3v-11a1 1 0 0 1 1-1Z" />
          </svg>
        </span>
      )}

      {/* Progress label with visual bar */}
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

      {/* People chip group */}
      {!ghost && (
        <div className={`${styles.chipGroup} ${hasPeople ? '' : styles.chipGroupEmpty}`} ref={peopleRef}>
          {hasPeople ? (
            <>
              {(assignedPeople ?? []).map((person) => (
                <button key={person.id} className={styles.personChip}
                  style={person.color ? { color: person.color } : undefined}
                  title={compact ? person.name : undefined}
                  onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'people' ? null : 'people') }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); useUIStore.getState().showFilteredList(e.clientX, e.clientY, { type: 'person', personId: person.id!, personName: person.name }) }}>
                  {compact ? person.initials : `@${person.name}`}
                </button>
              ))}
              {assignedOrgs.map((org) => (
                <button key={`org-${org.id}`} className={styles.orgChip}
                  style={org.color ? { borderColor: org.color, color: org.color } : undefined}
                  title={compact ? org.name : undefined}
                  onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'people' ? null : 'people') }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); useUIStore.getState().showFilteredList(e.clientX, e.clientY, { type: 'org', orgId: org.id!, orgName: org.name, orgColor: org.color }) }}>
                  {compact ? org.name.slice(0, 2).toUpperCase() : `@${org.name}`}
                </button>
              ))}
            </>
          ) : (
            <button className={styles.chipTrigger}
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'people' ? null : 'people') }}>
              @
            </button>
          )}
          {openDropdown === 'people' && (
            <div className={styles.chipDropdown}>
              <ChipSelector
                items={[
                  ...allPeople.map(p => ({ id: p.id!, name: p.name })),
                  ...allOrgs.map(o => ({ id: -o.id!, name: o.name, color: o.color })),
                ]}
                selectedIds={(() => {
                  const ids = new Set(assignedPeopleIds)
                  for (const oid of assignedOrgIds) ids.add(-oid)
                  return ids
                })()}
                onToggle={(id) => id < 0 ? toggleOrg(-id) : togglePerson(id)}
                onCreate={handleCreatePerson}
                placeholder="Search people & orgs..."
              />
            </div>
          )}
        </div>
      )}

      {/* Tags chip group */}
      {!ghost && (
        <div className={`${styles.chipGroup} ${hasTags ? '' : styles.chipGroupEmpty}`} ref={tagsRef}>
          {hasTags ? (
            assignedTags!.map((tag) => (
              <button key={tag.id} className={styles.tagChip} style={{ color: tag.color, borderColor: tag.color }}
                onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'tags' ? null : 'tags') }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); useUIStore.getState().showFilteredList(e.clientX, e.clientY, { type: 'tag', tagId: tag.id!, tagName: tag.name, tagColor: tag.color }) }}>
                {tag.name}
              </button>
            ))
          ) : (
            <button className={styles.chipTrigger}
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'tags' ? null : 'tags') }}>
              #
            </button>
          )}
          {openDropdown === 'tags' && (
            <div className={styles.chipDropdown}>
              <ChipSelector
                items={allTags.map(t => ({ id: t.id!, name: t.name, color: t.color }))}
                selectedIds={assignedTagIds}
                onToggle={(id) => toggleTag(id)}
                onCreate={handleCreateTag}
                placeholder="Search tags..."
              />
            </div>
          )}
        </div>
      )}

      {/* Date — clickable chip or calendar icon */}
      {dueInfo ? (
        <span
          className={`${styles.dueDateChip} ${!ghost ? styles.dueDateClickable : ''} ${!todo.isHardDeadline ? styles.dueDateSoft : ''} ${dueInfo.overdue ? styles.overdue : ''} ${dueInfo.dueToday ? styles.dueDateToday : ''} ${dueInfo.urgent ? styles.dueDateUrgent : ''} ${dueInfo.approaching ? styles.dueDateApproaching : ''}`}
          onClick={(e) => { e.stopPropagation(); if (!ghost) try { dateRef.current?.showPicker() } catch { dateRef.current?.focus() } }}
        >
          {todo.recurrenceRule && <span className={styles.recurrenceIndicator} title={`Repeats ${todo.recurrenceRule.type}`}>&#x21bb;</span>}
          {dueInfo.text}
          {!ghost && (
            <button
              className={`${styles.deadlineFlag} ${todo.isHardDeadline ? styles.deadlineFlagActive : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                useTodoStore.getState().update({ ...todo, isHardDeadline: !todo.isHardDeadline || undefined, modifiedAt: new Date() })
              }}
              title={todo.isHardDeadline ? 'Hard deadline' : 'Soft date'}
            >
              {todo.isHardDeadline ? '⚑' : '⚐'}
            </button>
          )}
          {!ghost && (
            <input ref={dateRef} type="date" className={styles.hiddenDateInput}
              value={dateValue}
              onChange={(e) => { e.stopPropagation(); handleSetDueDate(e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined) }} />
          )}
        </span>
      ) : !ghost ? (
        <button className={`${styles.actionBtn} ${styles.actionBtnHover}`}
          onClick={(e) => { e.stopPropagation(); try { dateRef.current?.showPicker() } catch { dateRef.current?.focus() } }}
          title="Set due date">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
          </svg>
          <input ref={dateRef} type="date" className={styles.hiddenDateInput}
            value={dateValue}
            onChange={(e) => { e.stopPropagation(); handleSetDueDate(e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined) }} />
        </button>
      ) : null}

      <button
        className={`${styles.starButton} ${todo.isStarred ? styles.starred : styles.unstarred}`}
        onClick={(e) => { e.stopPropagation(); handleToggleStar() }}
        aria-label={todo.isStarred ? 'Unstar task' : 'Star task'}
      >
        {todo.isStarred ? '★' : '☆'}
      </button>

      <button className={styles.deleteButton} onClick={(e) => { e.stopPropagation(); handleDelete() }} aria-label="Delete task">
        ×
      </button>
    </div>
  )
})
