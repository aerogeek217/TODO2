import { useMemo, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { type PersistedTodoItem, type Person, type Status, type Tag, DEFAULT_STATUS_ICON } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useSettingsStore } from '../../stores/settings-store'
import { formatDateNumeric, startOfDay, toDateInputValue } from '../../utils/date'
import { dateIntensity, daysUntil, dueTooltip, isDeadlinePast } from '../../utils/effective-date'
import { followupPillLabel, followupTooltip, formatFollowupDate, isFollowupOverdue } from '../../utils/followup'
import { markerSummary } from '../../utils/markers'
import { progressNotesPreview } from '../../utils/notes-preview'
import { datesParts, peopleFit, tagsFit, type PeopleFit } from '../../utils/task-row-columns'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { RepeatIcon } from '../shared/icons'
import { ClockIcon } from '../shared/MarkerIcons'
import { MarkerDots } from '../shared/MarkerDots'
import { StatusIcon } from '../shared/StatusIcon'
import { useTooltip } from '../shared/use-tooltip'
import { tagTextWidth } from './text-width'
import { useTaskRowColumn } from './task-row-grid-context'
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

/**
 * The notes cell: the task's Progress text and its Notes. The glyph when the
 * task has either, else the placeholder; hover / keyboard focus previews both
 * (read-only, the tooltip); a click (or Enter / Space) opens the popover that
 * edits them.
 */
export function NotesCell({ progress, notes, anchorRef, open, onToggle }: {
  progress: string | undefined
  notes: string | undefined
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: (e: MouseEvent) => void
}) {
  const preview = useMemo(() => progressNotesPreview(progress, notes), [progress, notes])
  const filled = preview !== null
  // No preview over the open popover.
  const { triggerProps, tooltip } = useTooltip(open ? null : preview?.text, { labelLines: preview?.labelLines })
  return (
    <button
      ref={anchorRef}
      type="button"
      className={`${styles.cell} ${styles.cellCenter} ${open ? styles.cellOpen : ''}`}
      aria-label={filled ? 'Edit progress and notes' : 'Add progress or notes'}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-row-cell="notes"
      onClick={cellClick(onToggle)}
      {...triggerProps}
    >
      {filled ? <NotesGlyph /> : <Placeholder><NotesGlyph /></Placeholder>}
      {tooltip}
    </button>
  )
}

// ── People ──────────────────────────────────────────────────────────────────

/** How `count` avatars fit the row list's people column, read so the cell re-renders only when the fit changes. */
function usePeopleFit(count: number): PeopleFit {
  // One number per fit: avatars shown, doubled, plus 1 for the corner badge.
  const key = useTaskRowColumn((c) => {
    const fit = peopleFit(count, c.people)
    return fit.shown * 2 + (fit.badge ? 1 : 0)
  })
  const shown = Math.floor(key / 2)
  return { shown, more: count - shown, badge: key % 2 === 1 }
}

export function PeopleCell({ people, anchorRef, open, onToggle, onPersonContextMenu, onCellContextMenu }: {
  people: readonly Person[]
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onToggle: () => void
  /** Right-click on one avatar. */
  onPersonContextMenu?: (e: MouseEvent, person: Person) => void
  /** A context menu on the cell itself (Shift+F10 / the menu key while it has focus, or a right-click beside the avatars). */
  onCellContextMenu?: (e: MouseEvent) => void
}) {
  const names = people.map((p) => p.name)
  const { triggerProps, tooltip } = useTooltip(names.length > 0 ? names.join(', ') : null)
  const fit = usePeopleFit(people.length)
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
      onContextMenu={onCellContextMenu}
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

export function TagsCell({ tags, anchorRef, open, onToggle, onTagContextMenu, onCellContextMenu }: {
  tags: readonly Tag[]
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: () => void
  /** Right-click on one tag name; absent = the row's own context menu. */
  onTagContextMenu?: (e: MouseEvent, tag: Tag) => void
  /** A context menu on the cell itself (see `PeopleCell`). */
  onCellContextMenu?: (e: MouseEvent) => void
}) {
  const labels = tags.map((t) => `#${t.name}`)
  const { triggerProps, tooltip } = useTooltip(labels.length > 0 ? labels.join(' ') : null)
  // The tags shown in the row list's tags column: the cell re-renders only when that count changes.
  const shownCount = useTaskRowColumn((c) => tagsFit(labels.map(tagTextWidth), c.tags, (n) => tagTextWidth(`+${n}`)).shown)
  const fit = { shown: shownCount, more: tags.length - shownCount }
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
      onContextMenu={onCellContextMenu}
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

// ── Dates ───────────────────────────────────────────────────────────────────

/**
 * The dates cell: the due date (a clock — the repeat glyph for a repeating
 * task — then `MM/DD`) and the next follow-up (the flag, then `MM/DD`), two
 * parts with their own click target, picker, tooltip and colours. The list's
 * width sets which dates show beside their icons (`TaskRowColumns.datesTier`;
 * the follow-up's date goes first, then the due date's — the tooltip still
 * has them); the cell re-renders only when that changes. An absent date is
 * its icon as the placeholder. A part showing its date gets a clear × over
 * its right end on hover.
 */
export function DatesCell({
  todo, today, deadlineInputRef, onOpenDue, onClearDue, onDueInputChange,
  followupAnchorRef, followupOpen, onToggleFollowup, onClearFollowup,
}: {
  todo: PersistedTodoItem
  today: Date
  deadlineInputRef: RefObject<HTMLInputElement | null>
  onOpenDue: () => void
  onClearDue: () => void
  onDueInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  followupAnchorRef: RefObject<HTMLButtonElement | null>
  followupOpen: boolean
  onToggleFollowup: (e: MouseEvent) => void
  onClearFollowup: () => void
}) {
  const tier = useTaskRowColumn((c) => c.datesTier)
  const parts = datesParts(tier)
  return (
    <div className={styles.datesCell} style={{ gap: parts.gap }} data-row-cell="dates" data-dates-tier={tier}>
      <DuePart
        todo={todo}
        today={today}
        width={parts.due}
        showDate={tier !== 'icons'}
        inputRef={deadlineInputRef}
        onOpen={onOpenDue}
        onClear={onClearDue}
        onInputChange={onDueInputChange}
      />
      <FollowupPart
        todo={todo}
        today={today}
        width={parts.followup}
        showDate={tier === 'both'}
        anchorRef={followupAnchorRef}
        open={followupOpen}
        onToggle={onToggleFollowup}
        onClear={onClearFollowup}
      />
    </div>
  )
}

/** A date part's clear ×: over the part's right end on hover — takes no width. */
function DateClear({ label, cell, onClear }: { label: string; cell: string; onClear: () => void }) {
  return (
    <button
      type="button"
      className={styles.dateClear}
      tabIndex={-1}
      aria-label={label}
      data-row-cell={cell}
      onClick={cellClick(onClear)}
    >
      &times;
    </button>
  )
}

function DuePart({ todo, today, width, showDate, inputRef, onOpen, onClear, onInputChange }: {
  todo: PersistedTodoItem
  today: Date
  width: number
  showDate: boolean
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
  const icon = todo.recurrenceRule ? <RepeatIcon size={12} /> : <ClockIcon />
  return (
    <span className={styles.datePart} style={{ width }}>
      <button
        type="button"
        className={`${styles.cell} ${styles.datePartButton} ${showDate ? '' : styles.cellCenter} ${styles.due} ${past ? styles.duePast : ''}`}
        style={style}
        aria-label={due ? `Due ${formatFollowupDate(due, today)}` : 'Set due date'}
        data-row-cell="due"
        data-due-past={past || undefined}
        onClick={cellClick(onOpen)}
        {...triggerProps}
      >
        {due ? (
          <>
            {icon}
            {showDate && <span className={styles.dateText}>{formatDateNumeric(due)}</span>}
          </>
        ) : (
          <Placeholder><ClockIcon /></Placeholder>
        )}
        {tooltip}
      </button>
      {due && showDate && <DateClear label="Clear due date" cell="due-clear" onClear={onClear} />}
      <input
        ref={inputRef}
        type="date"
        className={styles.hiddenDateInput}
        value={due ? toDateInputValue(due) : ''}
        onChange={onInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </span>
  )
}

function FollowupPart({ todo, today, width, showDate, anchorRef, open, onToggle, onClear }: {
  todo: PersistedTodoItem
  today: Date
  width: number
  showDate: boolean
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: (e: MouseEvent) => void
  onClear: () => void
}) {
  const next = todo.nextFollowupAt
  const { triggerProps, tooltip } = useTooltip(next ? followupTooltip(todo, today) : null)
  const late = isFollowupOverdue(todo, today)
  const isToday = !!next && !todo.isCompleted && startOfDay(new Date(next)).getTime() === startOfDay(today).getTime()
  const state = !next ? undefined : late ? 'late' : isToday ? 'today' : 'upcoming'
  return (
    <span className={styles.datePart} style={{ width }}>
      <button
        ref={anchorRef}
        type="button"
        className={`${styles.cell} ${styles.datePartButton} ${showDate && next ? '' : styles.cellCenter} ${styles.followup} ${open ? styles.cellOpen : ''}`}
        aria-label={next ? `Follow-up: ${followupPillLabel(todo, today)}${late ? ', late' : ''}` : 'Set follow-up'}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-row-cell="followup"
        data-followup={state}
        onClick={cellClick(onToggle)}
        {...triggerProps}
      >
        {next ? (
          <>
            <FollowupFlagIcon filled={state !== 'upcoming'} />
            {showDate && <span className={styles.dateText}>{formatDateNumeric(next)}</span>}
          </>
        ) : (
          <Placeholder><FollowupFlagIcon /></Placeholder>
        )}
        {tooltip}
      </button>
      {next && showDate && <DateClear label="Clear follow-up" cell="followup-clear" onClear={onClear} />}
    </span>
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
