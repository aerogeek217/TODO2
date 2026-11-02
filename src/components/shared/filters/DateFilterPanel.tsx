import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { DATE_FIELD_VALUES, type DateAnchor, type DateFilters } from '../../../models'
import type { DateField } from '../../../models/app-view'
import {
  activeDateFields,
  dateRangeOf,
  hasDateFilters,
  isDateMatchOn,
  isOptionalDateField,
  withDateMatch,
} from '../../../utils/date-filters'
import { describeDateMatch } from '../../../utils/filter-chips'
import { DATE_FIELD_LABELS, DATE_FIELD_LABELS_SHORT } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import styles from './DateFilterPanel.module.css'
import sheetStyles from './FilterChipBarMobile.module.css'
import { shortcutScope } from '../../../utils/dom-contract'

/** Which tasks a clause on an optional date (Due, Next / Last follow-up) keeps. */
type ShowMode = 'range' | 'set' | 'unset'

const SHOW_CHOICES: readonly { mode: ShowMode; label: string }[] = [
  { mode: 'range', label: 'In range' },
  { mode: 'set', label: 'Has a date' },
  { mode: 'unset', label: 'No date' },
]

/** "Also tasks with no …" and the Has a date / No date lines, per type that offers them. */
const NO_DATE_WORDS: Partial<Record<DateField, { also: string; has: string; none: string }>> = {
  deadline: { also: 'Also tasks with no due date', has: 'Only tasks that have a due date.', none: 'Only tasks with no due date.' },
  followup: { also: 'Also tasks with no follow-up', has: 'Only tasks that have a follow-up.', none: 'Only tasks with no follow-up.' },
  lastFollowup: { also: 'Also tasks never followed up', has: 'Only tasks that have been followed up.', none: 'Only tasks never followed up.' },
}

/** The line under a Completed range, by what the range does where the panel is (`DateFilterHost.completedNote`). */
const COMPLETED_NOTE: Record<NonNullable<DateFilterHost['completedNote']>, string> = {
  gate: 'Shows tasks completed in this range, even where completed tasks are hidden.',
  narrow: 'Keeps tasks completed in this range, of the tasks the Eisenhower’s list shows.',
}

/**
 * What a host's date panel offers, where it differs from the default (every
 * type; a Completed range that brings completed tasks in — a list, Edit
 * list, a lens, the top bar, the phone sheet).
 */
export interface DateFilterHost {
  /** Date types left out of the tabs (the check-in: Completed — it only ever takes open tasks). */
  omit?: readonly DateField[]
  /**
   * The line under a Completed range. `gate` (default): the range brings the
   * completed tasks it keeps in, even where completed tasks are hidden.
   * `narrow`: it only narrows what the host is given (an Eisenhower pane —
   * matched over the Eisenhower's list, completed tasks only if it shows them).
   */
  completedNote?: 'gate' | 'narrow'
}

/** The date types `host` offers, in reading order. */
function dateFieldsOffered(host: DateFilterHost | undefined): readonly DateField[] {
  const omit = host?.omit
  return omit && omit.length > 0 ? DATE_FIELD_VALUES.filter((f) => !omit.includes(f)) : DATE_FIELD_VALUES
}

/** The tabs' columns (D22 board B: Due · Next follow-up · Last follow-up / Completed · Created · Modified). */
const TAB_COLUMNS = 3

interface HiddenRange {
  start: DateAnchor | null
  end: DateAnchor | null
  includeNoDate: boolean
}

export interface DateFilterPanelProps {
  /** The date filters edited: one clause per date type (AND). */
  dates: DateFilters
  /** The tab selected when the panel opens; default the first type that filters, else Due. */
  initialField?: DateField
  onChange: (dates: DateFilters) => void
  /** `sheet`: the phone Filters sheet's touch sizes, a switch, `Clear all dates`. Default `popover`. */
  variant?: 'popover' | 'sheet'
  /** Focus the selected tab when the panel mounts (a popover opened from a button). */
  autoFocus?: boolean
  /** Types left out, the Completed note (see `DateFilterHost`); default every type, the gate's note. */
  host?: DateFilterHost
}

/**
 * The date filters: six type tabs in two rows of three (D22 board B: Due ·
 * Next follow-up · Last follow-up / Completed · Created · Modified) — the
 * selected tab is the one being edited, every type that filters is lit;
 * selecting a tab writes nothing; ←/→ walk all six in reading order, ↑/↓
 * move between the rows — then the selected type's clause: Show (In range ·
 * Has a date · No date, the optional types only), From / To and "Also tasks
 * with no …" (Completed: a range only, with a line saying it shows completed
 * tasks), and a footer with Clear <Type> and Clear all. The same component
 * in the top bar, a list's + Filter / date chip, Edit list, Lenses, the
 * Eisenhower panes (`host` narrow: its Completed line says the range only
 * keeps), the check-in filter (`host` omits Completed) and the phone Filters
 * sheet. With a type left out, the tabs fill the rows in reading order.
 */
export function DateFilterPanel({ dates, initialField, onChange, variant = 'popover', autoFocus = false, host }: DateFilterPanelProps) {
  const types = dateFieldsOffered(host)
  const [field, setField] = useState<DateField>(() => (initialField && types.includes(initialField) ? initialField : undefined)
    ?? activeDateFields(dates).find((f) => types.includes(f)) ?? types[0] ?? 'deadline')
  // A range kept while Show is Has a date / No date, so In range brings it back (never stored).
  const [hidden, setHidden] = useState<Partial<Record<DateField, HiddenRange>>>({})
  const tabRefs = useRef(new Map<DateField, HTMLButtonElement>())
  const showRefs = useRef(new Map<ShowMode, HTMLButtonElement>())
  const id = useId()
  const sheet = variant === 'sheet'

  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus) rootRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [autoFocus])

  const clause = dates[field]
  const on = isDateMatchOn(clause)
  const optional = isOptionalDateField(field)
  const show: ShowMode = optional && clause && clause.match !== 'range' ? clause.match : 'range'
  const { start, end, includeNoDate } = dateRangeOf(clause)
  const hasEnd = start !== null || end !== null
  const noDateWords = optional ? NO_DATE_WORDS[field] : undefined
  const rangeNote = field === 'completed' ? COMPLETED_NOTE[host?.completedNote ?? 'gate'] : undefined
  const shortName = DATE_FIELD_LABELS_SHORT[field]

  const forgetHidden = (f: DateField) => setHidden((h) => {
    if (!(f in h)) return h
    const next = { ...h }
    delete next[f]
    return next
  })

  const setRange = (s: DateAnchor | null, e: DateAnchor | null, include = includeNoDate) => {
    onChange(withDateMatch(dates, field, { match: 'range', start: s, end: e, includeNoDate: include }))
  }

  const setShow = (mode: ShowMode) => {
    if (mode === show) return
    if (mode === 'range') {
      const kept = hidden[field]
      forgetHidden(field)
      onChange(withDateMatch(dates, field, kept ? { match: 'range', ...kept } : null))
      return
    }
    if (show === 'range' && hasEnd) setHidden((h) => ({ ...h, [field]: { start, end, includeNoDate } }))
    onChange(withDateMatch(dates, field, { match: mode }))
  }

  const clearType = () => {
    forgetHidden(field)
    onChange(withDateMatch(dates, field, null))
  }
  const clearAll = () => {
    setHidden({})
    onChange({})
  }

  const selectTab = (f: DateField, focus: boolean) => {
    setField(f)
    if (focus) tabRefs.current.get(f)?.focus()
  }
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = types.indexOf(field)
    const n = types.length
    // Up / Down: the other row, same column (two rows: either key moves to
    // it); a shorter last row (a type left out) takes its last tab.
    const rows = Math.ceil(n / TAB_COLUMNS)
    const row = Math.floor(i / TAB_COLUMNS)
    const otherRow = (r: number) => Math.min(((r + rows) % rows) * TAB_COLUMNS + (i % TAB_COLUMNS), n - 1)
    const to = e.key === 'ArrowRight' ? (i + 1) % n
      : e.key === 'ArrowLeft' ? (i - 1 + n) % n
        : e.key === 'ArrowDown' ? otherRow(row + 1)
          : e.key === 'ArrowUp' ? otherRow(row - 1)
            : e.key === 'Home' ? 0
              : e.key === 'End' ? n - 1
                : null
    if (to === null) return
    e.preventDefault()
    const f = types[to]
    if (f) selectTab(f, true)
  }
  const onShowKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = SHOW_CHOICES.findIndex((c) => c.mode === show)
    const n = SHOW_CHOICES.length
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
        : null
    if (to === null) return
    e.preventDefault()
    const choice = SHOW_CHOICES[to]
    if (!choice) return
    setShow(choice.mode)
    showRefs.current.get(choice.mode)?.focus()
  }

  const tabId = (f: DateField) => `${id}-tab-${f}`
  const panelId = `${id}-panel`
  const noDateLabel = noDateWords?.also

  return (
    <div ref={rootRef} className={`${styles.panel} ${sheet ? styles.sheet : ''}`} {...shortcutScope('none')}>
      <div className={styles.tabs} role="tablist" aria-label="Date type">
        {types.map((f) => {
          const lit = isDateMatchOn(dates[f])
          const selected = f === field
          return (
            <button
              key={f}
              ref={(el) => { if (el) tabRefs.current.set(f, el); else tabRefs.current.delete(f) }}
              type="button"
              role="tab"
              id={tabId(f)}
              aria-selected={selected}
              aria-controls={panelId}
              aria-label={lit ? `${DATE_FIELD_LABELS_SHORT[f]}, filtering` : DATE_FIELD_LABELS_SHORT[f]}
              tabIndex={selected ? 0 : -1}
              data-filtering={lit ? '' : undefined}
              className={`${styles.segment} ${styles.tab} ${selected ? styles.selected : ''} ${lit ? styles.lit : ''}`}
              onClick={() => selectTab(f, false)}
              onKeyDown={onTabKeyDown}
            >
              <span className={styles.tabLabel}>{DATE_FIELD_LABELS_SHORT[f]}</span>
            </button>
          )
        })}
      </div>
      <div className={styles.body} role="tabpanel" id={panelId} aria-labelledby={tabId(field)}>
        <div className={styles.header}>
          <span className={styles.title}>{DATE_FIELD_LABELS[field]}</span>
          {on && clause
            ? <span className={styles.words} title={describeDateMatch(clause)}>{describeDateMatch(clause)}</span>
            : <span className={styles.off}>Not filtering</span>}
        </div>
        {optional && (
          <div className={styles.showRow}>
            <span className={styles.label}>Show</span>
            <div className={`${styles.track} ${styles.showTrack}`} role="radiogroup" aria-label="Which tasks">
              {SHOW_CHOICES.map((c) => {
                const checked = c.mode === show
                return (
                  <button
                    key={c.mode}
                    ref={(el) => { if (el) showRefs.current.set(c.mode, el); else showRefs.current.delete(c.mode) }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    className={`${styles.segment} ${styles.showSegment} ${checked ? styles.selected : ''}`}
                    onClick={() => setShow(c.mode)}
                    onKeyDown={onShowKeyDown}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {show === 'range' ? (
          <>
            <div className={styles.rangeRow}>
              <span className={styles.label}>From</span>
              <DateAnchorInput className={styles.anchor} value={start} onChange={(v) => setRange(v, end)} aria-label="From" />
            </div>
            <div className={styles.rangeRow}>
              <span className={styles.label}>To</span>
              <DateAnchorInput className={styles.anchor} value={end} onChange={(v) => setRange(start, v)} aria-label="To" />
            </div>
            {noDateLabel && (sheet ? (
              <div className={`${styles.noDate} ${hasEnd ? '' : styles.disabled}`}>
                <span>{noDateLabel}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeNoDate}
                  aria-label={noDateLabel}
                  disabled={!hasEnd}
                  className={`${sheetStyles.toggle} ${includeNoDate ? sheetStyles.toggleActive : ''}`}
                  onClick={() => { if (hasEnd) setRange(start, end, !includeNoDate) }}
                />
              </div>
            ) : (
              <label className={`${styles.noDate} ${hasEnd ? '' : styles.disabled}`} aria-disabled={!hasEnd || undefined}>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={includeNoDate}
                  disabled={!hasEnd}
                  onChange={() => { if (hasEnd) setRange(start, end, !includeNoDate) }}
                />
                {noDateLabel}
              </label>
            ))}
            {rangeNote && <p className={styles.explain}>{rangeNote}</p>}
          </>
        ) : (
          <p className={styles.explain}>
            {show === 'set' ? noDateWords?.has : noDateWords?.none}
          </p>
        )}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.ghost} disabled={!on} onClick={clearType}>
          Clear {shortName}
        </button>
        <button type="button" className={styles.ghost} disabled={!hasDateFilters(dates)} onClick={clearAll}>
          {sheet ? 'Clear all dates' : 'Clear all'}
        </button>
      </div>
    </div>
  )
}
