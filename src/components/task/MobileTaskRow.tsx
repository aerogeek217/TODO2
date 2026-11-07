import { useCallback, useRef, useState, memo, type CSSProperties, type RefObject } from 'react'
import { type PersistedTodoItem, type Person, DEFAULT_STATUS_ICON } from '../../models'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { StatusIcon } from '../shared/StatusIcon'
import { TaskPillBar } from '../shared/TaskPillBar'
import { TagChipSelector } from '../shared/TagChipSelector'
import { TaskMenu } from './TaskMenu'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { NotesIcon } from '../shared/icons'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { newestStatusUpdate, useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { describeSubtaskCount, formatSubtaskCount, subtaskCount } from '../../utils/subtasks'
import subtaskStyles from './subtasks/Subtasks.module.css'
import { formatDateNumeric, startOfToday, toDateInputValue } from '../../utils/date'
import { daysUntil, dateIntensity } from '../../utils/effective-date'
import { PriorityRing } from '../shared/PriorityRing'
import { rowCue } from '../../utils/priority-cues'
import { markerSummary, priorityRing } from '../../utils/markers'
import { isStale } from '../../utils/stale'
import { useTaskRowPickers } from './use-task-row-pickers'
import { keepRowTextUnselected } from './row-events'
import styles from './MobileTaskRow.module.css'
import { TODO_ID_ATTR } from '../../utils/dom-contract'

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
/** The checkbox's drawn box, px (its touch target is larger: `.checkbox`). */
const CHECKBOX_BOX = 20

export const MobileTaskRow = memo(function MobileTaskRow({
  todo, assignedPeople, isSelected,
  onSelect, onOpenDetail,
}: MobileTaskRowProps) {
  const people = assignedPeople ?? NO_PEOPLE
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const today = startOfToday()
  const deadlineIntensity = dateIntensity(daysUntil(todo.dueDate, today))
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const primaryRowRef = useRef<HTMLDivElement>(null)
  // The status chip: the task's newest status update.
  const newestUpdate = useStatusUpdateStore((s) => newestStatusUpdate(todo.id, s.byTodo))
  // The `2/5 subtasks` chip (cr28): opens the checklist as a sheet.
  const subtasks = useSubtaskStore((s) => s.byTodo.get(todo.id))
  const count = subtasks && subtasks.length > 0 ? subtaskCount(subtasks) : null

  const {
    handleToggleComplete, assignedTags, tagSelectorProps, togglePeople, peopleRef, followupOpen, toggleFollowup,
    followupAnchorRef, toggleNotes, notesIconRef, deadlineInputRef, openDeadlinePicker, onDeadlineInputChange,
    subtasksOpen, toggleSubtasks, subtasksRef,
    menuHandlers, panels,
  } = useTaskRowPickers({
    todo,
    assignedPeople,
    onOpenDetail,
    peoplePickerClassName: styles.chipDropdown,
    subtasksPanel: 'sheet',
    // With nobody assigned there are no avatars to anchor to (Assign people… from the menu).
    fallbackPeopleAnchorRef: primaryRowRef,
    useFallbackPeopleAnchor: people.length === 0,
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
  // The status button gives a task without one the default status (Settings › Tasks), when it still exists.
  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const hasDefaultStatus = useStatusStore((s) => defaultStatusId != null && s.statuses.some((st) => st.id === defaultStatusId))
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const markers = markerSummary(todo, today, urgentRange)
  const priorityCues = useSettingsStore((s) => s.priorityCues)
  const cue = rowCue(todo, priorityCues, today, urgentRange)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const stale = isStale(todo, today, staleAfterDays)

  const hasPeople = people.length > 0
  const hasMetadata =
    !!todo.dueDate || !!todo.nextFollowupAt ||
    hasPeople ||
    assignedTags.length > 0 ||
    !!todo.notes || !!newestUpdate || count !== null

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
      style={cue.glow ? ({ '--row-glow': cue.glow } as CSSProperties) : undefined}
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${isSelected ? styles.selected : ''}`}
      {...{ [TODO_ID_ATTR]: todo.id }}
      data-stale={stale || undefined}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      // A tap anywhere selects; the keyboard's way is the title button (the row holds controls of its own).
      onClick={handleRowTap}
      onMouseDown={keepRowTextUnselected}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => useUIStore.getState().setHoveredTodoId(todo.id)}
      onMouseLeave={() => useUIStore.getState().setHoveredTodoId(null)}
    >
      {/* Line 1 */}
      <div className={styles.primaryRow} ref={primaryRowRef}>
        {/* The priority is the ring on the box (D25 B), named; the task menu (long-press) sets it. */}
        <span className={styles.checkWrap}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={todo.isCompleted}
            onChange={handleToggleComplete}
            onClick={(e) => e.stopPropagation()}
            aria-label="Toggle complete"
          />
          <PriorityRing summary={markers} completed={todo.isCompleted} size={CHECKBOX_BOX} label={markers.label} />
          {/* Focus under another ring: the desktop gutter's dot, here on the box's corner (the row has no gutter). */}
          {priorityRing(markers, todo.isCompleted).focusDot && <span className={styles.focusDot} data-gutter-dot="focus" aria-hidden="true" />}
        </span>

        <button
          type="button"
          className={`${styles.title} ${cue.semibold ? styles.titleSemibold : ''} ${todo.isCompleted ? styles.completedTitle : ''}`}
          aria-pressed={!!isSelected}
          data-task-title={todo.title}
          onClick={handleRowTap}
        >
          {todo.title}
        </button>

        <button
          className={styles.statusButton}
          style={status ? { color: status.color } : undefined}
          onClick={(e) => {
            e.stopPropagation()
            if (!todo.statusId && defaultStatusId != null && hasDefaultStatus) {
              useTodoStore.getState().update(todo.id, { statusId: defaultStatusId })
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
            dateFormat="numeric"
            followupFlagOnly
            deadlineIntensity={deadlineIntensity}
            peopleAnchorRef={peopleRef as RefObject<HTMLDivElement | null>}
            followupAnchorRef={followupAnchorRef}
            followupOpen={followupOpen}
            showStatus={false}
            onPeopleClick={togglePeople}
            onDeadlineClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
            onFollowupClick={toggleFollowup}
          />

          {!todo.nextFollowupAt && emptyFollowupFlag}

          {newestUpdate && (
            <span className={styles.statusUpdateChip} data-status-chip="">
              {formatDateNumeric(newestUpdate.date)} {newestUpdate.text}
              {(() => {
                // A percentage in the update's text (`60% done`) draws its bar.
                const m = newestUpdate.text.match(/(\d+)\s*%/)
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

          {count && (
            <button
              ref={subtasksRef}
              type="button"
              className={subtaskStyles.chip}
              data-subtask-count=""
              data-all-done={count.done === count.total ? '' : undefined}
              aria-label={`${describeSubtaskCount(count)}, show them`}
              aria-haspopup="dialog"
              aria-expanded={subtasksOpen}
              onClick={toggleSubtasks}
            >
              {formatSubtaskCount(count)} subtasks
            </button>
          )}

          {(todo.notes || newestUpdate) && (
            <button
              ref={notesIconRef}
              type="button"
              className={styles.notesIcon}
              onClick={toggleNotes}
              aria-label="Edit status and notes"
            >
              <NotesIcon size={12} />
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
