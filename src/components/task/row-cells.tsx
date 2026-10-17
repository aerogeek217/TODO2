import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react'
import { type PersistedTodoItem, type Person, type Status, type Tag, DEFAULT_STATUS_ICON } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useSettingsStore } from '../../stores/settings-store'
import { formatDateNumeric, startOfDay, toDateInputValue } from '../../utils/date'
import { dateIntensity, daysUntil, dueTooltip, isDeadlinePast } from '../../utils/effective-date'
import { followupPillLabel, followupTooltip, formatFollowupDate, isFollowupOverdue } from '../../utils/followup'
import { markerSummary } from '../../utils/markers'
import { peopleFit, tagsFit } from '../../utils/task-row-columns'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { MarkerDots } from '../shared/MarkerDots'
import { StatusIcon } from '../shared/StatusIcon'
import { useTooltip } from '../shared/use-tooltip'
import { tagTextWidth } from './text-width'
import styles from './TaskRow.module.css'

/*
 * The desktop task row's cells: one per column, each a button that opens its
 * picker anchored to the cell (filled = edit, empty = add). An empty cell's
 * placeholder is drawn at opacity 0 and shown on row hover / focus / while a
 * picker is open — opacity only, so nothing moves.
 *
 * Every cell carries `data-row-cell`: the row's double-click (open the
 * editor) leaves cells alone, and a cell ignores the second click of a
 * double-click, so a double-click opens its picker once.
 */

/** A cell's click: opens on the first click of a run only (a double-click opens once). */
function cellClick(open: (e: MouseEvent) => void) {
  return (e: MouseEvent) => {
    e.stopPropagation()
    if (e.detail > 1) return
    open(e)
  }
}

/** The notes icon. */
export function NotesGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 1.5h6.5L13 5v9a0.5 0.5 0 0 1-0.5 0.5h-9.5A0.5 0.5 0 0 1 2.5 14V2a0.5 0.5 0 0 1 0.5-0.5Z" />
      <path d="M9.5 1.5V5H13" />
      <path d="M5 8h6M5 11h4" />
    </svg>
  )
}

/** A placeholder: hidden (opacity 0) until the row is hovered / focused / has a picker open. */
function Placeholder({ children }: { children: ReactNode }) {
  return <span className={styles.ph} aria-hidden="true">{children}</span>
}

// ── Marker gutter ───────────────────────────────────────────────────────────

/** Focus · Urgent · Important as three dots; one button that opens the markers menu. */
export function MarkerGutter({ todo, today, anchorRef, open, onToggle }: {
  todo: PersistedTodoItem
  today: Date
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: () => void
}) {
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const summary = markerSummary(todo, today, range)
  const { triggerProps, tooltip } = useTooltip(summary.tooltip)
  return (
    <button
      ref={anchorRef}
      type="button"
      className={`${styles.gutter} ${open ? styles.cellOpen : ''}`}
      aria-label={summary.label}
      aria-haspopup="menu"
      aria-expanded={open}
      data-row-cell="markers"
      onClick={cellClick(onToggle)}
      {...triggerProps}
    >
      <MarkerDots summary={summary} dim={todo.isCompleted} />
      {tooltip}
    </button>
  )
}

/** The gutter's look on a row that can't open the menu (the drag overlay's copy). */
export function MarkerGutterStatic({ todo, today }: { todo: PersistedTodoItem; today: Date }) {
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const summary = markerSummary(todo, today, range)
  return (
    <span className={styles.gutter} role="img" aria-label={summary.label}>
      <MarkerDots summary={summary} dim={todo.isCompleted} />
    </span>
  )
}

// ── Notes ───────────────────────────────────────────────────────────────────

export function NotesCell({ hasNotes, anchorRef, open, onToggle }: {
  hasNotes: boolean
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: (e: MouseEvent) => void
}) {
  return (
    <button
      ref={anchorRef}
      type="button"
      className={`${styles.cell} ${styles.cellCenter} ${open ? styles.cellOpen : ''}`}
      aria-label={hasNotes ? 'Edit notes' : 'Add notes'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-row-cell="notes"
      onClick={cellClick(onToggle)}
    >
      {hasNotes ? <NotesGlyph /> : <Placeholder><NotesGlyph /></Placeholder>}
    </button>
  )
}

// ── People ──────────────────────────────────────────────────────────────────

export function PeopleCell({ people, track, anchorRef, open, onToggle, onPersonContextMenu }: {
  people: readonly Person[]
  /** The people track's width, px. */
  track: number
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onToggle: () => void
  /** Right-click on one avatar. */
  onPersonContextMenu?: (e: MouseEvent, person: Person) => void
}) {
  const names = people.map((p) => p.name)
  const { triggerProps, tooltip } = useTooltip(names.length > 0 ? names.join(', ') : null)
  const fit = peopleFit(people.length, track)
  const shown = people.slice(0, fit.shown)
  return (
    <button
      ref={anchorRef as RefObject<HTMLButtonElement | null>}
      type="button"
      className={`${styles.cell} ${open ? styles.cellOpen : ''}`}
      aria-label={names.length > 0 ? `People: ${names.join(', ')}` : 'Assign people'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-row-cell="people"
      onClick={cellClick(onToggle)}
      {...triggerProps}
    >
      {people.length === 0 ? <Placeholder>@</Placeholder> : (
        <>
          <span className={styles.avatars}>
            {shown.map((p) => (
              <span
                key={p.id}
                className={styles.avatar}
                style={{ background: p.color || NEUTRAL_PERSON_COLOR }}
                data-person-avatar={p.name}
                onContextMenu={onPersonContextMenu ? (e) => onPersonContextMenu(e, p) : undefined}
              >
                {p.initials || p.name.slice(0, 2).toUpperCase()}
              </span>
            ))}
            {fit.badge && <span className={styles.avatarBadge}>+{fit.more}</span>}
          </span>
          {fit.more > 0 && !fit.badge && <span className={styles.more}>+{fit.more}</span>}
        </>
      )}
      {tooltip}
    </button>
  )
}

// ── Tags ────────────────────────────────────────────────────────────────────

export function TagsCell({ tags, track, anchorRef, open, onToggle, onTagContextMenu }: {
  tags: readonly Tag[]
  /** The tags track's width, px. */
  track: number
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: () => void
  /** Right-click on one tag name; absent = the row's own context menu. */
  onTagContextMenu?: (e: MouseEvent, tag: Tag) => void
}) {
  const labels = tags.map((t) => `#${t.name}`)
  const { triggerProps, tooltip } = useTooltip(labels.length > 0 ? labels.join(' ') : null)
  const fit = tagsFit(labels.map(tagTextWidth), track, (n) => tagTextWidth(`+${n}`))
  const shown = tags.slice(0, fit.shown)
  return (
    <button
      ref={anchorRef}
      type="button"
      className={`${styles.cell} ${open ? styles.cellOpen : ''}`}
      aria-label={tags.length > 0 ? `Tags: ${tags.map((t) => t.name).join(', ')}` : 'Add tag'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-row-cell="tags"
      onClick={cellClick(onToggle)}
      {...triggerProps}
    >
      {tags.length === 0 ? <Placeholder>#</Placeholder> : (
        <>
          {shown.map((t, i) => (
            <span
              key={t.id}
              className={`${styles.tag} ${i === shown.length - 1 ? styles.tagLast : ''}`}
              style={t.color ? { color: t.color } : undefined}
              data-tag-name={t.name}
              onContextMenu={onTagContextMenu ? (e) => onTagContextMenu(e, t) : undefined}
            >
              #{t.name}
            </span>
          ))}
          {fit.more > 0 && <span className={styles.more}>+{fit.more}</span>}
        </>
      )}
      {tooltip}
    </button>
  )
}

// ── Due ─────────────────────────────────────────────────────────────────────

export function DueCell({ todo, today, inputRef, onOpen, onClear, onInputChange }: {
  todo: PersistedTodoItem
  today: Date
  inputRef: RefObject<HTMLInputElement | null>
  onOpen: () => void
  onClear: () => void
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  const due = todo.dueDate
  const { triggerProps, tooltip } = useTooltip(due ? dueTooltip(todo, today) : null)
  const past = isDeadlinePast(todo, today)
  const style = due && !past
    ? ({ '--date-intensity': dateIntensity(daysUntil(due, today)) } as CSSProperties)
    : undefined
  return (
    <div className={styles.dueCell}>
      <button
        type="button"
        className={`${styles.cell} ${styles.due} ${past ? styles.duePast : ''}`}
        style={style}
        aria-label={due ? `Due ${formatFollowupDate(due, today)}` : 'Set due date'}
        data-row-cell="due"
        data-due-past={past || undefined}
        onClick={cellClick(onOpen)}
        {...triggerProps}
      >
        {due ? (
          <>
            <span>{formatDateNumeric(due)}</span>
            {todo.recurrenceRule && <span className={styles.repeat} aria-hidden="true">&#x21bb;</span>}
          </>
        ) : (
          <Placeholder><StatusIcon icon="calendar" /></Placeholder>
        )}
        {tooltip}
      </button>
      {due && (
        <button
          type="button"
          className={styles.dueClear}
          tabIndex={-1}
          aria-label="Clear due date"
          data-row-cell="due-clear"
          onClick={cellClick(onClear)}
        >
          &times;
        </button>
      )}
      <input
        ref={inputRef}
        type="date"
        className={styles.hiddenDateInput}
        value={due ? toDateInputValue(due) : ''}
        onChange={onInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}

// ── Follow-up ───────────────────────────────────────────────────────────────

export function FollowupCell({ todo, today, anchorRef, open, onToggle }: {
  todo: PersistedTodoItem
  today: Date
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: (e: MouseEvent) => void
}) {
  const next = todo.nextFollowupAt
  const { triggerProps, tooltip } = useTooltip(next ? followupTooltip(todo, today) : null)
  const late = isFollowupOverdue(todo, today)
  const isToday = !!next && !todo.isCompleted && startOfDay(new Date(next)).getTime() === startOfDay(today).getTime()
  const state = !next ? undefined : late ? 'late' : isToday ? 'today' : 'upcoming'
  return (
    <button
      ref={anchorRef}
      type="button"
      className={`${styles.cell} ${styles.cellCenter} ${styles.followup} ${open ? styles.cellOpen : ''}`}
      aria-label={next ? `Follow-up: ${followupPillLabel(todo, today)}${late ? ', late' : ''}` : 'Set follow-up'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-row-cell="followup"
      data-followup={state}
      onClick={cellClick(onToggle)}
      {...triggerProps}
    >
      {next ? <FollowupFlagIcon filled={state !== 'upcoming'} /> : <Placeholder><FollowupFlagIcon /></Placeholder>}
      {tooltip}
    </button>
  )
}

// ── Status ──────────────────────────────────────────────────────────────────

export function StatusCell({ status, anchorRef, open, onToggle }: {
  status: Status | undefined
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      ref={anchorRef}
      type="button"
      className={`${styles.cell} ${styles.cellCenter} ${styles.status} ${open ? styles.cellOpen : ''}`}
      style={status ? { color: status.color } : undefined}
      aria-label={status ? `Status: ${status.name}` : 'Set status'}
      aria-haspopup="menu"
      aria-expanded={open}
      data-row-cell="status"
      onClick={cellClick(onToggle)}
    >
      {status
        ? <StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} filled />
        : <Placeholder><span className={styles.statusDot} /></Placeholder>}
    </button>
  )
}
