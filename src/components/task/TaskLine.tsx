import { memo, useRef, useState, type RefObject } from 'react'
import type { PersistedTodoItem, Person } from '../../models'
import { useSettingsStore } from '../../stores/settings-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { startOfToday, toDateInputValue } from '../../utils/date'
import { rowSummaryText, rowTone } from '../../utils/list-zoom'
import { isStale } from '../../utils/stale'
import { subtaskCount } from '../../utils/subtasks'
import { TODO_ID_ATTR } from '../../utils/dom-contract'
import { useTooltip } from '../shared/use-tooltip'
import { TagPicker } from '../shared/TagChipSelector'
import { keepRowTextUnselected } from './row-events'
import { TaskMenu } from './TaskMenu'
import { useTaskRowPickers } from './use-task-row-pickers'
import styles from './TaskLine.module.css'
import rowStyles from './TaskRow.module.css'

/** Modifier keys of a click that selects. */
export interface LineSelectMods {
  shift: boolean
  ctrl: boolean
}

/** A task's state as a Lines tick draws it (`utils/list-zoom.rowTone`), with the Settings it reads. */
function useRowTone(todo: PersistedTodoItem, today: Date) {
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  return {
    tone: rowTone(todo, today, { urgentRange, staleAfterDays }),
    stale: isStale(todo, today, staleAfterDays),
  }
}

/** Cross-surface hover sync (the calendar's entry, the row elsewhere), as `TaskRow` does it. */
function hoverProps(todoId: number) {
  return {
    onMouseEnter: () => useUIStore.getState().setHoveredTodoId(todoId),
    onMouseLeave: () => useUIStore.getState().setHoveredTodoId(null),
  }
}

const NO_PEOPLE: readonly Person[] = []

/**
 * A task at the Lines zoom (D25 I1): a 15px line — a 3px state tick where
 * the checkbox was (late, due soon, follow-up late, stale or none:
 * `rowTone`) and the title alone at 10.5px, starting where a row's title
 * does. No cells: hovering shows what they'd say (`rowSummaryText`), a
 * click opens the editor (and selects the task); Shift / Ctrl-click only
 * selects; a right-click (or the context-menu key) opens the task menu, as
 * a row's does (`LineActions`). Its list wraps it as the drag source, as a
 * row.
 */
export const TaskLine = memo(function TaskLine({ todo, assignedPeople, onSelect, onOpenDetail }: {
  todo: PersistedTodoItem
  assignedPeople?: readonly Person[]
  onSelect?: (todoId: number, mods: LineSelectMods) => void
  onOpenDetail?: (todoId: number) => void
}) {
  const lineRef = useRef<HTMLDivElement>(null)
  // The task menu at the pointer; its pickers mount on the first right-click and stay (a pick opens one after the menu closes).
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [actions, setActions] = useState(false)
  // Clicks in the menu and its pickers (portaled, but children here) aren't the line's.
  const own = (e: React.SyntheticEvent) => e.target instanceof Node && e.currentTarget.contains(e.target)
  const today = startOfToday()
  const { tone, stale } = useRowTone(todo, today)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const tags = useTagStore((s) => s.assignedTagsMap.get(todo.id))
  const subtasks = useSubtaskStore((s) => s.byTodo.get(todo.id))
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const people = assignedPeople ?? NO_PEOPLE
  const tip = rowSummaryText(todo, today, {
    rowDates,
    people: people.map((p) => p.name),
    tags: (tags ?? []).map((t) => t.name),
    count: subtasks && subtasks.length > 0 ? subtaskCount(subtasks) : null,
    stale,
  })
  const { triggerProps, tooltip } = useTooltip(tip)
  return (
    <div
      ref={lineRef}
      className={`${styles.line} ${todo.isCompleted ? styles.completed : ''}`}
      {...{ [TODO_ID_ATTR]: todo.id }}
      data-tone={tone}
      data-stale={stale || undefined}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      data-task-line=""
      {...hoverProps(todo.id)}
      {...triggerProps}
      onMouseDown={(e) => { if (own(e)) keepRowTextUnselected(e) }}
      onClick={(e) => {
        e.stopPropagation()
        if (!own(e)) return
        const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }
        onSelect?.(todo.id, mods)
        if (!mods.shift && !mods.ctrl) onOpenDetail?.(todo.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!own(e)) return
        // From the keyboard (no pointer position): under the line's start.
        const at = e.button === 2 || e.clientX !== 0 || e.clientY !== 0
          ? { x: e.clientX, y: e.clientY }
          : (() => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.left, y: r.bottom } })()
        setActions(true)
        setMenuAt(at)
      }}
    >
      <span className={styles.tick} aria-hidden="true" />
      <span className={styles.title} data-task-title={todo.title}>{todo.title}</span>
      {tooltip}
      {actions && (
        <LineActions
          todo={todo}
          assignedPeople={assignedPeople}
          lineRef={lineRef}
          menuAt={menuAt}
          onCloseMenu={() => setMenuAt(null)}
          onOpenDetail={onOpenDetail}
        />
      )}
    </div>
  )
})

/**
 * A Lines row's task menu and the pickers its items open (the row's own,
 * `useTaskRowPickers`): the line has no cells, so they open at the line —
 * the people and tag pickers and the checklist under it, the follow-up
 * popover and the due date's picker from hidden anchors at the title's start.
 */
function LineActions({ todo, assignedPeople, lineRef, menuAt, onCloseMenu, onOpenDetail }: {
  todo: PersistedTodoItem
  assignedPeople?: readonly Person[]
  lineRef: RefObject<HTMLDivElement | null>
  menuAt: { x: number; y: number } | null
  onCloseMenu: () => void
  onOpenDetail?: (todoId: number) => void
}) {
  const {
    followupAnchorRef, deadlineInputRef, onDeadlineInputChange, menuHandlers, panels,
    tagPickerOpen, closeTagPicker, assignedTags, allTags, toggleTag, createTag,
  } = useTaskRowPickers({
    todo,
    assignedPeople: assignedPeople ? [...assignedPeople] : undefined,
    onOpenDetail,
    peoplePickerClassName: rowStyles.chipDropdown,
    fallbackPeopleAnchorRef: lineRef,
    useFallbackPeopleAnchor: true,
    fallbackSubtasksAnchorRef: lineRef,
    useFallbackSubtasksAnchor: true,
  })
  return (
    <>
      <button ref={followupAnchorRef} type="button" className={styles.anchor} tabIndex={-1} aria-hidden="true" />
      <input
        ref={deadlineInputRef}
        type="date"
        className={styles.anchor}
        tabIndex={-1}
        aria-hidden="true"
        value={todo.dueDate ? toDateInputValue(todo.dueDate) : ''}
        onChange={onDeadlineInputChange}
      />
      {panels}
      {tagPickerOpen && (
        <TagPicker
          anchorRef={lineRef}
          anchorIsInside={false}
          assignedTags={assignedTags}
          allTags={allTags}
          onToggle={toggleTag}
          onCreate={createTag}
          onClose={closeTagPicker}
        />
      )}
      {menuAt && <TaskMenu todo={todo} point={menuAt} handlers={menuHandlers} onClose={onCloseMenu} />}
    </>
  )
}
