import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_STATUS_ICON, type Status } from '../../models'
import { useToday } from '../../hooks/use-today'
import { useSettingsStore } from '../../stores/settings-store'
import { factDateWords, type FactDateKind } from '../../utils/fact-dates'
import type { UrgentMark } from '../../utils/urgency'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { UrgentClockIcon } from '../shared/MarkerIcons'
import { StatusIcon } from '../shared/StatusIcon'
import { useTooltip } from '../shared/use-tooltip'
import styles from './TaskDetails.module.css'

/** The facts rail's sections (task layout A), top to bottom: Due is the last (the follow-up dates are the dock's). */
export type FactKind = 'priority' | 'status' | 'people' | 'tags' | 'due'

const FACT_LABELS: Record<FactKind, string> = {
  priority: 'Priority',
  status: 'Status',
  people: 'People',
  tags: 'Tags',
  due: 'Due',
}

/**
 * A section of the task layout's facts rail (boards BJ, BL, task layout A —
 * the task editor and the review card alike): its header — the fact's name
 * as the app's standard section label (the writing's `NOTES` / `SUBTASKS`:
 * 11px bold caps, muted; no colour, no icon — colour is the values') — then
 * its value. A hairline separates it from the section above.
 */
export function FactSection({ fact, children }: { fact: FactKind; children: ReactNode }) {
  const id = useId()
  return (
    <section className={styles.fact} data-fact={fact} aria-labelledby={id}>
      <div className={styles.factHeading} id={id}>{FACT_LABELS[fact]}</div>
      {children}
    </section>
  )
}

/** How a date's words are coloured, as the row's date cells colour them. */
export type FactDateTone = 'due-past' | 'due-soon' | 'followup-late' | 'followup-today'

/**
 * A date as every date in the task layout reads (board BJ, one look): the
 * row's words (`Today`, `Fri`, `11/06`) in the row's colour, how far it is
 * when the words don't say it (`3 days late`, `2 weeks ago`), and the full
 * date in the tooltip.
 */
export function FactDateWords({ date, kind, tone, empty }: {
  date: Date | null | undefined
  kind: FactDateKind
  tone?: FactDateTone
  /** Shown, muted, without a date (`None`, `Never`). */
  empty: string
}) {
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)
  if (!date) return <span className={styles.dateEmpty}>{empty}</span>
  const w = factDateWords(date, today, rowDates, kind)
  return (
    <>
      <span className={styles.dateWords} data-tone={tone}>{w.words}</span>
      {w.relative && <span className={styles.dateRelative}>{w.relative}</span>}
    </>
  )
}

/** A date's tooltip: the full date (`Friday, November 6, 2026`), or nothing without one. */
function useFactDateTitle(date: Date | null | undefined, kind: FactDateKind): string | undefined {
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)
  return date ? factDateWords(date, today, rowDates, kind).full : undefined
}

/**
 * A typed date field (a follow-up's, in the dock's rows) in the one date
 * look: at rest it shows the date's words over the field (`FactDateWords`)
 * — the field's own text hidden under them, in its quiet box —, and a click
 * or the focus shows the field as typed (`Mon 16 Nov`, typed entry such as
 * `2w` or `fri`). A field holding typed text that isn't set (`showWords`
 * false) shows its text.
 */
export function FactDateField({ date, kind, tone, empty, showWords = true, testId, children }: {
  date: Date | null | undefined
  kind: FactDateKind
  tone?: FactDateTone
  empty: string
  showWords?: boolean
  /** `data-testid` on the field (the review's `review-last-followup`). */
  testId?: string
  /** The field: its input wrap (`Followup.module.css`'s `editorInputWrap`). */
  children: ReactNode
}) {
  const title = useFactDateTitle(date, kind)
  return (
    <div className={styles.dateField} data-fact-date-field="" data-words={showWords || undefined} data-testid={testId} title={title}>
      {children}
      {showWords && (
        <span className={styles.dateFieldWords} aria-hidden="true">
          <FactDateWords date={date} kind={kind} tone={tone} empty={empty} />
        </span>
      )}
    </div>
  )
}

// ── Priority ───────────────────────────────────────────────────────────────

export interface PriorityFactsProps {
  focusOn: boolean
  urgentOn: boolean
  importantOn: boolean
  /** `urgentMark`: `date` while urgent by its due date only (the faint clock after the label). */
  urgentState: UrgentMark
  /** The due date's hint for the Urgent tooltip (`urgentToggleHint`). */
  urgentHint: string
  onToggleFocus: () => void
  onToggleUrgent: () => void
  onToggleImportant: () => void
}

/**
 * Priority, first in the rail: the marker toggles in display order (Focus ›
 * Urgent › Important) — off muted in a hairline, on the marker's colour on
 * its tint. The Urgent toggle shows and flips the flag only; a due date that
 * makes the task urgent anyway is a hint (the clock after the label, the
 * tooltip). What the callbacks write is the host's.
 */
export function PriorityFacts({
  focusOn, urgentOn, importantOn, urgentState, urgentHint,
  onToggleFocus, onToggleUrgent, onToggleImportant,
}: PriorityFactsProps) {
  return (
    <FactSection fact="priority">
      <div className={styles.markerRow}>
        <MarkerToggle
          pressed={focusOn}
          marker="focus"
          onClick={onToggleFocus}
          tooltip={focusOn ? 'Remove from Focus' : 'Add to Focus'}
        >
          Focus
        </MarkerToggle>
        <MarkerToggle
          pressed={urgentOn}
          marker="urgent"
          onClick={onToggleUrgent}
          tooltip={`${urgentOn ? 'Remove urgent' : 'Mark urgent'}${urgentHint ? `\n${urgentHint}` : ''}`}
          data-urgent={urgentState ?? undefined}
        >
          Urgent
          {urgentState === 'date' && (
            <span className={styles.markerHint} data-urgent-hint=""><UrgentClockIcon /></span>
          )}
        </MarkerToggle>
        <MarkerToggle
          pressed={importantOn}
          marker="important"
          onClick={onToggleImportant}
          tooltip={importantOn ? 'Remove important' : 'Mark important'}
        >
          Important
        </MarkerToggle>
      </div>
    </FactSection>
  )
}

/** A marker toggle (Focus / Urgent / Important) with its tooltip. */
function MarkerToggle({ pressed, marker, onClick, tooltip, children, ...rest }: {
  pressed: boolean
  marker: 'focus' | 'urgent' | 'important'
  onClick: () => void
  tooltip: string
  children: ReactNode
  'data-urgent'?: string
}) {
  const { triggerProps, tooltip: tip } = useTooltip(tooltip)
  return (
    <button
      type="button"
      className={styles.markerToggle}
      data-marker={marker}
      aria-pressed={pressed}
      onClick={onClick}
      {...rest}
      {...triggerProps}
    >
      {children}
      {tip}
    </button>
  )
}

// ── Status ─────────────────────────────────────────────────────────────────

export interface StatusFactsProps {
  statuses: readonly Status[]
  statusId: number | undefined
  /** A status picked (undefined: No Status). */
  onStatusChange: (statusId: number | undefined) => void
}

/**
 * Status, second in the rail (none while no status is defined): the status
 * pill and its menu — No Status, then each status. The menu is placed by
 * `AnchoredPicker` (it follows the pill and stays in the viewport, the rail
 * being a scroller); a press outside or Esc closes the menu only, Esc
 * handing the focus back to the pill — never the dialog around it (cr31 T8).
 */
export function StatusFacts({ statuses, statusId, onStatusChange }: StatusFactsProps) {
  const [open, setOpen] = useState(false)
  const pillRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      pillRef.current?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  if (statuses.length === 0) return null
  const status = statusId != null ? statuses.find((s) => s.id === statusId) : undefined
  const pick = (id: number | undefined) => {
    setOpen(false)
    onStatusChange(id)
  }

  return (
    <FactSection fact="status">
      <div className={styles.statusWrap}>
        <button
          ref={pillRef}
          type="button"
          className={styles.statusPill}
          aria-label={`Status: ${status?.name ?? 'No status'}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {status ? (
            <><span className={styles.statusIcon} style={{ color: status.color }}><StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} filled /></span>{status.name}</>
          ) : (
            <span className={styles.statusNone}>No status</span>
          )}
          <span className={styles.statusCaret} aria-hidden="true">&#x25BE;</span>
        </button>
        {open && (
          <AnchoredPicker anchorRef={pillRef} onClose={() => setOpen(false)}>
            <div className={styles.statusMenu}>
              <button
                type="button"
                className={`${styles.statusOption} ${!statusId ? styles.statusOptionActive : ''}`}
                onClick={() => pick(undefined)}
              >
                <span style={{ color: 'var(--color-text-muted)' }}><StatusIcon icon="circle" /></span>
                No Status
              </button>
              {statuses.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={`${styles.statusOption} ${statusId === s.id ? styles.statusOptionActive : ''}`}
                  onClick={() => pick(s.id)}
                >
                  <span style={{ color: s.color }}><StatusIcon icon={s.icon || DEFAULT_STATUS_ICON} filled /></span>
                  {s.name}
                </button>
              ))}
            </div>
          </AnchoredPicker>
        )}
      </div>
    </FactSection>
  )
}
