import { useCallback, useRef, useState, memo } from 'react'
import { type PersistedTodoItem, type Person, DEFAULT_STATUS_ICON } from '../../models'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { StatusIcon } from '../shared/StatusIcon'
import { TaskPillBar } from '../shared/TaskPillBar'
import { TagChipSelector } from '../shared/TagChipSelector'
import { TaskMenu } from './TaskMenu'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { startOfToday, toDateInputValue } from '../../utils/date'
import { daysUntil, dateIntensity } from '../../utils/effective-date'
import { TaskMarkers } from '../shared/TaskMarkers'
import { useTaskRowPickers } from './use-task-row-pickers'
import styles from './MobileTaskRow.module.css'

interface MobileTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  isSelected?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onOpenDetail?: (todoId: number) => void
}

// Mobile feature parity: chip taps
// open the same popovers/pickers as `TaskRow`, and a long-press on the row
// fires `onContextMenu` (browser-emulated on touch) to open the shared task
// menu (`TaskMenu`). The menu mirrors desktop, so the only
// surface that's intentionally desktop-only is the inline avatar context
// menu (right-click on a person chip to show a filtered list) — that
// gesture has no touch analogue.
const NO_PEOPLE: Person[] = []

export const MobileTaskRow = memo(function MobileTaskRow({
  todo, assignedPeople, isSelected,
  onSelect, onOpenDetail,
}: MobileTaskRowProps) {
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const today = startOfToday()
  const deadlineIntensity = dateIntensity(daysUntil(todo.dueDate, today))
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const primaryRowRef = useRef<HTMLDivElement>(null)

  const {
    handleToggleComplete, assignedTags, tagSelectorProps, togglePeople, peopleRef, followupOpen, toggleFollowup,
    followupAnchorRef, toggleNotes, notesIconRef, deadlineInputRef, openDeadlinePicker, onDeadlineInputChange,
    menuHandlers, panels,
  } = useTaskRowPickers({
    todo,
    assignedPeople,
    onOpenDetail,
    peoplePickerClassName: styles.chipDropdown,
    // With nobody assigned there are no avatars to anchor to (Assign people… from the menu).
    emptyPeopleAnchorRef: primaryRowRef,
  })

  const handleChevronTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenDetail?.(todo.id)
  }, [onOpenDetail, todo.id])

  const handleRowTap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect?.(todo.id, { shift: false, ctrl: false })
  }, [onSelect, todo.id])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const status = useStatusStore((s) => {
    if (!todo.statusId) return undefined
    return s.statuses.find(st => st.id === todo.statusId)
  })
  const quickStatusId = useSettingsStore((s) => s.quickStatusId)

  const people = assignedPeople ?? NO_PEOPLE
  const hasPeople = people.length > 0
  const hasMetadata =
    !!todo.dueDate || !!todo.nextFollowupAt ||
    hasPeople ||
    assignedTags.length > 0 ||
    !!todo.notes || !!todo.progress

  // Touch has no hover, so an empty follow-up slot always shows its flag.
  const emptyFollowupFlag = (
    <button
      ref={followupAnchorRef}
      type="button"
      className={`${styles.emptyFollowupAction} ${followupOpen ? styles.emptyFollowupActionOpen : ''}`}
      onClick={toggleFollowup}
      aria-label="Set follow-up"
      aria-haspopup="dialog"
      aria-expanded={followupOpen}
    >
      <FollowupFlagIcon />
    </button>
  )

  return (
    <div
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${isSelected ? styles.selected : ''}`}
      data-todo-id={todo.id}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      role="button"
      tabIndex={0}
      onClick={handleRowTap}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => useUIStore.getState().setHoveredTodoId(todo.id)}
      onMouseLeave={() => useUIStore.getState().setHoveredTodoId(null)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowTap(e as unknown as React.MouseEvent) } }}
    >
      {/* Line 1 */}
      <div className={styles.primaryRow} ref={primaryRowRef}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={todo.isCompleted}
          onChange={handleToggleComplete}
          onClick={(e) => e.stopPropagation()}
          aria-label="Toggle complete"
        />

        <TaskMarkers
          todo={todo}
          today={today}
          size={16}
          className={`${styles.markers} ${todo.isCompleted ? styles.markersDone : ''}`}
        />

        <span className={`${styles.title} ${todo.isCompleted ? styles.completedTitle : ''}`}>
          {todo.title}
        </span>

        <button
          className={styles.statusButton}
          style={status ? { color: status.color } : undefined}
          onClick={(e) => {
            e.stopPropagation()
            if (!todo.statusId && quickStatusId != null) {
              useTodoStore.getState().update(todo.id, { statusId: quickStatusId })
            } else if (todo.statusId) {
              useTodoStore.getState().update(todo.id, { statusId: undefined })
            }
          }}
          aria-label={status ? `Status: ${status.name}` : 'Set status'}
        >
          {status ? (
            <StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} filled />
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
            onChange={onDeadlineInputChange}
          />

          {/* Inline tag chips — populated chips render always; empty `#`
              trigger is always visible on mobile (no hover state). Rendered
              first so the metaRow reads `# @ date` (status sits on line 1). */}
          <TagChipSelector {...tagSelectorProps} />

          {/* Shared pill bar — people / due date / follow-up. Status
              lives on line 1 (primaryRow), so showStatus={false}. */}
          <TaskPillBar
            todo={todo}
            people={people}
            today={today}
            density="small"
            deadlineIntensity={deadlineIntensity}
            peopleAnchorRef={peopleRef}
            followupAnchorRef={followupAnchorRef}
            followupOpen={followupOpen}
            showStatus={false}
            onPeopleClick={togglePeople}
            onDeadlineClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
            onFollowupClick={toggleFollowup}
          />

          {!todo.nextFollowupAt && emptyFollowupFlag}

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

          {todo.notes && (
            <button
              ref={notesIconRef}
              type="button"
              className={styles.notesIcon}
              onClick={toggleNotes}
              aria-label="Edit notes"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 1.5h6.5L13 5v9a0.5 0.5 0 0 1-0.5 0.5h-9.5A0.5 0.5 0 0 1 2.5 14V2a0.5 0.5 0 0 1 0.5-0.5Z" />
                <path d="M9.5 1.5V5H13" />
                <path d="M5 8h6M5 11h4" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Empty-state date slot — exposes a tap target so users can set a due
         date or tag a previously-unset todo without opening the detail popup.
         Order matches the populated metaRow: `# @ date`. */}
      {!hasMetadata && (
        <div className={styles.metaRow}>
          <input
            ref={deadlineInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value=""
            onChange={onDeadlineInputChange}
          />
          <TagChipSelector {...tagSelectorProps} />
          <button
            type="button"
            className={styles.emptyDateAction}
            onClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
            aria-label="Set due date"
          >
            <StatusIcon icon="calendar" />
          </button>
          {emptyFollowupFlag}
        </div>
      )}

      {/* The people picker, the follow-up popover and the notes popover. */}
      {panels}

      {contextMenu && (
        <TaskMenu
          todo={todo}
          point={contextMenu}
          handlers={menuHandlers}
          onClose={() => setContextMenu(null)}
        />
      )}

    </div>
  )
})
