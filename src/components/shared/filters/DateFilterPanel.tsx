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

/** Which tasks a Due / Follow-up clause keeps. */
type ShowMode = 'range' | 'set' | 'unset'

const SHOW_CHOICES: readonly { mode: ShowMode; label: string }[] = [
  { mode: 'range', label: 'In range' },
  { mode: 'set', label: 'Has a date' },
  { mode: 'unset', label: 'No date' },
]

/** "Also tasks with no …" and the Has a date / No date lines, per type that offers them. */
const NO_DATE_NAME: Partial<Record<DateField, string>> = {
  deadline: 'due date',
  followup: 'follow-up',
}

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
}

/**
 * The date filters: four type tabs (Due · Follow-up · Created · Modified) —
 * the selected tab is the one being edited, every type that filters is lit;
 * selecting a tab writes nothing — then the selected type's clause: Show
 * (In range · Has a date · No date, Due and Follow-up only), From / To and
 * "Also tasks with no …", and a footer with Clear <Type> and Clear all.
 * The same component in the top bar, a list's + Filter / date chip, Edit
 * list and the phone Filters sheet.
 */
export function DateFilterPanel({ dates, initialField, onChange, variant = 'popover', autoFocus = false }: DateFilterPanelProps) {
  const [field, setField] = useState<DateField>(() => initialField ?? activeDateFields(dates)[0] ?? 'deadline')
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
  const noDateName = optional ? NO_DATE_NAME[field] : undefined
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
    const i = DATE_FIELD_VALUES.indexOf(field)
    const n = DATE_FIELD_VALUES.length
    const to = e.key === 'ArrowRight' ? (i + 1) % n
      : e.key === 'ArrowLeft' ? (i - 1 + n) % n
        : e.key === 'Home' ? 0
          : e.key === 'End' ? n - 1
            : null
    if (to === null) return
    e.preventDefault()
    const f = DATE_FIELD_VALUES[to]
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
  const noDateLabel = noDateName ? `Also tasks with no ${noDateName}` : undefined

  return (
    <div ref={rootRef} className={`${styles.panel} ${sheet ? styles.sheet : ''}`} {...shortcutScope('none')}>
      <div className={styles.tabs} role="tablist" aria-label="Date type">
        {DATE_FIELD_VALUES.map((f) => {
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
              {DATE_FIELD_LABELS_SHORT[f]}
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
          </>
        ) : (
          <p className={styles.explain}>
            {show === 'set' ? `Only tasks that have a ${noDateName ?? ''}.` : `Only tasks with no ${noDateName ?? ''}.`}
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
