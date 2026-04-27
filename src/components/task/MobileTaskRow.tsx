import { useCallback, useMemo, useRef, useState, memo } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem, Person } from '../../models'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useProjectStore } from '../../stores/project-store'
import { StatusIcon } from '../shared/StatusIcon'
import { TaskPillBar } from '../shared/TaskPillBar'
import { ChipSelector } from '../shared/ChipSelector'
import { ScheduledValueMenu } from '../shared/ScheduledValueMenu'
import { PortalDropdown } from '../shared/PortalDropdown'
import { CanvasContextMenu } from '../overlays/CanvasContextMenu'
import { ProjectPickerPopup } from '../overlays/ProjectPickerPopup'
import { TaskNotePopover } from './TaskNotePopover'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { generateInitials } from '../../utils/person'
import { startOfToday, toDateInputValue } from '../../utils/date'
import { resolveScheduled, daysUntil, dateIntensity } from '../../utils/effective-date'
import { useTaskRowActions, buildTaskRowMenuItems } from '../../hooks/use-task-row-actions'
import styles from './MobileTaskRow.module.css'

interface MobileTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  isSelected?: boolean
  ghost?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onOpenDetail?: (todoId: number) => void
  cut?: boolean
}

// Display rule: `todo.tags` is intentionally not rendered here. Tags power
// search / filter / grouping only — they never become a row chip.
//
// Mobile feature parity (Phase 6 of code-review-2026-04-25): chip taps now
// open the same popovers/pickers as `TaskRow`, and a long-press on the row
// fires `onContextMenu` (browser-emulated on touch) to open the shared task-
// row action menu via `buildTaskRowMenuItems`. The action menu mirrors
// desktop including taskboard add/remove + move-to-project, so the only
// surface that's intentionally desktop-only is the inline avatar context
// menu (right-click on a person/org chip to show a filtered list) — that
// gesture has no touch analogue.
export const MobileTaskRow = memo(function MobileTaskRow({
  todo, assignedPeople, isSelected, ghost,
  onSelect, onOpenDetail, cut,
}: MobileTaskRowProps) {
  const allPeople = usePersonStore((s) => s.people)
  const allOrgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const assignedOrgsForTodo = useOrgStore((s) => s.assignedOrgsMap.get(todo.id))
  const assignedOrgIds = useMemo(() => new Set((assignedOrgsForTodo ?? []).map(o => o.id!)), [assignedOrgsForTodo])
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const today = startOfToday()
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const scheduledIntensity = dateIntensity(daysUntil(resolveScheduled(todo.scheduledDate, today, weekStartsOn), today))
  const deadlineIntensity = dateIntensity(daysUntil(todo.dueDate, today))
  const assignedOrgs = assignedOrgsForTodo ?? []

  const { bulk, handleToggleComplete, handleDelete } = useTaskRowActions({ todo, ghost })

  const [openDropdown, setOpenDropdown] = useState<'people' | null>(null)
  const [showScheduledMenu, setShowScheduledMenu] = useState(false)
  const [showNotesPopover, setShowNotesPopover] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; onBoard: boolean } | null>(null)
  const [projectPicker, setProjectPicker] = useState<{ x: number; y: number } | null>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const scheduledAnchorRef = useRef<HTMLButtonElement>(null)
  const deadlineInputRef = useRef<HTMLInputElement>(null)
  const notesIconRef = useRef<HTMLButtonElement>(null)

  const handleChevronTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenDetail?.(todo.id)
  }, [onOpenDetail, todo.id])

  const handleRowTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.(todo.id, { shift: false, ctrl: false })
  }, [onSelect, todo.id])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (ghost) return
    e.preventDefault()
    e.stopPropagation()
    const onBoard = useTaskboardStore.getState().has(todo.id)
    setContextMenu({ x: e.clientX, y: e.clientY, onBoard })
  }, [ghost, todo.id])

  const openDeadlinePicker = useCallback(() => {
    setTimeout(() => {
      try { deadlineInputRef.current?.showPicker?.() } catch { deadlineInputRef.current?.focus() }
    }, 0)
  }, [])
  const handleDeadlineInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    bulk.setDeadline(todo.id, raw ? new Date(raw + 'T00:00:00') : null)
  }, [bulk, todo.id])

  const togglePerson = (id: number) => {
    if (ghost) return
    const isAssigned = assignedPeople?.some((p) => p.id === id)
    if (isAssigned) bulk.quickUnassignPerson(todo.id, id)
    else bulk.quickAssignPerson(todo.id, id)
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

  const closeDropdown = useCallback(() => setOpenDropdown(null), [])
  const closeScheduledMenu = useCallback(() => setShowScheduledMenu(false), [])

  const status = useStatusStore((s) => {
    if (!todo.statusId) return undefined
    return s.statuses.find(st => st.id === todo.statusId)
  })
  const quickStatusId = useSettingsStore((s) => s.quickStatusId)

  const people = assignedPeople ?? []
  const assignedPeopleIds = useMemo(() => new Set(people.map(p => p.id!)), [people])
  const hasPeople = people.length > 0 || assignedOrgs.length > 0
  const hasMetadata =
    !!todo.scheduledDate || !!todo.dueDate ||
    hasPeople ||
    !!todo.notes || !!todo.progress

  return (
    <div
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${cut ? styles.cut : ''} ${isSelected ? styles.selected : ''}`}
      data-todo-id={todo.id}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      role="button"
      tabIndex={0}
      onClick={handleRowTap}
      onContextMenu={handleContextMenu}
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

        <span className={`${styles.title} ${todo.isCompleted ? styles.completedTitle : ''}`}>
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
          <input
            ref={deadlineInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value={todo.dueDate ? toDateInputValue(todo.dueDate) : ''}
            onChange={handleDeadlineInputChange}
          />

          {/* Shared pill bar — scheduled / deadline / people / orgs. Status
              lives on line 1 (primaryRow), so showStatus={false}. */}
          <TaskPillBar
            todo={todo}
            people={people}
            orgs={assignedOrgs}
            today={today}
            weekStartsOn={weekStartsOn}
            density="small"
            scheduledIntensity={scheduledIntensity}
            deadlineIntensity={deadlineIntensity}
            peopleAnchorRef={peopleRef}
            scheduledAnchorRef={scheduledAnchorRef}
            showStatus={false}
            onPeopleClick={ghost ? undefined : () => setOpenDropdown(openDropdown === 'people' ? null : 'people')}
            onScheduledClick={(e) => { e.stopPropagation(); setShowScheduledMenu(v => !v) }}
            onDeadlineClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
          />

          {todo.progress && (
            <span className={styles.progressChip}>
              {todo.progress}
              {(() => {
                const m = todo.progress.match(/(\d+)\s*%/)
                if (!m || m[1] == null) return null
                const pct = Math.min(100, Math.max(0, parseInt(m[1])))
                return (
                  <span className={styles.progressBarTrack}>
                    <span className={styles.progressBarFill} style={{ width: `${pct}%` }} />
                  </span>
                )
              })()}
            </span>
          )}

          {todo.notes && !ghost && (
            <button
              ref={notesIconRef}
              type="button"
              className={styles.notesIcon}
              onClick={(e) => { e.stopPropagation(); setShowNotesPopover(v => !v) }}
              aria-label="Edit notes"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 1.5h6.5L13 5v9a0.5 0.5 0 0 1-0.5 0.5h-9.5A0.5 0.5 0 0 1 2.5 14V2a0.5 0.5 0 0 1 0.5-0.5Z" />
                <path d="M9.5 1.5V5H13" />
                <path d="M5 8h6M5 11h4" />
              </svg>
            </button>
          )}
          {todo.notes && ghost && (
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

      {/* Empty-state date slot — exposes a tap target so users can schedule
         a previously-unset todo without opening the detail popup. */}
      {!hasMetadata && !ghost && (
        <div className={styles.metaRow}>
          <input
            ref={deadlineInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value=""
            onChange={handleDeadlineInputChange}
          />
          <button
            ref={scheduledAnchorRef}
            type="button"
            className={styles.emptyDateAction}
            onClick={(e) => { e.stopPropagation(); setShowScheduledMenu(v => !v) }}
            aria-label="Schedule or set deadline"
          >
            <StatusIcon icon="calendar" />
          </button>
        </div>
      )}

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

      {showNotesPopover && !ghost && createPortal(
        <TaskNotePopover
          todoId={todo.id}
          anchorRef={notesIconRef}
          onClose={() => setShowNotesPopover(false)}
        />,
        document.body,
      )}

      {openDropdown === 'people' && !ghost && createPortal(
        <PortalDropdown anchorRef={peopleRef} onClickOutside={closeDropdown}>
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
        </PortalDropdown>,
        document.body,
      )}

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildTaskRowMenuItems({
            todo,
            onBoard: contextMenu.onBoard,
            onOpenDetail,
            onMoveToProject: () => setProjectPicker({ x: contextMenu.x, y: contextMenu.y }),
            onComplete: handleToggleComplete,
            onDelete: handleDelete,
          })}
          onClose={() => setContextMenu(null)}
        />
      )}

      {projectPicker && (
        <ProjectPickerPopup
          x={projectPicker.x}
          y={projectPicker.y}
          projectId={todo.projectId}
          projects={projects}
          onSelect={(id) => bulk.setProject(todo.id, id)}
          onClose={() => setProjectPicker(null)}
        />
      )}
    </div>
  )
})
