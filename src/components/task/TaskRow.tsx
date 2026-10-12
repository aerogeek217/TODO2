import { useRef, useState, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { type PersistedTodoItem, type Person, DEFAULT_STATUS_ICON } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { useStatusStore } from '../../stores/status-store'
import { useTaskRowActions } from '../../hooks/use-task-row-actions'
import { useInlineEdit } from '../../hooks/use-inline-edit'
import { personPickerItems, PERSON_PICKER_PLACEHOLDER } from '../../utils/person'
import { startOfToday, toDateInputValue } from '../../utils/date'
import { daysUntil, dateIntensity } from '../../utils/effective-date'
import { ChipSelector } from '../shared/ChipSelector'
import { StatusIcon } from '../shared/StatusIcon'
import { TaskPillPeople, TaskPillDates, TaskPillFollowup, TaskPillStatus } from '../shared/TaskPillBar'
import { FollowupPopover } from '../shared/followup/FollowupPopover'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { TagChipSelector } from '../shared/TagChipSelector'
import { DragHandle } from '../shared/DragHandle'
import { PortalDropdown } from '../shared/PortalDropdown'
import { TaskMenu } from './TaskMenu'
import type { TaskMenuHandlers } from './task-menu-entries'
import { MoreIcon } from '../workspace/icons'
import { TaskNotePopover } from './TaskNotePopover'
import { TaskMarkers } from '../shared/TaskMarkers'
import { personTaskDialog } from '../../services/task-dialog'
import styles from './TaskRow.module.css'

interface TaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  isSelected?: boolean
  ghost?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onOpenDetail?: (todoId: number) => void
}

export const TaskRow = memo(function TaskRow({
  todo, assignedPeople, isSelected, ghost,
  onSelect, onOpenDetail,
}: TaskRowProps) {
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<'people' | null>(null)
  /** The task menu: from the ⋯ button, or at the pointer (right-click). */
  const [menu, setMenu] = useState<{ kind: 'button' } | { kind: 'point'; x: number; y: number } | null>(null)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [showNotesPopover, setShowNotesPopover] = useState(false)
  /** Follow-up popover, anchored to the pill or the empty-slot flag. */
  const [followupPopover, setFollowupPopover] = useState<{ kind: 'slot' } | null>(null)
  const followupAnchorRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const deadlineInputRef = useRef<HTMLInputElement>(null)
  const notesIconRef = useRef<HTMLButtonElement>(null)

  // Read entity lists from stores
  const allPeople = usePersonStore((s) => s.people)
  const allTags = useTagStore((s) => s.tags)
  const assignedTagsForTodo = useTagStore((s) => s.assignedTagsMap.get(todo.id))
  const assignedTags = useMemo(() => assignedTagsForTodo ?? [], [assignedTagsForTodo])
  const statuses = useStatusStore((s) => s.statuses)
  const status = useMemo(() => {
    if (!todo.statusId) return undefined
    return statuses.find(st => st.id === todo.statusId)
  }, [todo.statusId, statuses])

  // Cross-surface hover highlighting
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)


  // Bulk-aware mutation callbacks (toggle/delete share semantics with MobileTaskRow + search via this hook)
  const {
    bulk, handleToggleComplete, handleSetMarker, handleDelete,
  } = useTaskRowActions({ todo })

  // Inline title editing
  const handleSaveTitle = useCallback((newTitle: string) => {
    useTodoStore.getState().update({ ...todo, title: newTitle, modifiedAt: new Date() })
  }, [todo])
  const {
    isEditing, editTitle, setEditTitle, inputRef: titleInputRef,
    save: saveTitle, handleKeyDown: handleTitleKeyDown, scheduleEdit, cancelScheduledEdit,
  } = useInlineEdit(todo.title, handleSaveTitle)

  const today = startOfToday()
  const deadlineIntensity = dateIntensity(daysUntil(todo.dueDate, today))
  const hasPeople = !!assignedPeople && assignedPeople.length > 0

  // Click-outside handlers
  const closeStatus = useCallback(() => setShowStatusMenu(false), [])
  const closeDropdown = useCallback(() => setOpenDropdown(null), [])
  const closeFollowup = useCallback(() => setFollowupPopover(null), [])
  const toggleFollowupFromSlot = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setFollowupPopover((v) => (v ? null : { kind: 'slot' }))
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
    const id = await usePersonStore.getState().getOrCreate(name)
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

  // Ghost rows render no pickers, so their menu leaves the picker items out.
  const menuHandlers: TaskMenuHandlers = {
    onOpen: onOpenDetail ? () => onOpenDetail(todo.id) : undefined,
    onToggleComplete: handleToggleComplete,
    onSetDueDate: ghost ? undefined : openDeadlinePicker,
    onSetFollowup: (d) => bulk.setFollowup(todo.id, d),
    onPickFollowup: ghost ? undefined : () => setFollowupPopover({ kind: 'slot' }),
    onFollowedUp: () => bulk.markFollowedUp(todo.id),
    onAssignPeople: ghost ? undefined : () => setOpenDropdown('people'),
    onAddTag: ghost ? undefined : () => setTagPickerOpen(true),
    onSetMarker: handleSetMarker,
    onDelete: handleDelete,
  }

  const assignedPeopleIds = useMemo(() => new Set((assignedPeople ?? []).map(p => p.id!)), [assignedPeople])

  return (
    <div
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${showStatusMenu || openDropdown || tagPickerOpen ? styles.rowDropdownOpen : ''}`}
      data-todo-id={todo.id}
      data-ghosted={ghost ? '' : undefined}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      onMouseEnter={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(todo.id)}
      onMouseLeave={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(null)}
      onClick={(e) => { e.stopPropagation(); onSelect?.(todo.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }) }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        cancelScheduledEdit()
        if (!isEditing) onOpenDetail?.(todo.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ kind: 'point', x: e.clientX, y: e.clientY })
      }}
    >

      <DragHandle className={styles.dragHandle} />

      <input
        type="checkbox"
        className={styles.checkbox}
        checked={todo.isCompleted}
        onChange={handleToggleComplete}
        onClick={(e) => e.stopPropagation()}
        aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
      />

      <TaskMarkers
        todo={todo}
        today={today}
        className={`${styles.markers} ${todo.isCompleted ? styles.markersDone : ''}`}
      />

      {isEditing ? (
        <input
          ref={titleInputRef}
          className={styles.titleInput}
          value={editTitle}
          maxLength={500}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={handleTitleKeyDown}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className={styles.titleBlock}>
          <span
            className={`${styles.title} ${todo.isCompleted ? styles.completedTitle : ''}`}
            title={todo.title}
            onClick={(e) => {
              e.stopPropagation()
              if (e.shiftKey || e.ctrlKey || e.metaKey) {
                onSelect?.(todo.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey })
              } else if (isSelected) {
                scheduleEdit()
              } else {
                onSelect?.(todo.id, { shift: false, ctrl: false })
              }
            }}
          >
            {todo.title}
          </span>
        </div>
      )}

      {/* Notes indicator — click opens inline notes popover. Sits at the
          leftmost chip slot (just after the title) so it flows freely with
          tags on the left while leaving people / date / status aligned in
          their fixed-width slots on the right. */}
      {todo.notes && !ghost && (
        <button
          ref={notesIconRef}
          type="button"
          className={styles.notesIndicator}
          title="Edit notes"
          aria-label="Edit notes"
          onClick={(e) => { e.stopPropagation(); setShowNotesPopover(v => !v) }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 1.5h6.5L13 5v9a0.5 0.5 0 0 1-0.5 0.5h-9.5A0.5 0.5 0 0 1 2.5 14V2a0.5 0.5 0 0 1 0.5-0.5Z" />
            <path d="M9.5 1.5V5H13" />
            <path d="M5 8h6M5 11h4" />
          </svg>
        </button>
      )}
      {todo.notes && ghost && (
        <span className={styles.notesIndicator} title="Has notes">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 1.5h6.5L13 5v9a0.5 0.5 0 0 1-0.5 0.5h-9.5A0.5 0.5 0 0 1 2.5 14V2a0.5 0.5 0 0 1 0.5-0.5Z" />
            <path d="M9.5 1.5V5H13" />
            <path d="M5 8h6M5 11h4" />
          </svg>
        </span>
      )}
      {showNotesPopover && !ghost && createPortal(
        <TaskNotePopover
          todoId={todo.id}
          anchorRef={notesIconRef}
          onClose={() => setShowNotesPopover(false)}
        />,
        document.body,
      )}

      {/* Progress label with visual bar */}
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

      {/* Slots are interleaved per-chip (populated vs empty-state) instead of
          composing the full `<TaskPillBar>`, so each chip stays in a fixed
          JSX position regardless of which sibling is populated. Order is
          `# tags → @ people → date → status` for both populated and empty
          variants. */}

      {/* Slot 1 — tags. Populated chips render; empty `#` trigger is
          hover-revealed via the `[class*="tagChipEmpty"]` rule. */}
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

      {/* Slot 2 — people. Populated avatars or hover-revealed `@`
          trigger; either way `peopleRef` anchors the popover. */}
      {!ghost && (hasPeople ? (
        <TaskPillPeople
          people={assignedPeople ?? []}
          anchorRef={peopleRef}
          onPeopleClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}
          onPersonContextMenu={(e, person) => {
            e.preventDefault()
            e.stopPropagation()
            useUIStore.getState().showTaskDialog(personTaskDialog(person))
          }}
        />
      ) : (
        <div className={`${styles.chipGroup} ${styles.chipGroupEmpty}`} ref={peopleRef}>
          <button
            className={styles.chipTrigger}
            onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === 'people' ? null : 'people') }}
          >
            @
          </button>
        </div>
      ))}

      {/* Slot 3 — dates. Populated stack or empty calendar button.
          `dateStackEmpty` reserves the same width so status doesn't shift
          horizontally between rows. The hidden native `<input type="date">`
          lives inside this slot in both cases (single `deadlineInputRef`). */}
      {!ghost && (todo.dueDate ? (
        <>
          <TaskPillDates
            todo={todo}
            today={today}
            layout="stack"
            deadlineIntensity={deadlineIntensity}
            onDeadlineClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
            onDeadlineClear={() => bulk.setDeadline(todo.id, null)}
          />
          <input
            ref={deadlineInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value={todo.dueDate ? toDateInputValue(todo.dueDate) : ''}
            onChange={handleDeadlineInputChange}
          />
        </>
      ) : (
        <div className={styles.dateStackEmpty}>
          <input
            ref={deadlineInputRef}
            type="date"
            className={styles.hiddenDateInput}
            value=""
            onChange={handleDeadlineInputChange}
          />
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnHover}`}
            onClick={(e) => { e.stopPropagation(); openDeadlinePicker() }}
            title="Set due date"
            aria-label="Set due date"
          >
            <StatusIcon icon="calendar" />
          </button>
        </div>
      ))}

      {/* Slot 4 — follow-up. Populated pill (× clears only the follow-up) or
          a hover-revealed flag that takes no space at rest. Both open the
          follow-up popover. */}
      {!ghost && (todo.nextFollowupAt ? (
        <TaskPillFollowup
          todo={todo}
          today={today}
          anchorRef={followupAnchorRef}
          open={followupPopover !== null}
          onFollowupClick={toggleFollowupFromSlot}
          onFollowupClear={() => bulk.setFollowup(todo.id, null)}
        />
      ) : (
        <button
          ref={followupAnchorRef}
          type="button"
          className={`${styles.followupTrigger} ${followupPopover ? styles.followupTriggerOpen : ''}`}
          onClick={toggleFollowupFromSlot}
          aria-label="Set follow-up"
          title="Set follow-up"
          aria-haspopup="dialog"
          aria-expanded={followupPopover !== null}
        >
          <FollowupFlagIcon />
        </button>
      ))}

      {/* Slot 5 — status. Always rendered; empty dot is hover-revealed via
          the `[class*="statusDotEmpty"]` rule. */}
      {!ghost && (
        <TaskPillStatus
          status={status}
          anchorRef={statusRef}
          onStatusClick={(e) => { e.stopPropagation(); setShowStatusMenu(v => !v) }}
        />
      )}

      {/* Task menu trigger — hover / keyboard-focus revealed, pressed while open. */}
      {!ghost && (
        <button
          ref={moreRef}
          type="button"
          className={`${styles.moreBtn} ${menu ? styles.moreBtnOpen : ''}`}
          aria-label="Task actions"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          onClick={(e) => {
            e.stopPropagation()
            setMenu((m) => (m ? null : { kind: 'button' }))
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreIcon />
        </button>
      )}

      {/* Portaled people chip selector — anchored to peopleRef. */}
      {!ghost && openDropdown === 'people' && createPortal(
        <PortalDropdown anchorRef={peopleRef} onClickOutside={closeDropdown}>
          <div className={styles.chipDropdown}>
            <ChipSelector
              items={personPickerItems(allPeople)}
              selectedIds={assignedPeopleIds}
              onToggle={togglePerson}
              onCreate={handleCreatePerson}
              onClose={closeDropdown}
              avatars
              placeholder={PERSON_PICKER_PLACEHOLDER}
            />
          </div>
        </PortalDropdown>,
        document.body,
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

      {/* Portaled status menu — anchored to statusRef (TaskPillBar's status wrapper). */}
      {!ghost && showStatusMenu && createPortal(
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
                <span style={{ color: s.color }}><StatusIcon icon={s.icon || DEFAULT_STATUS_ICON} filled /></span>
                {s.name}
              </button>
            ))}
          </div>
        </PortalDropdown>,
        document.body,
      )}

      {menu && (
        <TaskMenu
          todo={todo}
          anchorRef={menu.kind === 'button' ? moreRef : undefined}
          point={menu.kind === 'point' ? { x: menu.x, y: menu.y } : undefined}
          handlers={menuHandlers}
          onClose={() => setMenu(null)}
        />
      )}

    </div>
  )
})
