import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useSettingsStore } from '../../stores/settings-store'
import { formatRowDate, toDateInputValue } from '../../utils/date'
import { dueTooltip } from '../../utils/effective-date'
import { followupPillLabel, followupTooltip, formatFollowupDate } from '../../utils/followup'
import { dueState, followupState } from '../../utils/row-date-state'
import type { SubtaskCount } from '../../utils/subtasks'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { RepeatIcon } from '../shared/icons'
import { ClockIcon } from '../shared/MarkerIcons'
import { useTooltip } from '../shared/use-tooltip'
import { SubtaskAddButton, SubtaskCountButton, SubtaskCountStatic } from './subtasks/SubtaskCountButton'
import styles from './TaskRow.module.css'

/** Avatars a stacked row shows before `+N`. */
const STACKED_AVATARS = 3

/** A part's click: the first click of a run only (a double-click opens once), never the row's. */
function partClick(open: (e: MouseEvent) => void) {
  return (e: MouseEvent) => {
    e.stopPropagation()
    if (e.detail > 1) return
    open(e)
  }
}

/** An absent part's mark: shown while the row is hovered, focused or has a picker open (opacity only). */
function Placeholder({ children }: { children: ReactNode }) {
  return <span className={styles.ph} aria-hidden="true">{children}</span>
}

export interface StackedDetailsProps {
  todo: PersistedTodoItem
  today: Date
  people: readonly Person[]
  tags: readonly Tag[]
  /** The checklist's count, or `null` with no checklist. */
  count: SubtaskCount | null
  /** No checklist on an open task: the add mark stands where the count would be, shown on hover. */
  canAddSubtasks?: boolean
  /** The drag overlay's copy: nothing to press. */
  ghost?: boolean
  deadlineInputRef: RefObject<HTMLInputElement | null>
  onOpenDue: () => void
  onDueInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  followupAnchorRef: RefObject<HTMLButtonElement | null>
  followupOpen: boolean
  onToggleFollowup: (e: MouseEvent) => void
  subtasksRef: RefObject<HTMLButtonElement | null>
  subtasksOpen: boolean
  onToggleSubtasks: (e: MouseEvent) => void
  peopleRef: RefObject<HTMLElement | null>
  peopleOpen: boolean
  onTogglePeople: () => void
  onPersonContextMenu?: (e: MouseEvent, person: Person) => void
  onPeopleContextMenu?: (e: MouseEvent) => void
  tagsRef: RefObject<HTMLButtonElement | null>
  tagsOpen: boolean
  onToggleTags: () => void
  onTagContextMenu?: (e: MouseEvent, tag: Tag) => void
  onTagsContextMenu?: (e: MouseEvent) => void
}

/**
 * A stacked row's second line (D25 C), under the title: due (its clock) ·
 * follow-up (its flag) · the checklist's pie and count · people · tags, at
 * the row's meta size. Each part opens its picker as the Rows cells do; an
 * absent date, person or tag is its mark, shown on hover / focus like a
 * Rows placeholder. A narrow list clips the line from the right — the
 * tags first, which ellipsize. Every part is a row cell (`data-row-cell`).
 */
export function StackedDetails(props: StackedDetailsProps) {
  const { count, ghost, canAddSubtasks = false } = props
  return (
    <div className={styles.stackedDetails} data-stacked-details="">
      <StackedDue {...props} />
      <StackedFollowup {...props} />
      {count && (ghost
        ? <SubtaskCountStatic count={count} />
        : <SubtaskCountButton count={count} open={props.subtasksOpen} buttonRef={props.subtasksRef} onClick={props.onToggleSubtasks} />)}
      {canAddSubtasks && (
        <SubtaskAddButton open={props.subtasksOpen} buttonRef={props.subtasksRef} onClick={props.onToggleSubtasks} className={styles.subtaskAdd} />
      )}
      <StackedPeople {...props} />
      <StackedTags {...props} />
    </div>
  )
}

function StackedDue({ todo, today, ghost, deadlineInputRef, onOpenDue, onDueInputChange }: StackedDetailsProps) {
  const due = todo.dueDate
  const { triggerProps, tooltip } = useTooltip(due ? dueTooltip(todo, today) : null)
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const { past, soon } = dueState(todo, today, range)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const repeats = todo.recurrenceRule != null
  return (
    <span className={styles.stackedPart}>
      <button
        type="button"
        className={`${styles.stackedButton} ${styles.due} ${past ? styles.duePast : ''}`}
        aria-label={due ? `Due ${formatFollowupDate(due, today)}` : 'Set due date'}
        data-row-cell="due"
        data-due-soon={soon || undefined}
        data-due-past={past || undefined}
        disabled={ghost}
        onClick={partClick(onOpenDue)}
        {...triggerProps}
      >
        {due ? (
          <>
            {repeats ? <RepeatIcon size={11} /> : <ClockIcon />}
            <span className={styles.dateText}>{formatRowDate(due, today, rowDates)}</span>
          </>
        ) : (
          <Placeholder><ClockIcon /></Placeholder>
        )}
        {tooltip}
      </button>
      <input
        ref={deadlineInputRef}
        type="date"
        className={styles.hiddenDateInput}
        value={due ? toDateInputValue(due) : ''}
        onChange={onDueInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  )
}

function StackedFollowup({ todo, today, ghost, followupAnchorRef, followupOpen, onToggleFollowup }: StackedDetailsProps) {
  const next = todo.nextFollowupAt
  const { triggerProps, tooltip } = useTooltip(next ? followupTooltip(todo, today) : null)
  const state = followupState(todo, today)
  const late = state === 'late'
  const rowDates = useSettingsStore((s) => s.rowDates)
  return (
    <button
      ref={followupAnchorRef}
      type="button"
      className={`${styles.stackedButton} ${styles.followup} ${followupOpen ? styles.cellOpen : ''}`}
      aria-label={next ? `Follow-up: ${followupPillLabel(todo, today)}${late ? ', late' : ''}` : 'Set follow-up'}
      aria-haspopup="dialog"
      aria-expanded={followupOpen}
      data-row-cell="followup"
      data-followup={state}
      disabled={ghost}
      onClick={partClick(onToggleFollowup)}
      {...triggerProps}
    >
      {next ? (
        <>
          <FollowupFlagIcon filled={state !== 'upcoming'} />
          <span className={styles.dateText}>{formatRowDate(next, today, rowDates)}</span>
        </>
      ) : (
        <Placeholder><FollowupFlagIcon /></Placeholder>
      )}
      {tooltip}
    </button>
  )
}

function StackedPeople({ people, ghost, peopleRef, peopleOpen, onTogglePeople, onPersonContextMenu, onPeopleContextMenu }: StackedDetailsProps) {
  const names = people.map((p) => p.name)
  const { triggerProps, tooltip } = useTooltip(names.length > 0 ? names.join(', ') : null)
  const shown = people.slice(0, STACKED_AVATARS)
  const more = people.length - shown.length
  return (
    <button
      ref={peopleRef as RefObject<HTMLButtonElement | null>}
      type="button"
      className={`${styles.stackedButton} ${peopleOpen ? styles.cellOpen : ''}`}
      aria-label={names.length > 0 ? `People: ${names.join(', ')}` : 'Assign people'}
      aria-haspopup="dialog"
      aria-expanded={peopleOpen}
      data-row-cell="people"
      disabled={ghost}
      onClick={partClick(onTogglePeople)}
      onContextMenu={people.length > 0 ? onPeopleContextMenu : undefined}
      {...triggerProps}
    >
      {people.length === 0 ? <Placeholder>@</Placeholder> : (
        <>
          <span className={styles.avatars}>
            {shown.map((p) => (
              <span
                key={p.id}
                className={styles.avatar}
                style={{ '--avatar-color': p.color || NEUTRAL_PERSON_COLOR } as CSSProperties}
                data-person-avatar={p.name}
                onContextMenu={onPersonContextMenu ? (e) => onPersonContextMenu(e, p) : undefined}
              >
                {p.initials || p.name.slice(0, 2).toUpperCase()}
              </span>
            ))}
          </span>
          {more > 0 && <span className={styles.more}>+{more}</span>}
        </>
      )}
      {tooltip}
    </button>
  )
}

function StackedTags({ tags, ghost, tagsRef, tagsOpen, onToggleTags, onTagContextMenu, onTagsContextMenu }: StackedDetailsProps) {
  const labels = tags.map((t) => `#${t.name}`)
  const { triggerProps, tooltip } = useTooltip(labels.length > 0 ? labels.join(' ') : null)
  return (
    <button
      ref={tagsRef}
      type="button"
      className={`${styles.stackedButton} ${styles.stackedTags} ${tagsOpen ? styles.cellOpen : ''}`}
      aria-label={tags.length > 0 ? `Tags: ${tags.map((t) => t.name).join(', ')}` : 'Add tag'}
      aria-haspopup="dialog"
      aria-expanded={tagsOpen}
      data-row-cell="tags"
      disabled={ghost}
      onClick={partClick(onToggleTags)}
      onContextMenu={tags.length > 0 ? onTagsContextMenu : undefined}
      {...triggerProps}
    >
      {tags.length === 0 ? <Placeholder>#</Placeholder> : tags.map((t) => (
        <span
          key={t.id}
          className={styles.tag}
          data-tag-name={t.name}
          onContextMenu={onTagContextMenu ? (e) => onTagContextMenu(e, t) : undefined}
        >
          #{t.name}
        </span>
      ))}
      {tooltip}
    </button>
  )
}
