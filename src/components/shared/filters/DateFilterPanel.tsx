import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { DatePendingNotContext, type PendingNot } from './date-pending-not'
import type { DateAnchor, DateFilters, DateRangeMatch } from '../../../models'
import type { DateField } from '../../../models/app-view'
import {
  activeDateFields,
  offeredDateFields,
  dateRangeOf,
  hasDateFilters,
  isDateMatchOn,
  isNegatableDateField,
  isOptionalDateField,
  withDateMatch,
} from '../../../utils/date-filters'
import {
  entryModeOf,
  fitsCalendar,
  resolvedEndWords,
  switchAnchorMode,
  type DateAnchorSide,
  type DateEntryMode,
  type ModeSwitchMemo,
} from '../../../utils/date-anchor'
import { describeDateMatch } from '../../../utils/filter-chips'
import { DATE_FIELD_LABELS, DATE_FIELD_LABELS_SHORT } from '../../../utils/filter-labels'
import { DateAnchorInput } from '../DateAnchorInput'
import { ChevronDownIcon } from '../icons'
import { MenuPopover, type MenuEntry } from '../MenuPopover'
import { FilterModeToggle } from './FilterPanels'
import { useChipDay } from './filter-menu'
import styles from './DateFilterPanel.module.css'
import sheetStyles from './FilterChipBarMobile.module.css'
import { shortcutScope } from '../../../utils/dom-contract'

/**
 * What the Show row picks (D23 board B): a range entered as calendar dates
 * or relative to today, or — the optional types (Due, Planned, Next / Last
 * follow-up) — any task with the date (`set`) or none without it (`unset`).
 */
type ShowMode = DateEntryMode | 'set' | 'unset'

const RANGE_CHOICES: readonly { mode: ShowMode; label: string }[] = [
  { mode: 'calendar', label: 'Calendar' },
  { mode: 'relative', label: 'Relative' },
]
const OPTIONAL_CHOICES: readonly { mode: ShowMode; label: string }[] = [
  ...RANGE_CHOICES,
  { mode: 'set', label: 'Any' },
  { mode: 'unset', label: 'None' },
]

/** The ends' mode-switch memos for one type (`switchAnchorMode`), while the panel is open. */
type SwitchMemos = Partial<Record<DateAnchorSide, ModeSwitchMemo>>


/**
 * "Also tasks with no …", the line in its place under an "is not" range,
 * and the lines under Show's Any / None, per type that offers them.
 */
const NO_DATE_WORDS: Partial<Record<DateField, { also: string; kept: string; has: string; none: string }>> = {
  deadline: { also: 'Also tasks with no due date', kept: 'Tasks with no due date are kept.', has: 'Only tasks that have a due date.', none: 'Only tasks with no due date.' },
  planned: { also: 'Also tasks with no planned date', kept: 'Tasks with no planned date are kept.', has: 'Only tasks that have a planned date.', none: 'Only tasks with no planned date.' },
  followup: { also: 'Also tasks with no next follow-up', kept: 'Tasks with no next follow-up are kept.', has: 'Only tasks that have a next follow-up.', none: 'Only tasks with no next follow-up.' },
  lastFollowup: { also: 'Also tasks never followed up', kept: 'Tasks never followed up are kept.', has: 'Only tasks that have been followed up.', none: 'Only tasks never followed up.' },
}

/** The line under a Completed range: it brings the completed tasks it keeps in. */
const COMPLETED_NOTE = 'Shows tasks completed in this range, even where completed tasks are hidden.'

/**
 * What a host's date panel offers, where it differs from the default (every
 * type; a Completed range that brings completed tasks in — a list, Edit
 * list, the top bar, the phone sheet).
 */
export interface DateFilterHost {
  /** Date types left out of the type menu (the check-in: Completed — it only ever takes open tasks). */
  omit?: readonly DateField[]
}

/** The date types `host` offers, in the type menu's order. */
function dateFieldsOffered(host: DateFilterHost | undefined): readonly DateField[] {
  return offeredDateFields(host?.omit)
}

/** The types the menu lists after its separator: the record (Completed · Created · Modified), below the dates planned by. */
const RECORD_DATE_FIELDS: readonly DateField[] = ['completed', 'created', 'modified']

/** The type button's name: `Date type: Planned`, `, filtering` when that type filters. */
function typeButtonLabel(field: DateField, lit: boolean): string {
  return `Date type: ${DATE_FIELD_LABELS_SHORT[field]}${lit ? ', filtering' : ''}`
}

interface PanelRange {
  start: DateAnchor | null
  end: DateAnchor | null
  includeNoDate: boolean
  not: boolean
}

/** A range kept while Show is Any / None, with the mode it was entered in. */
interface HiddenRange extends PanelRange {
  mode: DateEntryMode
}

/** A range clause as stored: `not` or `includeNoDate` only when true, never both (`normalizeDateMatch` drops the rest). */
function rangeMatch({ start, end, includeNoDate, not }: PanelRange): DateRangeMatch {
  return { match: 'range', start, end, ...(not ? { not: true } : includeNoDate ? { includeNoDate: true } : {}) }
}

interface DateFilterPanelProps {
  /** The date filters edited: one clause per date type (AND). */
  dates: DateFilters
  /** The type selected when the panel opens; default the first type that filters, else Due. */
  initialField?: DateField
  onChange: (dates: DateFilters) => void
  /** `sheet`: the phone Filters sheet's touch sizes, a switch, `Clear all dates`. Default `popover`. */
  variant?: 'popover' | 'sheet'
  /** Focus the type button when the panel mounts (a popover opened from a button). */
  autoFocus?: boolean
  /** Types left out (see `DateFilterHost`); default every type. */
  host?: DateFilterHost
}

/**
 * The date filters: one type button naming the type being edited (a dot
 * when it filters; `N filtering` when any type does) whose menu lists the
 * types — Due · Planned · Next follow-up · Last follow-up, then Completed ·
 * Created · Modified — each that filters lit with its clause in words, the
 * selected one checked; picking one selects it and writes nothing. Then the
 * selected type's clause: Show (D23
 * board B: Calendar · Relative, and on the optional types Any · None — has
 * the date / hasn't; a range opens in the mode its ends read as, a new one
 * in Relative; switching converts the ends and, while the panel is open,
 * restores them on the way back), the range's Is / Is not (the id pickers'
 * toggle; every type but Completed), From / To (`DateAnchorInput` in the
 * range's mode; under a Relative end, its day today) and "Also tasks with no
 * …" — under Is not, a line saying those are kept — (Completed: a line
 * saying it shows completed tasks), and a footer with Clear <Type> and
 * Clear all. The same component in the top bar, a list's + Filter / date
 * chip, Edit list, the check-in filter (`host` omits Completed) and the phone Filters sheet.
 */
export function DateFilterPanel({ dates, initialField, onChange, variant = 'popover', autoFocus = false, host }: DateFilterPanelProps) {
  const types = dateFieldsOffered(host)
  const [field, setField] = useState<DateField>(() => (initialField && types.includes(initialField) ? initialField : undefined)
    ?? activeDateFields(dates).find((f) => types.includes(f)) ?? types[0] ?? 'deadline')
  // A range kept while Show is Any / None, so Calendar / Relative brings it back (never stored).
  const [hidden, setHidden] = useState<Partial<Record<DateField, HiddenRange>>>({})
  // Is not picked before the range has an end (no clause to hold it yet; never stored).
  const pendingNotMemory = useContext(DatePendingNotContext)
  const [pendingNot, setPendingNot] = useState<PendingNot>(() => pendingNotMemory?.get() ?? {})
  useEffect(() => { pendingNotMemory?.set(pendingNot) }, [pendingNotMemory, pendingNot])
  // Calendar / Relative per type — picked, or pinned by the first edit to the mode shown (else read
  // from the ends) — and what a switch converted (never stored). Clear forgets both: a new range again.
  const [modes, setModes] = useState<Partial<Record<DateField, DateEntryMode>>>({})
  const [memos, setMemos] = useState<Partial<Record<DateField, SwitchMemos>>>({})
  const day = useChipDay()
  const typeRef = useRef<HTMLButtonElement | null>(null)
  // The type menu while open: the button's width when it opened (the menu spans it).
  const [menuWidth, setMenuWidth] = useState<number | null>(null)
  const menuOpen = menuWidth !== null
  const toggleMenu = () => setMenuWidth(menuOpen ? null : typeRef.current?.offsetWidth ?? 0)
  const showRefs = useRef(new Map<ShowMode, HTMLButtonElement>())
  const id = useId()
  const sheet = variant === 'sheet'

  useEffect(() => {
    if (autoFocus) typeRef.current?.focus()
  }, [autoFocus])

  const clause = dates[field]
  const on = isDateMatchOn(clause)
  const optional = isOptionalDateField(field)
  const range = dateRangeOf(clause)
  const { start, end, includeNoDate } = range
  const hasEnd = start !== null || end !== null
  // The mode picked or pinned for the type, else the one its ends read as (a new range: Relative); ends only Relative can show, Relative.
  const entryMode: DateEntryMode = fitsCalendar(start, end) ? modes[field] ?? entryModeOf(start, end) : 'relative'
  const show: ShowMode = optional && clause && clause.match !== 'range' ? clause.match : entryMode
  const inRange = show === 'calendar' || show === 'relative'
  const showChoices = optional ? OPTIONAL_CHOICES : RANGE_CHOICES
  const negatable = isNegatableDateField(field)
  const not = negatable && (hasEnd ? range.not : pendingNot[field] === true)
  const noDateWords = optional ? NO_DATE_WORDS[field] : undefined
  const rangeNote = field === 'completed' ? COMPLETED_NOTE : undefined
  const shortName = DATE_FIELD_LABELS_SHORT[field]

  const forgetHidden = (f: DateField) => setHidden((h) => {
    if (!(f in h)) return h
    const next = { ...h }
    delete next[f]
    return next
  })

  const keepPendingNot = (f: DateField, on: boolean) => setPendingNot((p) => {
    if ((p[f] === true) === on) return p
    const next = { ...p }
    if (on) next[f] = true
    else delete next[f]
    return next
  })

  const setRange = (s: DateAnchor | null, e: DateAnchor | null, include = includeNoDate, negate = not) => {
    // The mode shown stays while the panel is open: an edit never re-reads it from the new ends
    // (emptying a Calendar range's date would flip it to Relative under the user's typing).
    if (!(field in modes)) setModes((m) => (field in m ? m : { ...m, [field]: entryMode }))
    // With no end there's no clause to hold Is not: keep it here until an end is picked.
    keepPendingNot(field, negate && s === null && e === null)
    onChange(withDateMatch(dates, field, rangeMatch({ start: s, end: e, includeNoDate: include, not: negate })))
  }

  // Is / Is not: with an end it rewrites the range; without one it is only kept until an end is picked.
  const setNot = (on: boolean) => {
    if (hasEnd) setRange(start, end, includeNoDate, on)
    else keepPendingNot(field, on)
  }

  // A range's ends in the other mode: each restored if a switch made it and it's unchanged, else converted from today.
  const switchRange = (r: PanelRange, from: DateEntryMode, to: DateEntryMode): PanelRange => {
    const m = memos[field] ?? {}
    const s = switchAnchorMode(r.start, from, to, m.from, day.today, day.weekStartsOn)
    const e = switchAnchorMode(r.end, from, to, m.to, day.today, day.weekStartsOn)
    setMemos((all) => ({ ...all, [field]: { from: s.memo, to: e.memo } }))
    return { ...r, start: s.anchor, end: e.anchor }
  }

  const setShow = (mode: ShowMode) => {
    if (mode === show) return
    if (mode === 'calendar' || mode === 'relative') {
      setModes((m) => ({ ...m, [field]: mode }))
      if (inRange) {
        if (hasEnd) onChange(withDateMatch(dates, field, rangeMatch(switchRange({ start, end, includeNoDate, not }, entryMode, mode))))
        return
      }
      const kept = hidden[field]
      forgetHidden(field)
      const back = kept && (kept.mode === mode ? kept : switchRange(kept, kept.mode, mode))
      onChange(withDateMatch(dates, field, back ? rangeMatch(back) : null))
      return
    }
    if (inRange && hasEnd) setHidden((h) => ({ ...h, [field]: { start, end, includeNoDate, not, mode: entryMode } }))
    onChange(withDateMatch(dates, field, { match: mode }))
  }

  const forgetModes = (f?: DateField) => {
    const drop = <T,>(all: Partial<Record<DateField, T>>) => {
      if (f === undefined) return {}
      if (!(f in all)) return all
      const next = { ...all }
      delete next[f]
      return next
    }
    setModes(drop)
    setMemos(drop)
  }

  const clearType = () => {
    forgetHidden(field)
    forgetModes(field)
    keepPendingNot(field, false)
    onChange(withDateMatch(dates, field, null))
  }
  const clearAll = () => {
    setHidden({})
    setPendingNot({})
    forgetModes()
    onChange({})
  }

  // The type button: Enter / Space (a click) or ↓ open the menu; the menu's Esc brings the focus back here.
  const onTypeKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' || menuOpen) return
    e.preventDefault()
    toggleMenu()
  }
  const filteringCount = types.filter((f) => isDateMatchOn(dates[f])).length
  const typeEntries: MenuEntry[] = types.flatMap((f, i): MenuEntry[] => {
    const m = dates[f]
    const lit = isDateMatchOn(m)
    const prev = types[i - 1]
    const startsRecord = prev !== undefined && RECORD_DATE_FIELDS.includes(f) && !RECORD_DATE_FIELDS.includes(prev)
    const item: MenuEntry = {
      kind: 'item',
      label: DATE_FIELD_LABELS_SHORT[f],
      radio: true,
      checked: f === field,
      accent: lit,
      icon: lit ? <span className={styles.dot} aria-hidden="true" /> : undefined,
      // The clause in the header's words; read after the name (`Due, within the next 7 days`).
      trailing: lit ? <span className={styles.menuWords}><span className={styles.srOnly}>,</span> {describeDateMatch(m, f)}</span> : undefined,
      onSelect: () => setField(f),
    }
    return startsRecord ? [{ kind: 'separator' }, item] : [item]
  })
  const onShowKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = showChoices.findIndex((c) => c.mode === show)
    const n = showChoices.length
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
        : e.key === 'Home' ? 0
          : e.key === 'End' ? n - 1
            : null
    if (to === null) return
    e.preventDefault()
    const choice = showChoices[to]
    if (!choice) return
    setShow(choice.mode)
    showRefs.current.get(choice.mode)?.focus()
  }

  const titleId = `${id}-title`
  const panelId = `${id}-panel`
  const noDateLabel = noDateWords?.also

  return (
    <div className={`${styles.panel} ${sheet ? styles.sheet : ''}`} {...shortcutScope('none')}>
      <div className={styles.typeRow}>
        <button
          ref={typeRef}
          type="button"
          className={`${styles.typeButton} ${menuOpen ? styles.typeOpen : ''}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={typeButtonLabel(field, on)}
          aria-description={filteringCount > 0 ? `${filteringCount} filtering` : undefined}
          data-date-type={field}
          data-filtering={on ? '' : undefined}
          // The menu leaves a press on its own button to the button: it toggles.
          onClick={toggleMenu}
          onKeyDown={onTypeKeyDown}
        >
          {on && <span className={styles.dot} aria-hidden="true" />}
          <span className={styles.typeName}>{DATE_FIELD_LABELS_SHORT[field]}</span>
          {filteringCount > 0 && <span className={styles.typeCount}>{filteringCount} filtering</span>}
          <ChevronDownIcon />
        </button>
        {menuOpen && (
          <MenuPopover
            anchorRef={typeRef}
            width={menuWidth || undefined}
            label="Date type"
            entries={typeEntries}
            focusChecked
            touch={sheet}
            onClose={() => setMenuWidth(null)}
          />
        )}
      </div>
      <div className={styles.body} role="group" id={panelId} aria-labelledby={titleId}>
        <div className={styles.header}>
          <span className={styles.title} id={titleId}>{DATE_FIELD_LABELS[field]}</span>
          {on && clause
            ? <span className={styles.words} data-tooltip={describeDateMatch(clause, field)}>{describeDateMatch(clause, field)}</span>
            : <span className={styles.off}>Not filtering</span>}
        </div>
        <div className={styles.showRow}>
          <span className={styles.label}>Show</span>
          <div
            className={`${styles.track} ${styles.showTrack}`}
            style={{ gridTemplateColumns: `repeat(${showChoices.length}, minmax(0, 1fr))` }}
            role="radiogroup"
            aria-label="Which tasks"
          >
            {showChoices.map((c) => {
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
        {inRange ? (
          <>
            {negatable && (
              <div className={styles.rangeRow}>
                <span className={styles.label}>Range</span>
                <div className={styles.mode}>
                  <FilterModeToggle field={shortName} negated={not} onChange={setNot} touch={sheet} />
                </div>
              </div>
            )}
            {(['from', 'to'] as const).map((side) => {
              const value = side === 'from' ? start : end
              const label = side === 'from' ? 'From' : 'To'
              // Under a Relative end, its day today (`Mon 26 Oct and earlier` with the other end open).
              const words = entryMode === 'relative'
                ? resolvedEndWords(side, value, side === 'from' ? end : start, day.today, day.weekStartsOn)
                : null
              const wordsId = `${id}-${side}-day`
              return (
                <div key={side} className={styles.end}>
                  <div className={styles.rangeRow}>
                    <span className={styles.label}>{label}</span>
                    <DateAnchorInput
                      key={field}
                      mode={entryMode}
                      side={side}
                      value={value}
                      label={label}
                      day={day}
                      touch={sheet}
                      describedBy={words ? wordsId : undefined}
                      onChange={(v) => (side === 'from' ? setRange(v, end) : setRange(start, v))}
                    />
                  </div>
                  {words && <p id={wordsId} className={styles.resolved}>{words}</p>}
                </div>
              )
            })}
            {noDateLabel && not && <p className={styles.explain}>{noDateWords?.kept}</p>}
            {noDateLabel && !not && (sheet ? (
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
