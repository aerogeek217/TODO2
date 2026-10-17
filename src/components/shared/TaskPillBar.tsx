import { memo } from 'react'
import type { CSSProperties, MouseEvent, Ref } from 'react'
import { type PersistedTodoItem, type Person, type Status, DEFAULT_STATUS_ICON } from '../../models'
import { formatDateNumeric, formatDateShort } from '../../utils/date'
import { isDeadlinePast } from '../../utils/effective-date'
import { followupPillLabel, followupTooltip, isFollowupOverdue } from '../../utils/followup'
import { startOfDay } from '../../utils/date'
import { FollowupFlagIcon } from './FollowupIcons'
import { useTooltip } from './use-tooltip'
import { StatusIcon } from './StatusIcon'
import { AvatarStack } from './AvatarStack'
import styles from './TaskPillBar.module.css'

/**
 * Shared task-pill bar — the one due-date / people / status chip
 * implementation for `MobileTaskRow` / `TopBar`'s `SearchResultPills`
 * (the desktop `TaskRow` has its own column cells).
 *
 * Tags: this primitive does NOT render tag chips. Tag display is the
 * separate `TagChipSelector` shared component, mounted by `MobileTaskRow`
 * adjacent to (not inside) the pill bar — adding tags here
 * would force every consumer of `TaskPillBar` (search dropdown, etc.) to
 * thread tags they don't render.
 *
 * Perf — the consumer pre-resolves people / status and threads them
 * through; this primitive does NOT subscribe to any store.
 *
 * Composition — `<TaskPillBar>` is the default composed bar (people →
 * dates → follow-up → status, the layout used by `MobileTaskRow` /
 * `SearchResultRow`). Surfaces with a different layout compose
 * `<TaskPillPeople>`, `<TaskPillDates>`, `<TaskPillStatus>` directly.
 */

// ─── Shared types ────────────────────────────────────────────────────────────

interface PillCommon {
  /** When false, the part renders as non-interactive `<span>`s — used
   * inside surfaces whose row IS the click target (`SearchResultRow`). */
  interactive?: boolean
  /** Compact = icon-only date markers + smaller avatars. */
  compact?: boolean
  /** Smaller avatars even when `compact` is false (mobile). */
  density?: 'default' | 'small'
}

interface TaskPillPeopleProps extends PillCommon {
  people: readonly Person[]
  anchorRef?: Ref<HTMLDivElement>
  onPeopleClick?: (e: MouseEvent) => void
  onPersonContextMenu?: (e: MouseEvent, person: Person) => void
}

interface TaskPillDatesProps extends PillCommon {
  todo: PersistedTodoItem
  today: Date
  /** `'short'` = `Oct 20` (default), `'numeric'` = `10/20` (the phone row). */
  dateFormat?: 'short' | 'numeric'
  deadlineIntensity?: number
  onDeadlineClick?: (e: MouseEvent) => void
  /** When provided AND interactive=true, the due-date chip shows an
   * × clear button on hover. */
  onDeadlineClear?: (e: MouseEvent) => void
}

interface TaskPillFollowupProps extends PillCommon {
  todo: PersistedTodoItem
  today: Date
  anchorRef?: Ref<HTMLButtonElement>
  /** Draws the "popover open" ring. */
  open?: boolean
  onFollowupClick?: (e: MouseEvent) => void
  /** When provided (and interactive), the pill shows a × that clears only
   * `nextFollowupAt`. Touch rows and completed tasks never show it. */
  onFollowupClear?: (e: MouseEvent) => void
  /** Just the flag, no day (the phone row; the tooltip and name carry the date). */
  flagOnly?: boolean
}

interface TaskPillStatusProps extends PillCommon {
  status?: Status
  anchorRef?: Ref<HTMLDivElement>
  onStatusClick?: (e: MouseEvent) => void
}

// ─── People ───────────────────────────────────────────────────────────────────

export const TaskPillPeople = memo(function TaskPillPeople({
  people, interactive = true, compact = false, density = 'default',
  anchorRef, onPeopleClick, onPersonContextMenu,
}: TaskPillPeopleProps) {
  if (people.length === 0) return null
  const avatarSize = (compact || density === 'small') ? 'sm' : 'md'
  return (
    <div ref={anchorRef} className={styles.peopleGroup} data-pill="people">
      <AvatarStack
        people={[...people]}
        max={compact ? 2 : 3}
        size={avatarSize}
        readOnly={!interactive}
        onClick={interactive ? onPeopleClick : undefined}
        onPersonContextMenu={interactive && onPersonContextMenu
          ? (e, p) => onPersonContextMenu(e, p as Person)
          : undefined}
      />
    </div>
  )
})

// ─── Dates ────────────────────────────────────────────────────────────────────

export const TaskPillDates = memo(function TaskPillDates({
  todo, today, interactive = true, compact = false,
  dateFormat = 'short', deadlineIntensity,
  onDeadlineClick, onDeadlineClear,
}: TaskPillDatesProps) {
  const hasDeadline = !!todo.dueDate
  if (!hasDeadline) return null

  const deadlinePast = isDeadlinePast({ dueDate: todo.dueDate }, today)

  if (compact) {
    return (
      <>
        <span className={styles.markerDeadline} aria-label="Due">
          <StatusIcon icon="clock" />
        </span>
        {todo.recurrenceRule && (
          <span
            className={styles.markerRecurrence}
            title={`Repeats ${todo.recurrenceRule.type}`}
            aria-label="Recurring"
          >
            &#x21bb;
          </span>
        )}
      </>
    )
  }

  const deadlineChipStyle: CSSProperties | undefined =
    deadlineIntensity != null
      ? ({ '--date-intensity': deadlineIntensity } as CSSProperties)
      : undefined

  const deadlineChipClass = `${styles.deadlineChip} ${deadlinePast ? styles.deadlineChipPast : ''}`
  const deadlineChip = (
    interactive ? (
      <button
        type="button"
        className={deadlineChipClass}
        style={deadlineChipStyle}
        onClick={onDeadlineClick}
        data-pill="due"
        title={deadlinePast ? 'Due date passed — click to change' : 'Due — click to change'}
        aria-label="Edit due date"
      >
        <StatusIcon icon="clock" />
        {dateFormat === 'numeric' ? formatDateNumeric(todo.dueDate!) : formatDateShort(todo.dueDate!)}
        {todo.recurrenceRule && (
          <span className={styles.recurrenceIndicator} title={`Repeats ${todo.recurrenceRule.type}`}>
            &#x21bb;
          </span>
        )}
        {onDeadlineClear && (
          <span
            className={styles.chipClear}
            role="button"
            tabIndex={-1}
            aria-label="Clear due date"
            title="Clear due date"
            onClick={(e) => { e.stopPropagation(); onDeadlineClear(e) }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            &times;
          </span>
        )}
      </button>
    ) : (
      <span
        className={deadlineChipClass}
        style={deadlineChipStyle}
        title={deadlinePast ? 'Due date passed' : 'Due'}
      >
        <StatusIcon icon="clock" />
        {dateFormat === 'numeric' ? formatDateNumeric(todo.dueDate!) : formatDateShort(todo.dueDate!)}
        {todo.recurrenceRule && (
          <span className={styles.recurrenceIndicator} title={`Repeats ${todo.recurrenceRule.type}`}>
            &#x21bb;
          </span>
        )}
      </span>
    )
  )

  return (
    <div className={styles.dateInline}>
      {deadlineChip}
    </div>
  )
})

// ─── Follow-up ────────────────────────────────────────────────────────────────

export const TaskPillFollowup = memo(function TaskPillFollowup({
  todo, today, interactive = true, compact = false, anchorRef, open = false,
  onFollowupClick, onFollowupClear, flagOnly = false,
}: TaskPillFollowupProps) {
  const next = compact ? undefined : todo.nextFollowupAt
  const { triggerProps, tooltip } = useTooltip(next ? followupTooltip(todo, today) : null)
  if (!next) return null
  const overdue = isFollowupOverdue(todo, today)
  const isToday = !todo.isCompleted
    && startOfDay(new Date(next)).getTime() === startOfDay(today).getTime()
  const showClear = interactive && !!onFollowupClear && !todo.isCompleted
  const cls = [
    styles.followupChip,
    overdue ? styles.followupChipOverdue : '',
    isToday ? styles.followupChipToday : '',
    showClear ? styles.followupChipWithClear : '',
    open ? styles.followupChipOpen : '',
    flagOnly ? styles.followupChipFlagOnly : '',
  ].filter(Boolean).join(' ')
  const label = followupPillLabel(todo, today)

  if (!interactive) {
    return (
      <span className={cls} data-followup-overdue={overdue ? 'true' : undefined} {...triggerProps}>
        <FollowupFlagIcon />
        {!flagOnly && label}
        {tooltip}
      </span>
    )
  }
  return (
    <button
      ref={anchorRef}
      type="button"
      className={cls}
      onClick={onFollowupClick}
      {...triggerProps}
      aria-label={`Follow-up: ${label}${overdue ? ', late' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-pill="followup"
      data-followup-overdue={overdue ? 'true' : undefined}
    >
      <FollowupFlagIcon />
      {!flagOnly && <span className={styles.followupLabel}>{label}</span>}
      {showClear && (
        <span
          className={styles.followupClear}
          role="button"
          tabIndex={-1}
          aria-label="Clear follow-up"
          onClick={(e) => { e.stopPropagation(); onFollowupClear(e) }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          &times;
        </span>
      )}
      {tooltip}
    </button>
  )
})

// ─── Status ───────────────────────────────────────────────────────────────────

export const TaskPillStatus = memo(function TaskPillStatus({
  status, interactive = true, anchorRef, onStatusClick,
}: TaskPillStatusProps) {
  if (interactive) {
    return (
      <div ref={anchorRef} className={styles.statusWrapper}>
        <button
          type="button"
          className={styles.statusButton}
          style={status ? { color: status.color } : undefined}
          onClick={onStatusClick}
          aria-label={status ? `Status: ${status.name}` : 'Set status'}
        >
          {status
            ? <StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} filled />
            : <span className={styles.statusDotEmpty} />}
        </button>
      </div>
    )
  }

  return (
    <span
      className={styles.statusReadOnly}
      style={status ? { color: status.color } : undefined}
      title={status?.name}
      aria-label={status ? `Status: ${status.name}` : 'No status'}
    >
      {status
        ? <StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} filled />
        : <span className={styles.statusReadOnlyEmpty} aria-hidden="true" />}
    </span>
  )
})

// ─── Composed default — people → dates → follow-up → status ─────────────────

interface TaskPillBarProps extends PillCommon {
  todo: PersistedTodoItem
  /** Pre-resolved people assignment for this todo. */
  people: readonly Person[]
  /** Pre-resolved status (or undefined). */
  status?: Status
  today: Date

  /** The due date as `Oct 20` (default) or `10/20`. */
  dateFormat?: 'short' | 'numeric'
  /** The follow-up pill as just its flag. */
  followupFlagOnly?: boolean
  /** Hide the status indicator entirely — `MobileTaskRow` renders status
   * outside the metaRow so it passes `false`. */
  showStatus?: boolean

  deadlineIntensity?: number

  peopleAnchorRef?: Ref<HTMLDivElement>
  followupAnchorRef?: Ref<HTMLButtonElement>
  statusAnchorRef?: Ref<HTMLDivElement>
  /** Follow-up popover is open — draws the pill's open ring. */
  followupOpen?: boolean

  /** Mark the read-only wrapper `aria-hidden="true"` — used by SearchResultRow
   * where the surrounding `<button>` carries the canonical text and the pills
   * are decorative. Has no effect when `interactive=true`. */
  ariaHidden?: boolean

  onPeopleClick?: (e: MouseEvent) => void
  onPersonContextMenu?: (e: MouseEvent, person: Person) => void
  onDeadlineClick?: (e: MouseEvent) => void
  onDeadlineClear?: (e: MouseEvent) => void
  onFollowupClick?: (e: MouseEvent) => void
  onFollowupClear?: (e: MouseEvent) => void
  onStatusClick?: (e: MouseEvent) => void
}

export const TaskPillBar = memo(function TaskPillBar({
  todo, people, status, today,
  interactive = true, compact = false, density = 'default',
  dateFormat = 'short', followupFlagOnly = false, showStatus = true,
  deadlineIntensity,
  peopleAnchorRef, followupAnchorRef, statusAnchorRef,
  followupOpen, ariaHidden,
  onPeopleClick, onPersonContextMenu,
  onDeadlineClick, onDeadlineClear,
  onFollowupClick, onFollowupClear, onStatusClick,
}: TaskPillBarProps) {
  // For interactive surfaces the chips ARE the click targets, so the bar
  // emits a fragment and the surface owns its own flex container. For
  // read-only surfaces we wrap with a `<span>` so `pointer-events: none`
  // applies consistently.
  const parts = (
    <>
      <TaskPillPeople
        people={people}
        interactive={interactive}
        compact={compact}
        density={density}
        anchorRef={peopleAnchorRef}
        onPeopleClick={onPeopleClick}
        onPersonContextMenu={onPersonContextMenu}
      />
      <TaskPillDates
        todo={todo}
        today={today}
        interactive={interactive}
        compact={compact}
        dateFormat={dateFormat}
        deadlineIntensity={deadlineIntensity}
        onDeadlineClick={onDeadlineClick}
        onDeadlineClear={onDeadlineClear}
      />
      <TaskPillFollowup
        todo={todo}
        today={today}
        interactive={interactive}
        compact={compact}
        anchorRef={followupAnchorRef}
        open={followupOpen}
        onFollowupClick={onFollowupClick}
        onFollowupClear={onFollowupClear}
        flagOnly={followupFlagOnly}
      />
      {showStatus && (
        <TaskPillStatus
          status={status}
          interactive={interactive}
          anchorRef={statusAnchorRef}
          onStatusClick={onStatusClick}
        />
      )}
    </>
  )

  if (!interactive) {
    return (
      <span
        className={styles.barReadOnly}
        aria-hidden={ariaHidden ? 'true' : undefined}
      >
        {parts}
      </span>
    )
  }
  return parts
})
