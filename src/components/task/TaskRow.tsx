import { useRef, useState, useCallback, useMemo, memo, type MouseEvent } from 'react'
import { type PersistedTodoItem, type Person, DEFAULT_STATUS_ICON } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useStatusStore } from '../../stores/status-store'
import { useInlineEdit } from '../../hooks/use-inline-edit'
import { startOfToday } from '../../utils/date'
import { StatusIcon } from '../shared/StatusIcon'
import { TagPicker } from '../shared/TagChipSelector'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { useTooltip } from '../shared/use-tooltip'
import { TaskMenu } from './TaskMenu'
import { PriorityMenu } from './PriorityMenu'
import { MoreIcon } from '../shared/icons'
import { personTaskDialog } from '../../services/task-dialog'
import { useTaskRowPickers } from './use-task-row-pickers'
import { useTaskRowColumns } from './task-row-grid-context'
import { keepRowTextUnselected } from './row-events'
import {
  DueCell, FollowupCell, MarkerGutter, MarkerGutterStatic, NotesCell, NotesGlyph, PeopleCell, StatusCell, TagsCell,
} from './row-cells'
import styles from './TaskRow.module.css'

interface TaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  isSelected?: boolean
  /** The drag overlay's copy of the row: no triggers or pickers, no hover sync. */
  ghost?: boolean
  onSelect?: (todoId: number, mods: { shift: boolean; ctrl: boolean }) => void
  onOpenDetail?: (todoId: number) => void
}

const NO_PEOPLE: Person[] = []

/**
 * The desktop task row: one grid column per field, the same columns on every
 * row of its list (`TaskRowGrid`; the default split outside one):
 *
 *   markers · checkbox · title │ notes · people · tags · due · follow-up · status · ⋯
 *
 * Every column is always there; a click on a cell opens its picker anchored
 * to it, and an empty cell shows its placeholder only on hover / focus — by
 * opacity, so nothing moves. Only people and tags give way when the details
 * are squeezed (`utils/task-row-columns`). Click selects, a click on a
 * selected row's title edits it inline, a double-click on the title or empty
 * space opens the editor, right-click opens the task menu; the whole row is
 * the drag source (its list wraps it).
 */
export const TaskRow = memo(function TaskRow({
  todo, assignedPeople, isSelected, ghost,
  onSelect, onOpenDetail,
}: TaskRowProps) {
  const cols = useTaskRowColumns()
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [markersOpen, setMarkersOpen] = useState(false)
  /** The task menu: from the ⋯ button, or at the pointer (right-click). */
  const [menu, setMenu] = useState<{ kind: 'button' } | { kind: 'point'; x: number; y: number } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const statusRef = useRef<HTMLButtonElement>(null)
  const markersRef = useRef<HTMLButtonElement>(null)
  const tagsRef = useRef<HTMLButtonElement>(null)

  const {
    bulk, handleToggleComplete, assignedTags, allTags, tagPickerOpen, toggleTagPicker, closeTagPicker, toggleTag, createTag,
    peopleOpen, togglePeople, peopleRef, followupOpen, toggleFollowup, followupAnchorRef, notesOpen, toggleNotes, notesIconRef,
    deadlineInputRef, openDeadlinePicker, onDeadlineInputChange, menuHandlers, panels,
  } = useTaskRowPickers({
    todo,
    assignedPeople,
    ghost,
    onOpenDetail,
    peoplePickerClassName: styles.chipDropdown,
    // With its column removed, the people picker (Assign people…) opens at the row.
    fallbackPeopleAnchorRef: rowRef,
    useFallbackPeopleAnchor: cols.people === 0,
  })

  const statuses = useStatusStore((s) => s.statuses)
  const status = useMemo(() => {
    if (!todo.statusId) return undefined
    return statuses.find(st => st.id === todo.statusId)
  }, [todo.statusId, statuses])

  // Cross-surface hover highlighting
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)

  // Inline title editing
  const handleSaveTitle = useCallback((newTitle: string) => {
    void useTodoStore.getState().update(todo.id, { title: newTitle })
  }, [todo.id])
  const {
    isEditing, editTitle, setEditTitle, inputRef: titleInputRef,
    save: saveTitle, handleKeyDown: handleTitleKeyDown, scheduleEdit, cancelScheduledEdit,
  } = useInlineEdit(todo.title, handleSaveTitle)

  // The full title in the tooltip — only when it's cut off.
  const { triggerProps: titleTipProps, tooltip: titleTip } = useTooltip(todo.title)
  const onTitlePointerEnter = (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    if (el.scrollWidth > el.clientWidth) titleTipProps.onPointerEnter?.(e)
  }

  const today = startOfToday()
  const people = assignedPeople ?? NO_PEOPLE

  const closeStatus = useCallback(() => setShowStatusMenu(false), [])
  const pickerOpen = showStatusMenu || peopleOpen || tagPickerOpen || followupOpen || notesOpen || markersOpen || menu !== null

  const onPersonContextMenu = (e: MouseEvent, person: Person) => {
    e.preventDefault()
    e.stopPropagation()
    useUIStore.getState().showTaskDialog(personTaskDialog(person))
  }

  return (
    <div
      ref={rowRef}
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${pickerOpen ? styles.rowDropdownOpen : ''}`}
      style={{ gridTemplateColumns: cols.template }}
      data-todo-id={todo.id}
      data-ghosted={ghost ? '' : undefined}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      onMouseEnter={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(todo.id)}
      onMouseLeave={ghost ? undefined : () => useUIStore.getState().setHoveredTodoId(null)}
      onClick={(e) => { e.stopPropagation(); onSelect?.(todo.id, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }) }}
      onMouseDown={keepRowTextUnselected}
      onDoubleClick={(e) => {
        e.stopPropagation()
        // A double-click on a cell opened its picker (once); only the title and empty space open the editor.
        if (e.target instanceof Element && e.target.closest('[data-row-cell]')) return
        cancelScheduledEdit()
        if (!isEditing) onOpenDetail?.(todo.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ kind: 'point', x: e.clientX, y: e.clientY })
      }}
    >
      {ghost
        ? <MarkerGutterStatic todo={todo} today={today} />
        : <MarkerGutter todo={todo} today={today} anchorRef={markersRef} open={markersOpen} onToggle={() => setMarkersOpen((v) => !v)} />}

      <input
        type="checkbox"
        className={styles.checkbox}
        checked={todo.isCompleted}
        onChange={handleToggleComplete}
        onClick={(e) => e.stopPropagation()}
        aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
        data-row-cell="checkbox"
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
        <span
          className={`${styles.title} ${todo.isCompleted ? styles.completedTitle : ''}`}
          data-task-title={todo.title}
          {...titleTipProps}
          onPointerEnter={onTitlePointerEnter}
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
          {titleTip}
        </span>
      )}

      {ghost ? (
        // The drag overlay's copy: the title and a notes mark only.
        todo.notes ? <span className={`${styles.cell} ${styles.cellCenter}`} title="Has notes"><NotesGlyph /></span> : null
      ) : (
        <>
          <NotesCell hasNotes={!!todo.notes} anchorRef={notesIconRef} open={notesOpen} onToggle={toggleNotes} />
          {cols.people > 0 && (
            <PeopleCell
              people={people}
              track={cols.people}
              anchorRef={peopleRef}
              open={peopleOpen}
              onToggle={togglePeople}
              onPersonContextMenu={onPersonContextMenu}
            />
          )}
          {cols.tags > 0 && (
            <TagsCell tags={assignedTags} track={cols.tags} anchorRef={tagsRef} open={tagPickerOpen} onToggle={toggleTagPicker} />
          )}
          <DueCell
            todo={todo}
            today={today}
            inputRef={deadlineInputRef}
            onOpen={openDeadlinePicker}
            onClear={() => bulk.setDeadline(todo.id, null)}
            onInputChange={onDeadlineInputChange}
          />
          <FollowupCell todo={todo} today={today} anchorRef={followupAnchorRef} open={followupOpen} onToggle={toggleFollowup} />
          <StatusCell status={status} anchorRef={statusRef} open={showStatusMenu} onToggle={() => setShowStatusMenu((v) => !v)} />
          <button
            ref={moreRef}
            type="button"
            className={`${styles.cell} ${styles.cellCenter} ${styles.moreBtn} ${menu ? styles.cellOpen : ''}`}
            aria-label="Task actions"
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            data-row-cell="more"
            onClick={(e) => {
              e.stopPropagation()
              if (e.detail > 1) return
              setMenu((m) => (m ? null : { kind: 'button' }))
            }}
          >
            <MoreIcon />
          </button>
        </>
      )}

      {/* The people picker, the follow-up popover and the notes popover. */}
      {panels}

      {!ghost && tagPickerOpen && (
        <TagPicker
          // With its column removed, the tag picker (Add tag…) opens at the row.
          anchorRef={cols.tags > 0 ? tagsRef : rowRef}
          anchorIsInside={cols.tags > 0}
          assignedTags={assignedTags}
          allTags={allTags}
          onToggle={toggleTag}
          onCreate={createTag}
          onClose={closeTagPicker}
        />
      )}

      {!ghost && showStatusMenu && (
        <AnchoredPicker anchorRef={statusRef} onClose={closeStatus} closeOnEscape>
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
        </AnchoredPicker>
      )}

      {markersOpen && (
        <PriorityMenu
          todo={todo}
          anchorRef={markersRef}
          onSetMarker={menuHandlers.onSetMarker}
          onClose={() => setMarkersOpen(false)}
        />
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
