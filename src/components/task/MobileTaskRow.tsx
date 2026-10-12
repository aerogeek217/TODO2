import { useCallback, useMemo, useRef, useState, memo } from 'react'
import { createPortal } from 'react-dom'
import { type PersistedTodoItem, type Person, DEFAULT_STATUS_ICON } from '../../models'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { StatusIcon } from '../shared/StatusIcon'
import { TaskPillBar } from '../shared/TaskPillBar'
import { TagChipSelector } from '../shared/TagChipSelector'
import { ChipSelector } from '../shared/ChipSelector'
import { PortalDropdown } from '../shared/PortalDropdown'
import { TaskMenu } from './TaskMenu'
import type { TaskMenuHandlers } from './task-menu-entries'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { TaskNotePopover } from './TaskNotePopover'
import { FollowupPopover } from '../shared/followup/FollowupPopover'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { generateInitials } from '../../utils/person'
import { startOfToday, toDateInputValue } from '../../utils/date'
import { daysUntil, dateIntensity } from '../../utils/effective-date'
import { useTaskRowActions } from '../../hooks/use-task-row-actions'
import { TaskMarkers } from '../shared/TaskMarkers'
import styles from './MobileTaskRow.module.css'

interface MobileTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  isSelected?: boolean
  ghost?: boolean
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
  todo, assignedPeople, isSelected, ghost,
  onSelect, onOpenDetail,
}: MobileTaskRowProps) {
  const allPeople = usePersonStore((s) => s.people)
  const allTags = useTagStore((s) => s.tags)
  const assignedTagsForTodo = useTagStore((s) => s.assignedTagsMap.get(todo.id))
  const assignedTags = useMemo(() => assignedTagsForTodo ?? [], [assignedTagsForTodo])
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const today = startOfToday()
  const deadlineIntensity = dateIntensity(daysUntil(todo.dueDate, today))

  const {
    bulk, handleToggleComplete, handleSetMarker, handleDelete,
  } = useTaskRowActions({ todo })

  const [openDropdown, setOpenDropdown] = useState<'people' | null>(null)
  const [showNotesPopover, setShowNotesPopover] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  /** Follow-up popover, anchored to the pill or the empty-slot flag. */
  const [followupPopover, setFollowupPopover] = useState<{ kind: 'pill' } | null>(null)
  const followupAnchorRef = useRef<HTMLButtonElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
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
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

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

  const handleCreatePerson = async (name: string) => {
    if (ghost) return
    const id = await usePersonStore.getState().add(name, generateInitials(name))
    bulk.quickAssignPerson(todo.id, id)
  }

  const toggleTag = useCallback((tagId: number) => {
    if (ghost) return
    if (assignedTags.some((t) => t.id === tagId)) bulk.quickUnassignTag(todo.id, tagId)
    else bulk.quickAssignTag(todo.id, tagId)
  }, [ghost, assignedTags, bulk, todo.id])

  const handleCreateTag = useCallback(async (name: string) => {
    if (ghost) return
    const id = await useTagStore.getState().add(name)
    bulk.quickAssignTag(todo.id, id)
  }, [ghost, bulk, todo.id])

  const closeDropdown = useCallback(() => setOpenDropdown(null), [])
  const closeFollowup = useCallback(() => setFollowupPopover(null), [])

  const status = useStatusStore((s) => {
    if (!todo.statusId) return undefined
    return s.statuses.find(st => st.id === todo.statusId)
  })
  const quickStatusId = useSettingsStore((s) => s.quickStatusId)

  const people = assignedPeople ?? NO_PEOPLE
  const assignedPeopleIds = useMemo(() => new Set(people.map(p => p.id!)), [people])
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
      className={`${styles.emptyFollowupAction} ${followupPopover ? styles.emptyFollowupActionOpen : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        setFollowupPopover((v) => (v ? null : { kind: 'pill' }))
      }}
      aria-label="Set follow-up"
      aria-haspopup="dialog"
      aria-expanded={followupPopover !== null}
    >
      <FollowupFlagIcon />
    </button>
  )

  const menuHandlers: TaskMenuHandlers = {
    onOpen: onOpenDetail ? () => onOpenDetail(todo.id) : undefined,
    onToggleComplete: handleToggleComplete,
    onSetDueDate: ghost ? undefined : openDeadlinePicker,
    onSetFollowup: (d) => bulk.setFollowup(todo.id, d),
    onPickFollowup: ghost ? undefined : () => setFollowupPopover({ kind: 'pill' }),
    onFollowedUp: () => bulk.markFollowedUp(todo.id),
    onAssignPeople: ghost ? undefined : () => setOpenDropdown('people'),
    onAddTag: ghost ? undefined : () => setTagPickerOpen(true),
    onSetMarker: handleSetMarker,
    onDelete: handleDelete,
  }

  return (
    <div
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${isSelected ? styles.selected : ''}`}
      data-todo-id={todo.id}
      data-ghosted={ghost ? '' : undefined}
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
            onChange={handleDeadlineInputChange}
          />

          {/* Inline tag chips — populated chips render always; empty `#`
              trigger is always visible on mobile (no hover state). Rendered
              first so the metaRow reads `# @ date` (status sits on line 1). */}
          {!ghost && (
            <TagChipSelector
              assignedTags={assignedTags}
              allTags={allTags}
              onToggle={toggleTag}
              onCreate={handleCreateTag}
              open={tagPickerOpen}
              onOpenChange={setTagPickerOpen}
            />
          )}

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
            followupOpen={followupPopover !== null}
            showStatus={false}
            onPeopleClick={ghost ? undefined : () => setOpenDropdown(openDropdown === 'people' ? null : 'people')}
            onDeadlineClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
            onFollowupClick={ghost ? undefined : (e) => {
              e.stopPropagation()
              setFollowupPopover((v) => (v ? null : { kind: 'pill' }))
            }}
          />

          {!todo.nextFollowupAt && !ghost && emptyFollowupFlag}

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

      {/* Empty-state date slot — exposes a tap target so users can set a due
         date or tag a previously-unset todo without opening the detail popup.
         Order matches the populated metaRow: `# @ date`. */}
      {!hasMetadata && !ghost && (
        <div className={styles.metaRow}>
          <input
            ref={deadlineInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value=""
            onChange={handleDeadlineInputChange}
          />
          <TagChipSelector
            assignedTags={assignedTags}
            allTags={allTags}
            onToggle={toggleTag}
            onCreate={handleCreateTag}
            open={tagPickerOpen}
            onOpenChange={setTagPickerOpen}
          />
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

      {followupPopover && !ghost && (
        <FollowupPopover
          todo={todo}
          anchor={{ kind: 'ref', ref: followupAnchorRef }}
          onClose={closeFollowup}
          onSetNext={(d) => bulk.setFollowup(todo.id, d)}
          onFollowedUp={() => bulk.markFollowedUp(todo.id)}
        />
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
            items={allPeople.map(p => ({ id: p.id!, name: p.name }))}
            selectedIds={assignedPeopleIds}
            onToggle={togglePerson}
            onCreate={handleCreatePerson}
            placeholder="Search people..."
          />
        </PortalDropdown>,
        document.body,
      )}

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
