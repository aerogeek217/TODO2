import { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useUIStore } from '../../stores/ui-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useBulkActions } from '../../hooks/use-bulk-actions'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useInlineEdit } from '../../hooks/use-inline-edit'
import { generateInitials } from '../../utils/person'
import { startOfToday, formatDateShort, toDateInputValue } from '../../utils/date'
import { scheduledLabel, isScheduledPast, isDeadlinePast, resolveScheduled, daysUntil, dateIntensity } from '../../utils/effective-date'
import { INDENT_PX, TASK_ROW_PADDING_LEFT } from '../../constants'
import { ChipSelector } from '../shared/ChipSelector'
import { StatusIcon } from '../shared/StatusIcon'
import { ScheduledValueMenu } from '../shared/ScheduledValueMenu'
import { AvatarStack } from '../shared/AvatarStack'

import { CanvasContextMenu } from '../overlays/CanvasContextMenu'
import { ProjectPickerPopup } from '../overlays/ProjectPickerPopup'
import styles from './TaskRow.module.css'

/** Portal-rendered dropdown anchored below a trigger element */
function PortalDropdown({ anchorRef, onClickOutside, children }: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClickOutside: () => void
  children: React.ReactNode
}) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })

  useClickOutside(dropdownRef, onClickOutside, true)

  // Continuously track anchor position (handles scroll, canvas pan, etc.)
  useEffect(() => {
    let raf: number
    let prevTop = -9999
    let prevLeft = -9999
    const tick = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect) {
        const top = rect.bottom + 4
        const left = rect.left
        if (top !== prevTop || left !== prevLeft) {
          prevTop = top
          prevLeft = left
          setPos({ top, left })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [anchorRef])

  return (
    <div ref={dropdownRef} className={styles.portalDropdown} style={{ top: pos.top, left: pos.left }}>
      {children}
    </div>
  )
}

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
  /** Show compact people chips (initials only) — retained for non-row surfaces */
  compact?: boolean
  /** Task is in clipboard (cut) */
  cut?: boolean
  /** Extra label shown after tags (e.g. "Modified 3d ago") */
  extraLabel?: string
  /** Render an `in <project>` sub-line under the title (rail lens / search). */
  showContext?: boolean
}

export const TaskRow = memo(function TaskRow({
  todo, assignedPeople, assignedTags, indentLevel = 0,
  hasChildren, isExpanded, isSelected, ghost,
  onSelect, onToggleExpand, onOpenDetail, compact, cut, extraLabel, showContext,
}: TaskRowProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<'people' | 'tags' | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; onBoard: boolean } | null>(null)
  const [projectPicker, setProjectPicker] = useState<{ x: number; y: number } | null>(null)
  const [showScheduledMenu, setShowScheduledMenu] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const scheduledAnchorRef = useRef<HTMLButtonElement>(null)
  const deadlineInputRef = useRef<HTMLInputElement>(null)

  // Read entity lists from stores
  const allPeople = usePersonStore((s) => s.people)
  const allTags = useTagStore((s) => s.tags)
  const allOrgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const assignedOrgsForTodo = useOrgStore((s) => s.assignedOrgsMap.get(todo.id))
  const assignedOrgIds = useMemo(() => new Set((assignedOrgsForTodo ?? []).map(o => o.id!)), [assignedOrgsForTodo])
  const statuses = useStatusStore((s) => s.statuses)
  const status = useMemo(() => {
    if (!todo.statusId) return undefined
    return statuses.find(st => st.id === todo.statusId)
  }, [todo.statusId, statuses])

  // Cross-surface hover highlighting
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const project = useMemo(
    () => (showContext && todo.projectId ? projects.find(p => p.id === todo.projectId) : undefined),
    [showContext, todo.projectId, projects],
  )


  // Bulk-aware mutation callbacks
  const bulk = useBulkActions()

  // Inline title editing
  const handleSaveTitle = useCallback((newTitle: string) => {
    useTodoStore.getState().update({ ...todo, title: newTitle, modifiedAt: new Date() })
  }, [todo])
  const edit = useInlineEdit(todo.title, handleSaveTitle)

  const today = startOfToday()
  const scheduledPast = isScheduledPast({ scheduledDate: todo.scheduledDate }, today)
  const deadlinePast = isDeadlinePast({ dueDate: todo.dueDate }, today)
  const scheduledIntensity = dateIntensity(daysUntil(resolveScheduled(todo.scheduledDate, today), today))
  const deadlineIntensity = dateIntensity(daysUntil(todo.dueDate, today))
  const assignedOrgs = assignedOrgsForTodo ?? []
  const hasPeople = (assignedPeople && assignedPeople.length > 0) || assignedOrgs.length > 0
  const hasTags = assignedTags && assignedTags.length > 0

  // Click-outside handlers
  const closeStatus = useCallback(() => setShowStatusMenu(false), [])
  const closeDropdown = useCallback(() => setOpenDropdown(null), [])
  const closeScheduledMenu = useCallback(() => setShowScheduledMenu(false), [])

  const openDeadlinePicker = useCallback(() => {
    setTimeout(() => {
      try { deadlineInputRef.current?.showPicker?.() } catch { deadlineInputRef.current?.focus() }
    }, 0)
  }, [])
  const handleDeadlineInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    bulk.setDeadline(todo.id, raw ? new Date(raw + 'T00:00:00') : null)
  }, [bulk, todo.id])
  // Ghost rows are non-interactive (drag overlay visuals)
  const handleToggleComplete = useCallback(() => { if (!ghost) bulk.toggleComplete(todo.id) }, [ghost, bulk, todo.id])
  const handleDelete = useCallback(() => { if (!ghost) bulk.remove(todo.id) }, [ghost, bulk, todo.id])

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
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${ghost ? styles.ghost : ''} ${cut ? styles.cut : ''} ${showStatusMenu || openDropdown ? styles.rowDropdownOpen : ''}`}
      style={indentLevel > 0 ? { paddingLeft: `${TASK_ROW_PADDING_LEFT + indentLevel * INDENT_PX}px` } : undefined}
      data-todo-id={todo.id}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      onMouseEnter={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(todo.id)}
      onMouseLeave={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(null)}
      onClick={(e) => { e.stopPropagation(); onSelect?.(todo.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }) }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        edit.cancelScheduledEdit()
        if (!edit.isEditing) onOpenDetail?.(todo.id)
      }}
      onContextMenu={(e) => {
        if (ghost) return
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY, onBoard: useTaskboardStore.getState().has(todo.id) })
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

      {!hasChildren && (
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={todo.isCompleted}
          onChange={handleToggleComplete}
          onClick={(e) => e.stopPropagation()}
          aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
        />
      )}

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
        <div className={styles.titleBlock}>
          <span
            className={`${styles.title} ${hasChildren ? styles.parentTitle : ''} ${todo.isCompleted ? styles.completedTitle : ''}`}
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
          {showContext && project && (
            <span className={styles.contextLine}>in {project.name}</span>
          )}
        </div>
      )}

      {/* Notes indicator */}
      {todo.notes && (
        <span className={styles.notesIndicator} title="Has notes">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 1.5h6.5L13 5v9a0.5 0.5 0 0 1-0.5 0.5h-9.5A0.5 0.5 0 0 1 2.5 14V2a0.5 0.5 0 0 1 0.5-0.5Z" />
            <path d="M9.5 1.5V5H13" />
            <path d="M5 8h6M5 11h4" />
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

      {/* People chip group — avatar stack + org chips share one picker */}
      {!ghost && (
        <div className={`${styles.chipGroup} ${hasPeople ? '' : styles.chipGroupEmpty}`} ref={peopleRef}>
          {hasPeople ? (
            <>
              {(assignedPeople ?? []).length > 0 && (
                <AvatarStack
                  people={assignedPeople ?? []}
                  max={3}
                  onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}
                  onPersonContextMenu={(e, person) => {
                    e.preventDefault()
                    e.stopPropagation()
                    useUIStore.getState().showFilteredList(e.clientX, e.clientY, { type: 'person', personId: person.id!, personName: person.name })
                  }}
                />
              )}
              {assignedOrgs.map((org) => (
                <button key={`org-${org.id}`} className={styles.orgChip}
                  style={org.color ? { borderColor: org.color, color: org.color } : undefined}
                  title={compact ? org.name : undefined}
                  onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'people' ? null : 'people') }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); useUIStore.getState().showFilteredList(e.clientX, e.clientY, { type: 'org', orgId: org.id!, orgName: org.name, orgColor: org.color }) }}>
                  {compact ? (org.initials || org.name.slice(0, 2).toUpperCase()) : `@${org.name}`}
                </button>
              ))}
            </>
          ) : (
            <button className={styles.chipTrigger}
              onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'people' ? null : 'people') }}>
              @
            </button>
          )}
          {openDropdown === 'people' && createPortal(
            <PortalDropdown anchorRef={peopleRef} onClickOutside={closeDropdown}>
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
            </PortalDropdown>,
            document.body,
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
          {openDropdown === 'tags' && createPortal(
            <PortalDropdown anchorRef={tagsRef} onClickOutside={closeDropdown}>
              <div className={styles.chipDropdown}>
                <ChipSelector
                  items={allTags.map(t => ({ id: t.id!, name: t.name, color: t.color }))}
                  selectedIds={assignedTagIds}
                  onToggle={(id) => toggleTag(id)}
                  onCreate={handleCreateTag}
                  placeholder="Search tags..."
                />
              </div>
            </PortalDropdown>,
            document.body,
          )}
        </div>
      )}

      {/* Date chips stack — scheduled on top, deadline beneath when both present */}
      {!ghost && (todo.scheduledDate || todo.dueDate) && (
        <div className={styles.dateStack}>
          {todo.scheduledDate && (
            <button
              ref={scheduledAnchorRef}
              type="button"
              className={`${styles.scheduledChip} ${scheduledPast ? styles.scheduledChipPast : ''}`}
              style={{ '--date-intensity': scheduledIntensity } as React.CSSProperties}
              onClick={(e) => { e.stopPropagation(); setShowScheduledMenu(v => !v) }}
              title={scheduledPast ? 'Scheduled date has passed' : 'Scheduled'}
            >
              <StatusIcon icon="calendar" />
              <span className={styles.chipLabel}>{scheduledLabel(todo.scheduledDate, today)}</span>
            </button>
          )}

          {todo.dueDate && (
            <button
              type="button"
              className={`${styles.deadlineChip} ${deadlinePast ? styles.deadlineChipPast : ''}`}
              style={{ '--date-intensity': deadlineIntensity } as React.CSSProperties}
              onClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
              title={deadlinePast ? 'Deadline passed — click to change' : 'Deadline — click to change'}
            >
              <StatusIcon icon="clock" />
              <span className={styles.chipLabel}>{formatDateShort(todo.dueDate)}</span>
              {todo.recurrenceRule && <span className={styles.recurrenceIndicator} title={`Repeats ${todo.recurrenceRule.type}`}>&#x21bb;</span>}
              <span
                className={styles.chipClear}
                role="button"
                tabIndex={-1}
                aria-label="Clear deadline"
                title="Clear deadline"
                onClick={(e) => { e.stopPropagation(); bulk.setDeadline(todo.id, null) }}
                onMouseDown={(e) => e.stopPropagation()}
              >&times;</span>
            </button>
          )}
        </div>
      )}

      {/* Empty state: inline scheduled picker (with "Add deadline" action) */}
      {!todo.scheduledDate && !todo.dueDate && !ghost && (
        <button
          ref={scheduledAnchorRef}
          type="button"
          className={`${styles.actionBtn} ${styles.actionBtnHover}`}
          onClick={(e) => { e.stopPropagation(); setShowScheduledMenu(v => !v) }}
          title="Schedule or set deadline"
        >
          <StatusIcon icon="calendar" />
        </button>
      )}

      {/* Inline scheduled-value menu, portalized + anchored to chip/empty button */}
      {showScheduledMenu && !ghost && createPortal(
        <PortalDropdown anchorRef={scheduledAnchorRef} onClickOutside={closeScheduledMenu}>
          <ScheduledValueMenu
            value={todo.scheduledDate ?? null}
            onChange={(v) => bulk.setScheduled(todo.id, v)}
            onClose={closeScheduledMenu}
            onAddDeadline={todo.dueDate ? undefined : openDeadlinePicker}
          />
        </PortalDropdown>,
        document.body,
      )}

      {/* Hidden native date input for inline deadline editing */}
      {!ghost && (
        <input
          ref={deadlineInputRef}
          type="date"
          className={styles.hiddenDateInput}
          value={todo.dueDate ? toDateInputValue(todo.dueDate) : ''}
          onChange={handleDeadlineInputChange}
        />
      )}

      {extraLabel && <span className={styles.extraLabel}>{extraLabel}</span>}

      {!ghost && (
        <div ref={statusRef} className={styles.statusWrapper}>
          <button
            className={styles.statusButton}
            style={status ? { color: status.color } : undefined}
            onClick={(e) => {
              e.stopPropagation()
              setShowStatusMenu(v => !v)
            }}
            aria-label={status ? `Status: ${status.name}` : 'Set status'}
          >
            {status ? (
              <StatusIcon icon={status.icon || 'circle'} filled />
            ) : (
              <span className={styles.statusDotEmpty} />
            )}
          </button>
          {showStatusMenu && createPortal(
            <PortalDropdown anchorRef={statusRef} onClickOutside={closeStatus}>
              <div className={styles.statusMenu}>
                <button
                  className={`${styles.statusOption} ${!todo.statusId ? styles.statusOptionActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); bulk.setStatus(todo.id, undefined); setShowStatusMenu(false) }}
                >
                  <span className={styles.statusOptionDot} style={{ background: 'var(--color-text-muted)' }} />
                  No Status
                </button>
                {statuses.map(s => (
                  <button
                    key={s.id}
                    className={`${styles.statusOption} ${todo.statusId === s.id ? styles.statusOptionActive : ''}`}
                    onClick={(e) => { e.stopPropagation(); bulk.setStatus(todo.id, s.id); setShowStatusMenu(false) }}
                  >
                    <span style={{ color: s.color }}><StatusIcon icon={s.icon || 'circle'} filled /></span>
                    {s.name}
                  </button>
                ))}
              </div>
            </PortalDropdown>,
            document.body,
          )}
        </div>
      )}

      <button className={styles.deleteButton} onClick={(e) => { e.stopPropagation(); handleDelete() }} aria-label="Delete task">
        ×
      </button>

      {contextMenu && createPortal(
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            contextMenu.onBoard
              ? { label: 'Remove from Taskboard', action: () => useTaskboardStore.getState().remove(todo.id) }
              : { label: 'Add to Taskboard', action: () => useTaskboardStore.getState().add(todo.id) },
            {
              label: 'Move to project…',
              action: () => setProjectPicker({ x: contextMenu.x, y: contextMenu.y }),
            },
          ]}
          onClose={() => setContextMenu(null)}
        />,
        document.body,
      )}

      {projectPicker && createPortal(
        <ProjectPickerPopup
          x={projectPicker.x}
          y={projectPicker.y}
          projectId={todo.projectId}
          projects={projects}
          onSelect={(id) => bulk.setProject(todo.id, id)}
          onClose={() => setProjectPicker(null)}
        />,
        document.body,
      )}
    </div>
  )
})
