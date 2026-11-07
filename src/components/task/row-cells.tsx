import { useMemo, type CSSProperties, type InputHTMLAttributes, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { type PersistedTodoItem, type Person, type Status, type StatusUpdate, type Tag, DEFAULT_STATUS_ICON } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useSettingsStore } from '../../stores/settings-store'
import { formatRowDate, startOfDay, toDateInputValue } from '../../utils/date'
import { dueTooltip, isDeadlinePast } from '../../utils/effective-date'
import { isUrgentByDate } from '../../utils/urgency'
import { followupPillLabel, followupTooltip, formatFollowupDate, isFollowupOverdue } from '../../utils/followup'
import type { MarkerSummary } from '../../utils/markers'
import { statusNotesPreview } from '../../utils/notes-preview'
import { datesParts, peopleFit, tagsFit, TASK_ROW, type PeopleFit } from '../../utils/task-row-columns'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { FlagIcon, NotesIcon, RepeatIcon } from '../shared/icons'
import { ClockIcon } from '../shared/MarkerIcons'
import { PriorityRing } from '../shared/PriorityRing'
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
    <NotesIcon size={12} />
  )
}

/** A placeholder: hidden (opacity 0) until the row is hovered / focused / has a picker open. */
function Placeholder({ children }: { children: ReactNode }) {
  return <span className={styles.ph} aria-hidden="true">{children}</span>
}

// ── Marker gutter ───────────────────────────────────────────────────────────

/**
 * The priority menu's trigger (D25 B): a slim gutter before the checkbox,
 * empty at rest and a small flag while the row is hovered or focused or the
 * menu is open. The priority itself is the ring on the checkbox
 * (`RowCheckbox`, Focus under another ring its halo); the gutter carries
 * its name and tooltip.
 */
export function MarkerGutter({ summary, anchorRef, open, onToggle }: {
  summary: MarkerSummary
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: () => void
}) {
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
      <span className={styles.gutterFlag} aria-hidden="true" data-gutter-flag=""><FlagIcon size={10} /></span>
      {tooltip}
    </button>
  )
}

/** The gutter on a row that can't open the menu (the drag overlay's copy): its at-rest look (empty), named. */
export function MarkerGutterStatic({ summary }: { summary: MarkerSummary }) {
  return <span className={styles.gutter} role="img" aria-label={summary.label} />
}

/**
 * A row's checkbox with its check and its priority ring (D25 B), drawn over
 * the box: the check draws itself when the task is completed (D19); the ring
 * hides the box's own border while it shows.
 */
export function RowCheckbox({ summary, checked, className, ...input }: {
  summary: MarkerSummary
  checked: boolean
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'className'>) {
  return (
    <span className={styles.checkWrap}>
      <input type="checkbox" className={`${styles.checkbox} ${className ?? ''}`} checked={checked} data-row-cell="checkbox" {...input} />
      <svg className={styles.checkMark} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M3.5 8.5l3 3 6-7" pathLength={1} />
      </svg>
      <PriorityRing summary={summary} completed={checked} size={TASK_ROW.checkbox} />
    </span>
  )
}

// ── Notes ───────────────────────────────────────────────────────────────────

/**
 * The notes cell: the task's newest status update and its Notes. The glyph
 * when the task has either, else the placeholder; hover / keyboard focus
 * previews both (read-only, the tooltip); a click (or Enter / Space) opens
 * the popover that adds updates and edits the notes.
 */
export function NotesCell({ update, notes, anchorRef, open, onToggle }: {
  update: Pick<StatusUpdate, 'date' | 'text'> | undefined
  notes: string | undefined
  anchorRef: RefObject<HTMLButtonElement | null>
  open: boolean
  onToggle: (e: MouseEvent) => void
}) {
  const preview = useMemo(() => statusNotesPreview(update, notes), [update, notes])
  const filled = preview !== null
  // No preview over the open popover.
  const { triggerProps, tooltip } = useTooltip(open ? null : preview?.text, { labelLines: preview?.labelLines })
  return (
    <button
      ref={anchorRef}
      type="button"
      className={`${styles.cell} ${styles.cellCenter} ${open ? styles.cellOpen : ''}`}
      aria-label={filled ? 'Edit status and notes' : 'Add status or notes'}
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
                // Monochrome at rest; the person's colour while the row is hovered / focused / has a picker open.
                style={{ '--avatar-color': p.color || NEUTRAL_PERSON_COLOR } as CSSProperties}
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
 * The dates cell: the due date and the next follow-up as Settings ›
 * Appearance › Dates says (`formatRowDate`: `Today` / `Sat` / `11/20`, or
 * `MM/DD`; the aria-label and tooltip keep the full date), two parts
 * with their own click target, picker, tooltip and colours. A set date shows
 * its text alone (no clock or flag beside it; a repeating task's due date
 * keeps the repeat glyph before it); an absent date is its icon as the
 * placeholder. The details width (capped by the list's) sets which dates
 * show (`TaskRowColumns.datesTier`; the follow-up's date goes first, then
 * the due date's — a dropped date shows as its icon, the tooltip still has
 * it); the cell re-renders only when that changes, so a divider drag renders
 * it only as it crosses a tier. A part showing its date gets a clear × over
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
  // One tint step: muted until the date is inside the Settings "due soon" range (the one that makes a task urgent), then the deadline colour.
  const range = useSettingsStore((s) => s.urgentDueWithinDays)
  const soon = isUrgentByDate(todo, today, range)
  const repeats = todo.recurrenceRule != null
  // The date alone; the repeat glyph (smaller, with the padding given up) stays before a repeating task's date.
  const dateOnly = due && showDate
  const rowDates = useSettingsStore((s) => s.rowDates)
  const text = due ? formatRowDate(due, today, rowDates) : ''
  // Another year's MM/DD/YY takes the whole part: a repeating task's glyph gives way (its tooltip says it repeats).
  return (
    <span className={styles.datePart} style={{ width }}>
      <button
        type="button"
        className={`${styles.cell} ${styles.datePartButton} ${dateOnly ? '' : styles.cellCenter} ${dateOnly && repeats ? styles.dueRepeat : ''} ${styles.due} ${past ? styles.duePast : ''}`}
        aria-label={due ? `Due ${formatFollowupDate(due, today)}` : 'Set due date'}
        data-row-cell="due"
        data-due-soon={soon || undefined}
        data-due-past={past || undefined}
        onClick={cellClick(onOpen)}
        {...triggerProps}
      >
        {due ? (
          showDate ? (
            <>
              {repeats && <RepeatIcon size={10} />}
              <span className={styles.dateText}>{text}</span>
            </>
          ) : (
            repeats ? <RepeatIcon size={12} /> : <ClockIcon />
          )
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
  const rowDates = useSettingsStore((s) => s.rowDates)
  const text = next ? formatRowDate(next, today, rowDates) : ''
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
          showDate
            ? <span className={styles.dateText}>{text}</span>
            : <FollowupFlagIcon filled={state !== 'upcoming'} />
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

/** The status picker's list: No Status, then every status; a pick is the caller's (and closing). */
export function StatusMenu({ statuses, statusId, onPick }: {
  statuses: readonly Status[]
  statusId: number | undefined
  onPick: (statusId: number | undefined) => void
}) {
  return (
    <div className={styles.statusMenu}>
      <button
        className={`${styles.statusOption} ${!statusId ? styles.statusOptionActive : ''}`}
        onClick={(e) => { e.stopPropagation(); onPick(undefined) }}
      >
        <span className={styles.statusOptionDot} style={{ background: 'var(--color-text-muted)' }} />
        No Status
      </button>
      {statuses.map((s) => (
        <button
          key={s.id}
          className={`${styles.statusOption} ${statusId === s.id ? styles.statusOptionActive : ''}`}
          onClick={(e) => { e.stopPropagation(); onPick(s.id) }}
        >
          <span style={{ color: s.color }}><StatusIcon icon={s.icon || DEFAULT_STATUS_ICON} filled /></span>
          {s.name}
        </button>
      ))}
    </div>
  )
}

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
      // Muted at rest; the status's colour while the row is hovered / focused / has a picker open.
      style={status ? { '--status-color': status.color } as CSSProperties : undefined}
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
