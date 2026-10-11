import { memo } from 'react'
import type { CSSProperties, MouseEvent, Ref } from 'react'
import { type PersistedTodoItem, type Person, type Org, type Status, DEFAULT_STATUS_ICON } from '../../models'
import { formatDateShort } from '../../utils/date'
import { isDeadlinePast } from '../../utils/effective-date'
import { followupPillLabel, followupTooltip, isFollowupOverdue } from '../../utils/followup'
import { startOfDay } from '../../utils/date'
import { FollowupFlagIcon } from './FollowupIcons'
import { StatusIcon } from './StatusIcon'
import { AvatarStack } from './AvatarStack'
import styles from './TaskPillBar.module.css'

/**
 * Shared task-pill bar — replaces the parallel due-date /
 * people / org / status chip implementations that lived inside
 * `TaskRow` / `MobileTaskRow` / `TopBar`'s `SearchResultPills` /
 * canvas calendar `EventRow` (ui-consistency-2026-04-25 P2).
 *
 * Tags: this primitive does NOT render tag chips. Tag display is the
 * separate `TagChipSelector` shared component, mounted by `TaskRow` and
 * `MobileTaskRow` adjacent to (not inside) the pill bar — adding tags here
 * would force every consumer of `TaskPillBar` (search dropdown, calendar
 * `EventRow`, etc.) to thread tags they don't render.
 *
 * Perf — the consumer pre-resolves people / orgs / status and threads
 * them through; this primitive does NOT subscribe to assignment stores.
 * For very dense surfaces (the search dropdown), pass `personColorContext`
 * to let `AvatarStack` skip its own `useOrgStore` subscription too.
 *
 * Composition — `<TaskPillBar>` is the default composed bar (people →
 * dates → follow-up → status, the layout used by `TaskRow` / `MobileTaskRow` /
 * `SearchResultRow`). Surfaces with a different layout (calendar
 * `EventRow` puts dates before the title) compose `<TaskPillPeople>`,
 * `<TaskPillDates>`, `<TaskPillStatus>` directly.
 */

// ─── Shared types ────────────────────────────────────────────────────────────

interface PillCommon {
  /** When false, the part renders as non-interactive `<span>`s — used
   * inside surfaces whose row IS the click target (`SearchResultRow` and
   * `EventRow`). */
  interactive?: boolean
  /** Compact = canvas calendar strip's icon-only date markers + smaller
   * avatars. */
  compact?: boolean
  /** Smaller avatars even when `compact` is false (mobile). */
  density?: 'default' | 'small'
  /** Hyperscale opt-out: when provided, AvatarStack uses these instead
   * of subscribing to org-store. Used by the search dropdown to keep
   * per-row subscriptions bounded. */
  personColorContext?: { personOrgMap: Map<number, number[]>; orgs: Org[] }
}

interface TaskPillPeopleProps extends PillCommon {
  people: readonly Person[]
  orgs: readonly Org[]
  anchorRef?: Ref<HTMLDivElement>
  onPeopleClick?: (e: MouseEvent) => void
  onPersonContextMenu?: (e: MouseEvent, person: Person) => void
  onOrgContextMenu?: (e: MouseEvent, org: Org) => void
}

interface TaskPillDatesProps extends PillCommon {
  todo: PersistedTodoItem
  today: Date
  /** `'stack'` = TaskRow's vertical date column. `'inline'` = horizontal
   * row (default). */
  layout?: 'inline' | 'stack'
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
}

interface TaskPillStatusProps extends PillCommon {
  status?: Status
  anchorRef?: Ref<HTMLDivElement>
  onStatusClick?: (e: MouseEvent) => void
}

// ─── People + orgs ────────────────────────────────────────────────────────────

export const TaskPillPeople = memo(function TaskPillPeople({
  people, orgs, interactive = true, compact = false, density = 'default',
  personColorContext, anchorRef, onPeopleClick, onPersonContextMenu, onOrgContextMenu,
}: TaskPillPeopleProps) {
  if (people.length === 0 && orgs.length === 0) return null
  const avatarSize = (compact || density === 'small') ? 'sm' : 'md'
  return (
    <div ref={anchorRef} className={styles.peopleGroup}>
      {people.length > 0 && (
        <AvatarStack
          people={[...people]}
          max={compact ? 2 : 3}
          size={avatarSize}
          readOnly={!interactive}
          onClick={interactive ? onPeopleClick : undefined}
          onPersonContextMenu={interactive && onPersonContextMenu
            ? (e, p) => onPersonContextMenu(e, p as Person)
            : undefined}
          colorContext={personColorContext}
        />
      )}
      {!compact && orgs.length > 0 && (
        <AvatarStack
          people={[...orgs]}
          max={3}
          size={avatarSize}
          variant="hollow"
          readOnly={!interactive}
          onClick={interactive ? onPeopleClick : undefined}
          onPersonContextMenu={interactive && onOrgContextMenu
            ? (e, o) => onOrgContextMenu(e, o as Org)
            : undefined}
          colorContext={personColorContext}
        />
      )}
    </div>
  )
})

// ─── Dates ────────────────────────────────────────────────────────────────────

export const TaskPillDates = memo(function TaskPillDates({
  todo, today, interactive = true, compact = false,
  layout = 'inline', deadlineIntensity,
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
        title={deadlinePast ? 'Due date passed — click to change' : 'Due — click to change'}
        aria-label="Edit due date"
      >
        <StatusIcon icon="clock" />
        {formatDateShort(todo.dueDate!)}
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
        {formatDateShort(todo.dueDate!)}
        {todo.recurrenceRule && (
          <span className={styles.recurrenceIndicator} title={`Repeats ${todo.recurrenceRule.type}`}>
            &#x21bb;
          </span>
        )}
      </span>
    )
  )

  return layout === 'stack' ? (
    <div className={styles.dateStack}>
      {deadlineChip}
    </div>
  ) : (
    <div className={styles.dateInline}>
      {deadlineChip}
    </div>
  )
})

// ─── Follow-up ────────────────────────────────────────────────────────────────

export const TaskPillFollowup = memo(function TaskPillFollowup({
  todo, today, interactive = true, compact = false, anchorRef, open = false,
  onFollowupClick, onFollowupClear,
}: TaskPillFollowupProps) {
  if (!todo.nextFollowupAt || compact) return null
  const overdue = isFollowupOverdue(todo, today)
  const isToday = !todo.isCompleted
    && startOfDay(new Date(todo.nextFollowupAt)).getTime() === startOfDay(today).getTime()
  const showClear = interactive && !!onFollowupClear && !todo.isCompleted
  const cls = [
    styles.followupChip,
    overdue ? styles.followupChipOverdue : '',
    isToday ? styles.followupChipToday : '',
    showClear ? styles.followupChipWithClear : '',
    open ? styles.followupChipOpen : '',
  ].filter(Boolean).join(' ')
  const label = followupPillLabel(todo, today)
  const title = followupTooltip(todo, today)

  if (!interactive) {
    return (
      <span className={cls} title={title} data-followup-overdue={overdue ? 'true' : undefined}>
        <FollowupFlagIcon />
        {label}
      </span>
    )
  }
  return (
    <button
      ref={anchorRef}
      type="button"
      className={cls}
      onClick={onFollowupClick}
      title={title}
      aria-label={`Follow-up: ${label}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-followup-overdue={overdue ? 'true' : undefined}
    >
      <FollowupFlagIcon />
      {label}
      {showClear && (
        <span
          className={styles.followupClear}
          role="button"
          tabIndex={-1}
          aria-label="Clear follow-up"
          title="Clear follow-up"
          onClick={(e) => { e.stopPropagation(); onFollowupClear(e) }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          &times;
        </span>
      )}
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
  /** Pre-resolved org assignment for this todo. */
  orgs: readonly Org[]
  /** Pre-resolved status (or undefined). */
  status?: Status
  today: Date

  /** `'stack'` = TaskRow's vertical date column, `'inline'` (default) =
   * horizontal flow. */
  dateLayout?: 'inline' | 'stack'
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
  onOrgContextMenu?: (e: MouseEvent, org: Org) => void
  onDeadlineClick?: (e: MouseEvent) => void
  onDeadlineClear?: (e: MouseEvent) => void
  onFollowupClick?: (e: MouseEvent) => void
  onFollowupClear?: (e: MouseEvent) => void
  onStatusClick?: (e: MouseEvent) => void
}

export const TaskPillBar = memo(function TaskPillBar({
  todo, people, orgs, status, today,
  interactive = true, compact = false, density = 'default',
  dateLayout = 'inline', showStatus = true,
  deadlineIntensity, personColorContext,
  peopleAnchorRef, followupAnchorRef, statusAnchorRef,
  followupOpen, ariaHidden,
  onPeopleClick, onPersonContextMenu, onOrgContextMenu,
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
        orgs={orgs}
        interactive={interactive}
        compact={compact}
        density={density}
        personColorContext={personColorContext}
        anchorRef={peopleAnchorRef}
        onPeopleClick={onPeopleClick}
        onPersonContextMenu={onPersonContextMenu}
        onOrgContextMenu={onOrgContextMenu}
      />
      <TaskPillDates
        todo={todo}
        today={today}
        interactive={interactive}
        compact={compact}
        layout={dateLayout}
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
