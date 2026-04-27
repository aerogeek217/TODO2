import { memo } from 'react'
import type { CSSProperties, MouseEvent, Ref } from 'react'
import type { PersistedTodoItem, Person, Org, Status } from '../../models'
import { formatDateShort } from '../../utils/date'
import { scheduledLabel, isScheduledPast, isDeadlinePast } from '../../utils/effective-date'
import { StatusIcon } from './StatusIcon'
import { AvatarStack } from './AvatarStack'
import styles from './TaskPillBar.module.css'

/**
 * Shared task-pill bar — replaces the parallel scheduled / deadline /
 * people / org / status chip implementations that lived inside
 * `TaskRow` / `MobileTaskRow` / `TopBar`'s `SearchResultPills` /
 * canvas calendar `EventRow` (ui-consistency-2026-04-25 P2).
 *
 * Tag-display rule: tags are intentionally never rendered here. Tags
 * power search / filter / grouping only — they never become a row chip.
 *
 * Perf — the consumer pre-resolves people / orgs / status and threads
 * them through; this primitive does NOT subscribe to assignment stores.
 * For very dense surfaces (the search dropdown), pass `personColorContext`
 * to let `AvatarStack` skip its own `useOrgStore` subscription too.
 *
 * Composition — `<TaskPillBar>` is the default composed bar (people →
 * dates → status, the layout used by `TaskRow` / `MobileTaskRow` /
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
  weekStartsOn: 0 | 1
  /** `'stack'` = TaskRow's vertical date column (scheduled-on-top,
   * deadline below). `'inline'` = horizontal row (default). */
  layout?: 'inline' | 'stack'
  scheduledIntensity?: number
  deadlineIntensity?: number
  scheduledAnchorRef?: Ref<HTMLButtonElement>
  onScheduledClick?: (e: MouseEvent) => void
  onDeadlineClick?: (e: MouseEvent) => void
  /** When provided AND interactive=true, the deadline chip shows an
   * × clear button on hover. */
  onDeadlineClear?: (e: MouseEvent) => void
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
  todo, today, weekStartsOn, interactive = true, compact = false,
  layout = 'inline', scheduledIntensity, deadlineIntensity,
  scheduledAnchorRef, onScheduledClick, onDeadlineClick, onDeadlineClear,
}: TaskPillDatesProps) {
  const hasScheduled = !!todo.scheduledDate
  const hasDeadline = !!todo.dueDate
  if (!hasScheduled && !hasDeadline) return null

  const scheduledPast = isScheduledPast({ scheduledDate: todo.scheduledDate }, today, weekStartsOn)
  const deadlinePast = isDeadlinePast({ dueDate: todo.dueDate }, today)

  if (compact) {
    return (
      <>
        {hasDeadline && (
          <span className={styles.markerDeadline} aria-label="Deadline">
            <StatusIcon icon="clock" />
          </span>
        )}
        {hasScheduled && (
          <span className={styles.markerScheduled} aria-label="Scheduled">
            <StatusIcon icon="calendar" />
          </span>
        )}
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

  const scheduledChipStyle: CSSProperties | undefined =
    scheduledIntensity != null
      ? ({ '--date-intensity': scheduledIntensity } as CSSProperties)
      : undefined
  const deadlineChipStyle: CSSProperties | undefined =
    deadlineIntensity != null
      ? ({ '--date-intensity': deadlineIntensity } as CSSProperties)
      : undefined

  const scheduledChip = hasScheduled && (
    interactive ? (
      <button
        ref={scheduledAnchorRef}
        type="button"
        className={`${styles.scheduledChip} ${scheduledPast ? styles.scheduledChipPast : ''}`}
        style={scheduledChipStyle}
        onClick={onScheduledClick}
        title={scheduledPast ? 'Scheduled date has passed' : 'Scheduled'}
        aria-label="Edit scheduled"
      >
        <StatusIcon icon="calendar" />
        {scheduledLabel(todo.scheduledDate!, today)}
      </button>
    ) : (
      <span
        className={`${styles.scheduledChip} ${scheduledPast ? styles.scheduledChipPast : ''}`}
        style={scheduledChipStyle}
        title={scheduledPast ? 'Scheduled date has passed' : 'Scheduled'}
      >
        <StatusIcon icon="calendar" />
        {scheduledLabel(todo.scheduledDate!, today)}
      </span>
    )
  )

  const deadlineSecondary = hasDeadline && hasScheduled && layout === 'stack'
  const deadlineChipClass = `${styles.deadlineChip} ${deadlinePast ? styles.deadlineChipPast : ''} ${deadlineSecondary ? styles.dateStackSecondary : ''}`
  const deadlineChip = hasDeadline && (
    interactive ? (
      <button
        type="button"
        className={deadlineChipClass}
        style={deadlineChipStyle}
        onClick={onDeadlineClick}
        title={deadlinePast ? 'Deadline passed — click to change' : 'Deadline — click to change'}
        aria-label="Edit deadline"
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
            aria-label="Clear deadline"
            title="Clear deadline"
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
        title={deadlinePast ? 'Deadline passed' : 'Deadline'}
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
      {scheduledChip}
      {deadlineChip}
    </div>
  ) : (
    <div className={styles.dateInline}>
      {scheduledChip}
      {deadlineChip}
    </div>
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
            ? <StatusIcon icon={status.icon || 'circle'} filled />
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
        ? <StatusIcon icon={status.icon || 'circle'} filled />
        : <span className={styles.statusReadOnlyEmpty} aria-hidden="true" />}
    </span>
  )
})

// ─── Composed default — people → dates → status ──────────────────────────────

interface TaskPillBarProps extends PillCommon {
  todo: PersistedTodoItem
  /** Pre-resolved people assignment for this todo. */
  people: readonly Person[]
  /** Pre-resolved org assignment for this todo. */
  orgs: readonly Org[]
  /** Pre-resolved status (or undefined). */
  status?: Status
  today: Date
  weekStartsOn: 0 | 1

  /** `'stack'` = TaskRow's vertical date column, `'inline'` (default) =
   * horizontal flow. */
  dateLayout?: 'inline' | 'stack'
  /** Hide the status indicator entirely — `MobileTaskRow` renders status
   * outside the metaRow so it passes `false`. */
  showStatus?: boolean

  scheduledIntensity?: number
  deadlineIntensity?: number

  peopleAnchorRef?: Ref<HTMLDivElement>
  scheduledAnchorRef?: Ref<HTMLButtonElement>
  statusAnchorRef?: Ref<HTMLDivElement>

  /** Mark the read-only wrapper `aria-hidden="true"` — used by SearchResultRow
   * where the surrounding `<button>` carries the canonical text and the pills
   * are decorative. Has no effect when `interactive=true`. */
  ariaHidden?: boolean

  onPeopleClick?: (e: MouseEvent) => void
  onPersonContextMenu?: (e: MouseEvent, person: Person) => void
  onOrgContextMenu?: (e: MouseEvent, org: Org) => void
  onScheduledClick?: (e: MouseEvent) => void
  onDeadlineClick?: (e: MouseEvent) => void
  onDeadlineClear?: (e: MouseEvent) => void
  onStatusClick?: (e: MouseEvent) => void
}

export const TaskPillBar = memo(function TaskPillBar({
  todo, people, orgs, status, today, weekStartsOn,
  interactive = true, compact = false, density = 'default',
  dateLayout = 'inline', showStatus = true,
  scheduledIntensity, deadlineIntensity, personColorContext,
  peopleAnchorRef, scheduledAnchorRef, statusAnchorRef,
  ariaHidden,
  onPeopleClick, onPersonContextMenu, onOrgContextMenu,
  onScheduledClick, onDeadlineClick, onDeadlineClear, onStatusClick,
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
        weekStartsOn={weekStartsOn}
        interactive={interactive}
        compact={compact}
        layout={dateLayout}
        scheduledIntensity={scheduledIntensity}
        deadlineIntensity={deadlineIntensity}
        scheduledAnchorRef={scheduledAnchorRef}
        onScheduledClick={onScheduledClick}
        onDeadlineClick={onDeadlineClick}
        onDeadlineClear={onDeadlineClear}
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
