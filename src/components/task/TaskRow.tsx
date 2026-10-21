import { useRef, useState, useCallback, useMemo, memo, type MouseEvent } from 'react'
import { type PersistedTodoItem, type Person, type Tag, DEFAULT_STATUS_ICON } from '../../models'
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
import { EntityMenu, type MenuEntity } from '../shared/EntityMenu'
import { useTaskRowPickers } from './use-task-row-pickers'
import { useTaskRowColumn, useTaskRowTracks } from './task-row-grid-context'
import { keepRowTextUnselected } from './row-events'
import { progressNotesPreview } from '../../utils/notes-preview'
import {
  DatesCell, MarkerGutter, MarkerGutterStatic, NotesCell, NotesGlyph, PeopleCell, StatusCell, TagsCell,
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
 *   markers · checkbox · title │ notes · people · tags · dates · status
 *
 * Every column is always there; a click on a cell opens its picker anchored
 * to it (the dates cell: its due part the date input, its follow-up part the
 * follow-up popover), and an empty cell shows its placeholder only on hover /
 * focus — by opacity, so nothing moves. Squeezed details narrow people and
 * tags, then show the dates as icons, then drop tags and people
 * (`utils/task-row-columns`). Click selects, a click on a
 * selected row's title edits it inline, a double-click on the title or empty
 * space opens the editor, right-click opens the task menu at the pointer and
 * Shift+F10 / the context-menu key under the focused cell (there is no ⋯
 * button); the whole row is the drag source (its list wraps it).
 */
export const TaskRow = memo(function TaskRow({
  todo, assignedPeople, isSelected, ghost,
  onSelect, onOpenDetail,
}: TaskRowProps) {
  // Whether the people / tags columns are there: a row re-renders when one comes or goes, not on every
  // column change (the tracks go straight to its style, the avatar / tag fit is the cells' own).
  const hasPeople = useTaskRowColumn((c) => c.people > 0)
  const hasTags = useTaskRowColumn((c) => c.tags > 0)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [markersOpen, setMarkersOpen] = useState(false)
  /**
   * The task menu: at the pointer (right-click), or under the focused cell
   * (`menuCellRef`; Shift+F10 / the context-menu key), which gets the focus
   * back when it closes.
   */
  const [menu, setMenu] = useState<{ kind: 'point'; x: number; y: number } | { kind: 'cell' } | null>(null)
  const menuCellRef = useRef<HTMLElement | null>(null)
  /** An avatar's / tag's menu: at the pointer, or under its cell (opened from the keyboard). */
  const [entityMenu, setEntityMenu] = useState<
    { entities: MenuEntity[]; at: { kind: 'point'; x: number; y: number } | { kind: 'cell'; cell: 'people' | 'tags' } } | null
  >(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLButtonElement>(null)
  const markersRef = useRef<HTMLButtonElement>(null)
  useTaskRowTracks(rowRef)
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
    useFallbackPeopleAnchor: !hasPeople,
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
  const pickerOpen = showStatusMenu || peopleOpen || tagPickerOpen || followupOpen || notesOpen || markersOpen
    || menu !== null || entityMenu !== null

  // Right-click on an avatar / a tag: Show tasks · Edit… · Delete… for it.
  const openEntityMenu = (e: MouseEvent, entity: MenuEntity) => {
    e.preventDefault()
    e.stopPropagation()
    setEntityMenu({ entities: [entity], at: { kind: 'point', x: e.clientX, y: e.clientY } })
  }
  const onPersonContextMenu = (e: MouseEvent, person: Person) => openEntityMenu(e, { kind: 'person', entity: person })
  const onTagContextMenu = (e: MouseEvent, tag: Tag) => openEntityMenu(e, { kind: 'tag', entity: tag })
  // The cell's own context menu (the keyboard's, or a click beside the
  // avatars / tags): every entry it shows; an empty cell keeps the task menu.
  const onCellContextMenu = (cell: 'people' | 'tags', entities: MenuEntity[]) => (e: MouseEvent) => {
    if (entities.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setEntityMenu({ entities, at: { kind: 'cell', cell } })
  }

  return (
    <div
      ref={rowRef}
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''} ${pickerOpen ? styles.rowDropdownOpen : ''}`}
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
        // From the keyboard (no right button; Chromium reports -1) on a focused cell.
        if (e.button !== 2 && e.target instanceof HTMLElement && e.target === document.activeElement && e.target !== e.currentTarget) {
          menuCellRef.current = e.target
          setMenu({ kind: 'cell' })
        } else {
          setMenu({ kind: 'point', x: e.clientX, y: e.clientY })
        }
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
        progressNotesPreview(todo.progress, todo.notes)
          ? <span className={`${styles.cell} ${styles.cellCenter}`} title="Has progress or notes"><NotesGlyph /></span>
          : null
      ) : (
        <>
          <NotesCell progress={todo.progress} notes={todo.notes} anchorRef={notesIconRef} open={notesOpen} onToggle={toggleNotes} />
          {hasPeople && (
            <PeopleCell
              people={people}
              anchorRef={peopleRef}
              open={peopleOpen}
              onToggle={togglePeople}
              onPersonContextMenu={onPersonContextMenu}
              onCellContextMenu={onCellContextMenu('people', people.map((p) => ({ kind: 'person', entity: p })))}
            />
          )}
          {hasTags && (
            <TagsCell
              tags={assignedTags}
              anchorRef={tagsRef}
              open={tagPickerOpen}
              onToggle={toggleTagPicker}
              onTagContextMenu={onTagContextMenu}
              onCellContextMenu={onCellContextMenu('tags', assignedTags.map((t) => ({ kind: 'tag', entity: t })))}
            />
          )}
          <DatesCell
            todo={todo}
            today={today}
            deadlineInputRef={deadlineInputRef}
            onOpenDue={openDeadlinePicker}
            onClearDue={() => bulk.setDeadline(todo.id, null)}
            onDueInputChange={onDeadlineInputChange}
            followupAnchorRef={followupAnchorRef}
            followupOpen={followupOpen}
            onToggleFollowup={toggleFollowup}
            onClearFollowup={() => bulk.setFollowup(todo.id, null)}
          />
          <StatusCell status={status} anchorRef={statusRef} open={showStatusMenu} onToggle={() => setShowStatusMenu((v) => !v)} />
        </>
      )}

      {/* The people picker, the follow-up popover and the notes popover. */}
      {panels}

      {!ghost && tagPickerOpen && (
        <TagPicker
          // With its column removed, the tag picker (Add tag…) opens at the row.
          anchorRef={hasTags ? tagsRef : rowRef}
          anchorIsInside={hasTags}
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

      {entityMenu && (
        <EntityMenu
          entities={entityMenu.entities}
          anchorRef={entityMenu.at.kind === 'cell' ? (entityMenu.at.cell === 'people' ? peopleRef : tagsRef) : undefined}
          point={entityMenu.at.kind === 'point' ? { x: entityMenu.at.x, y: entityMenu.at.y } : undefined}
          closeOnScroll={entityMenu.at.kind === 'point'}
          onClose={() => setEntityMenu(null)}
        />
      )}

      {menu && (
        <TaskMenu
          todo={todo}
          anchorRef={menu.kind === 'cell' ? menuCellRef : undefined}
          point={menu.kind === 'point' ? { x: menu.x, y: menu.y } : undefined}
          handlers={menuHandlers}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
})
