import { memo, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTagStore } from '../../stores/tag-store'
import { newestStatusUpdate, useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTaskRowActions } from '../../hooks/use-task-row-actions'
import { useToday } from '../../hooks/use-today'
import { formatRowDate, toDateInputValue } from '../../utils/date'
import { rowSummaryText } from '../../utils/list-zoom'
import { markerSummary } from '../../utils/markers'
import { statusNotesPreview } from '../../utils/notes-preview'
import { rowCue } from '../../utils/priority-cues'
import { dueState, followupState } from '../../utils/row-date-state'
import { isStale } from '../../utils/stale'
import { subtaskCount, type SubtaskCount } from '../../utils/subtasks'
import { TODO_ID_ATTR } from '../../utils/dom-contract'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { NotesIcon, RepeatIcon } from '../shared/icons'
import { ClockIcon } from '../shared/MarkerIcons'
import { POPOVER_LEVEL_ATTR } from '../shared/popover-level'
import { PriorityRing } from '../shared/PriorityRing'
import { TagPicker } from '../shared/TagChipSelector'
import { SubtaskCountStatic } from './subtasks/SubtaskCountButton'
import { keepRowTextUnselected } from './row-events'
import { TaskMenu } from './TaskMenu'
import { useTaskRowPickers } from './use-task-row-pickers'
import styles from './MobileTaskRow.module.css'

interface MobileTaskRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  /** A tap on the row (or Enter on its title) opens the task. */
  onOpenDetail?: (todoId: number) => void
}

const NO_PEOPLE: Person[] = []
const NO_TAGS: Tag[] = []
/** The checkbox's drawn box, px (its touch target is larger: `.checkbox`). */
const CHECKBOX_BOX = 20
/** Initials the details line shows before `+N`, as a stacked desktop row. */
const SHOWN_PEOPLE = 3

/** A popover or menu is open that the element isn't in: a press now is the one that closes it. */
function popoverOpenOutside(el: HTMLElement): boolean {
  for (const popover of document.querySelectorAll(`[${POPOVER_LEVEL_ATTR}]`)) {
    if (!popover.contains(el)) return true
  }
  return false
}

/**
 * The phone's task row: the desktop row's quiet sibling (D17). The checkbox
 * (a 44px target, the priority its ring as on desktop — `PriorityRing`), the
 * title up to two lines, and one muted details line under it: the due date
 * in words · the follow-up only while today or late · the checklist's count
 * · a notes / status-update mark · people's initials · the first tag and
 * `+N`. Colour only for what needs action now — an overdue or due-soon date,
 * a follow-up today or late — as the desktop row's date cells colour them
 * (`utils/row-date-state`). A completed row and a stale one read as on
 * desktop.
 *
 * A tap anywhere on it opens the task (its title is the row's one button,
 * stretched over it); the checkbox completes it. A long-press (the browser's
 * `contextmenu`) opens the task menu, which is how the due date, follow-up,
 * people, tags, subtasks and priority are reached without opening the task;
 * its pickers open at the row (`MobileRowActions`). The row has no pickers
 * of its own to tap: the task editor holds them all.
 */
export const MobileTaskRow = memo(function MobileTaskRow({ todo, assignedPeople, onOpenDetail }: MobileTaskRowProps) {
  const people = assignedPeople ?? NO_PEOPLE
  const rowRef = useRef<HTMLDivElement>(null)
  const swallowClick = useRef(false)
  const descriptionId = useId()
  // The task menu at the long-press point; its pickers mount on the first one and stay (a pick opens one after the menu closes).
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [actions, setActions] = useState(false)
  const { handleToggleComplete } = useTaskRowActions({ todo })
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const today = useToday()
  const tags = useTagStore((s) => s.assignedTagsMap.get(todo.id)) ?? NO_TAGS
  const newestUpdate = useStatusUpdateStore((s) => newestStatusUpdate(todo.id, s.byTodo))
  const subtasks = useSubtaskStore((s) => s.byTodo.get(todo.id))
  const count = subtasks && subtasks.length > 0 ? subtaskCount(subtasks) : null
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const priorityCues = useSettingsStore((s) => s.priorityCues)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const markers = markerSummary(todo, today, urgentRange)
  const cue = rowCue(todo, priorityCues, today, urgentRange)
  const stale = isStale(todo, today, staleAfterDays)
  const hasNotes = statusNotesPreview(newestUpdate, todo.notes) !== null
  // What the details line says, in words, for a screen reader (the line itself is drawn for the eye).
  const description = rowSummaryText(todo, today, {
    people: people.map((p) => p.name),
    tags: tags.map((t) => t.name),
    count,
    stale,
  }).split('\n').slice(1).join('. ')
  const own = (e: React.SyntheticEvent) => e.target instanceof Node && e.currentTarget.contains(e.target)

  return (
    <div
      ref={rowRef}
      style={cue.glow ? ({ '--row-glow': cue.glow } as CSSProperties) : undefined}
      className={`${styles.row} ${todo.isCompleted ? styles.completed : ''}`}
      {...{ [TODO_ID_ATTR]: todo.id }}
      data-stale={stale || undefined}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      onMouseDown={(e) => { if (own(e)) keepRowTextUnselected(e) }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // A long-press in the menu or a picker (portaled, but children here) isn't the row's.
        if (!own(e)) return
        setActions(true)
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
      onMouseEnter={() => useUIStore.getState().setHoveredTodoId(todo.id)}
      onMouseLeave={() => useUIStore.getState().setHoveredTodoId(null)}
    >
      <span className={styles.checkWrap}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={todo.isCompleted}
          onChange={handleToggleComplete}
          aria-label="Toggle complete"
        />
        <PriorityRing summary={markers} completed={todo.isCompleted} size={CHECKBOX_BOX} label={markers.label} />
      </span>

      <div className={styles.body}>
        <button
          type="button"
          className={`${styles.title} ${cue.semibold ? styles.titleSemibold : ''} ${todo.isCompleted ? styles.completedTitle : ''}`}
          data-task-title={todo.title}
          aria-describedby={description ? descriptionId : undefined}
          // A press that closes an open popover or menu goes no further: it doesn't open the task too.
          onPointerDown={(e) => { swallowClick.current = popoverOpenOutside(e.currentTarget) }}
          onClick={() => {
            if (swallowClick.current) {
              swallowClick.current = false
              return
            }
            onOpenDetail?.(todo.id)
          }}
        >
          <span className={styles.titleText}>{todo.title}</span>
        </button>
        <MobileRowDetails todo={todo} today={today} people={people} tags={tags} count={count} hasNotes={hasNotes} />
        {description && <span id={descriptionId} className={styles.srOnly}>{description}</span>}
      </div>

      {actions && (
        <MobileRowActions
          todo={todo}
          assignedPeople={people}
          rowRef={rowRef}
          menuAt={menuAt}
          onCloseMenu={() => setMenuAt(null)}
          onOpenDetail={onOpenDetail}
        />
      )}
    </div>
  )
})

/**
 * The details line (drawn only; the title's description says it in words):
 * due · follow-up (today or late only) · checklist count · notes mark ·
 * initials · first tag `+N`. Nothing when there is nothing to say.
 */
function MobileRowDetails({ todo, today, people, tags, count, hasNotes }: {
  todo: PersistedTodoItem
  today: Date
  people: readonly Person[]
  tags: readonly Tag[]
  count: SubtaskCount | null
  hasNotes: boolean
}) {
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const due = todo.dueDate
  const { past, soon } = dueState(todo, today, urgentRange)
  const next = todo.nextFollowupAt
  const followup = followupState(todo, today)
  const showFollowup = next != null && (followup === 'today' || followup === 'late')
  const shownPeople = people.slice(0, SHOWN_PEOPLE)
  const morePeople = people.length - shownPeople.length
  const firstTag = tags[0]
  if (!due && !showFollowup && !count && !hasNotes && people.length === 0 && !firstTag) return null
  return (
    <div className={styles.details} data-row-details="" aria-hidden="true">
      {due && (
        <span
          className={`${styles.part} ${styles.due} ${past ? styles.duePast : ''}`}
          data-row-part="due"
          data-due-soon={soon || undefined}
          data-due-past={past || undefined}
        >
          {todo.recurrenceRule ? <RepeatIcon size={11} /> : <ClockIcon />}
          {formatRowDate(due, today, rowDates)}
        </span>
      )}
      {showFollowup && (
        <span className={`${styles.part} ${styles.followup}`} data-row-part="followup" data-followup={followup}>
          <FollowupFlagIcon filled />
          {formatRowDate(next, today, rowDates)}
        </span>
      )}
      {count && <SubtaskCountStatic count={count} />}
      {hasNotes && <span className={styles.part} data-row-part="notes"><NotesIcon size={12} /></span>}
      {people.length > 0 && (
        <span className={styles.part} data-row-part="people">
          <span className={styles.avatars}>
            {shownPeople.map((p) => (
              <span key={p.id} className={styles.avatar} data-person-avatar={p.name}>
                {p.initials || p.name.slice(0, 2).toUpperCase()}
              </span>
            ))}
          </span>
          {morePeople > 0 && <span>+{morePeople}</span>}
        </span>
      )}
      {firstTag && (
        <span className={`${styles.part} ${styles.tags}`} data-row-part="tags">
          <span className={styles.tag} data-tag-name={firstTag.name}>#{firstTag.name}</span>
          {tags.length > 1 && <span className={styles.more}>+{tags.length - 1}</span>}
        </span>
      )}
    </div>
  )
}

/**
 * The row's task menu (long-press) and the pickers its items open (the row's
 * own, `useTaskRowPickers`): the row has no triggers for them, so they open
 * at the row — the people and tag pickers under it, the checklist as the
 * bottom sheet, the follow-up popover and the due date's picker from hidden
 * anchors at the title's start. As a Lines row's (`TaskLine`).
 */
function MobileRowActions({ todo, assignedPeople, rowRef, menuAt, onCloseMenu, onOpenDetail }: {
  todo: PersistedTodoItem
  assignedPeople: Person[]
  rowRef: RefObject<HTMLDivElement | null>
  menuAt: { x: number; y: number } | null
  onCloseMenu: () => void
  onOpenDetail?: (todoId: number) => void
}) {
  const {
    followupAnchorRef, deadlineInputRef, onDeadlineInputChange, menuHandlers, panels,
    tagPickerOpen, closeTagPicker, assignedTags, allTags, toggleTag, createTag,
  } = useTaskRowPickers({
    todo,
    assignedPeople,
    onOpenDetail,
    peoplePickerClassName: styles.chipDropdown,
    subtasksPanel: 'sheet',
    fallbackPeopleAnchorRef: rowRef,
    useFallbackPeopleAnchor: true,
    fallbackSubtasksAnchorRef: rowRef,
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
          anchorRef={rowRef}
          anchorIsInside={false}
          assignedTags={assignedTags}
          allTags={allTags}
          onToggle={toggleTag}
          onCreate={createTag}
          onClose={closeTagPicker}
        />
      )}
      {menuAt && (
        <TaskMenu
          todo={todo}
          point={menuAt}
          handlers={menuHandlers}
          onClose={onCloseMenu}
        />
      )}
    </>
  )
}
