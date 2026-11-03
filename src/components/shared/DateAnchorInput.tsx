import { useEffect, useRef, useState } from 'react'
import type { DateAnchor } from '../../models'
import {
  CALENDAR_PRESETS,
  DAY_PRESETS,
  ROLLING_DAYS,
  countAnchor,
  fixedAnchorOn,
  relativeEndOf,
  rollingDayLabel,
  type DateAnchorSide,
  type DateEntryMode,
  type DayCount,
  type RelativeEnd,
} from '../../utils/date-anchor'
import { toDateInputValue } from '../../utils/date'
import { daysUntil, resolveDateAnchor } from '../../utils/effective-date'
import type { ChipDay } from '../../utils/filter-chips'
import { describeAnchor } from '../../utils/filter-chips'
import { formatFollowupDate } from '../../utils/followup'
import { ChevronDownIcon } from './icons'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import styles from './DateAnchorInput.module.css'

/** Digits only, at most three (0–999): what the Relative number box takes. */
const COUNT_DRAFT_PATTERN = /^\d{0,3}$/
const COUNT_WORDS: Record<DayCount, { one: string; many: string }> = {
  ago: { one: 'day ago', many: 'days ago' },
  ahead: { one: 'day ahead', many: 'days ahead' },
}
const MENU_WIDTH_PX = 220

export interface DateAnchorInputProps {
  /** Calendar: a date + Set to…; Relative: a number + what it counts, or a rolling day. */
  mode: DateEntryMode
  /** Which end: its presets (From: starts and past days; To: ends and future days) and its open end's name. */
  side: DateAnchorSide
  value: DateAnchor | null
  onChange: (v: DateAnchor | null) => void
  /** The end's name (`From` / `To`): the date input's label, and the start of the others'. */
  label: string
  /** Today and the week start the presets resolve against. */
  day: ChipDay
  /**
   * What an offset of 0 counts here (it has no sign of its own); default
   * `days ago`. The owner holds it so it outlives this input (a tab or mode
   * switch remounts it) — see `onZeroCountChange`.
   */
  zeroCount?: DayCount
  /** The count of every day count this input writes, for the owner to hold as `zeroCount`. */
  onZeroCountChange?: (count: DayCount) => void
  /** The id of the line under a Relative end (its day today), read with the number and the dropdown. */
  describedBy?: string
  /** The phone sheet's touch sizes. */
  touch?: boolean
  className?: string
}

/** The Relative dropdown's text for an end — what the number counts, never the number itself. */
function relativeEndText(end: RelativeEnd, side: DateAnchorSide): string {
  switch (end.kind) {
    case 'none': return side === 'from' ? 'No start' : 'No end'
    case 'count': return end.days === 1 ? COUNT_WORDS[end.count].one : COUNT_WORDS[end.count].many
    case 'rolling': return rollingDayLabel(end.token)
    case 'date': return `on ${describeAnchor({ kind: 'fixed', iso: end.iso })}`
  }
}

/**
 * One end of a date range (`DateFilterPanel`'s From / To, cr25 P8 — D23
 * board B). **Calendar**: a native date input and a **Set to…** action menu
 * (`CALENDAR_PRESETS` for the end, each with its day today; Clear the
 * date) that fills the date and reads Set to… again — always a fixed date.
 * **Relative**: a number box (0–999, digits only — what it counts is the
 * dropdown's job) and a dropdown: Count (`days ago` / `days ahead`), Fill
 * in (`DAY_PRESETS`: fills the number and the count), Rolling day
 * (`ROLLING_DAYS` for the end; another token is listed with them while it is
 * the value), a saved mix's date as `on Oct 1` while it is the value, and No
 * start / No end. The number shows only for a count; the dropdown never
 * repeats it. Picking a count moves the focus to the number.
 */
export function DateAnchorInput(props: DateAnchorInputProps) {
  return props.mode === 'calendar' ? <CalendarEnd {...props} /> : <RelativeEnd {...props} />
}

function CalendarEnd({ side, value, onChange, label, day, touch, className }: DateAnchorInputProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  // The date's local day (its ISO's own day is UTC's: a day off either side of it).
  const dateStr = value?.kind === 'fixed' ? toDateInputValue(new Date(value.iso)) : ''
  const entries: MenuEntry[] = [
    ...CALENDAR_PRESETS[side].flatMap((group, i): MenuEntry[] => [
      ...(i > 0 ? [{ kind: 'separator' as const }] : []),
      ...group.map((p): MenuEntry => {
        const d = p.day(day.today, day.weekStartsOn)
        return { kind: 'item', label: p.label, note: formatFollowupDate(d, day.today), onSelect: () => onChange(fixedAnchorOn(d)) }
      }),
    ]),
    { kind: 'separator' },
    { kind: 'item', label: 'Clear the date', disabled: value === null, onSelect: () => onChange(null) },
  ]
  return (
    <div className={`${styles.wrapper} ${touch ? styles.touch : ''} ${className ?? ''}`}>
      <input
        type="date"
        className={`${styles.field} ${styles.dateInput}`}
        value={dateStr}
        onChange={(e) => {
          const v = e.target.value
          onChange(v ? { kind: 'fixed', iso: new Date(v + 'T00:00:00').toISOString() } : null)
        }}
        aria-label={label}
      />
      <button
        ref={ref}
        type="button"
        className={`${styles.field} ${styles.select} ${styles.action} ${open ? styles.open : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: Set to…`}
        // The menu leaves a press on its own button to the button: it toggles.
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.selectValue}>Set to…</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <MenuPopover anchorRef={ref} width={MENU_WIDTH_PX} label={`Set ${label} to`} entries={entries} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

function RelativeEnd({ side, value, onChange, label, day, zeroCount, onZeroCountChange, describedBy, touch, className }: DateAnchorInputProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const numberRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const end = relativeEndOf(value, zeroCount)
  // A day count written: its count is what a 0 here counts from now on.
  const writeCount = (days: number, count: DayCount) => {
    onZeroCountChange?.(count)
    onChange(countAnchor(days, count))
  }
  // The number box's text while it can't be stored (cleared to retype).
  const [draft, setDraft] = useState<string | null>(null)
  if (end.kind !== 'count' && draft !== null) setDraft(null)
  // Picking a count hands the focus to the number (after the menu gives it back to its button).
  const [focusNumber, setFocusNumber] = useState(0)
  useEffect(() => {
    if (focusNumber === 0) return
    numberRef.current?.focus()
    numberRef.current?.select()
  }, [focusNumber])

  const pickCount = (count: DayCount) => {
    // A count keeps the number; from anything else, the end's day if it lies that way from today, else 0.
    const distance = end.kind === 'count' || value == null ? null : daysUntil(resolveDateAnchor(value, day.today, day.weekStartsOn), day.today)
    const days = end.kind === 'count' ? end.days : Math.max(0, (distance ?? 0) * (count === 'ago' ? -1 : 1))
    setDraft(null)
    writeCount(days, count)
    setFocusNumber((n) => n + 1)
  }
  const fill = (days: number) => {
    setDraft(null)
    writeCount(days, days < 0 ? 'ago' : 'ahead')
  }

  const rolling = ROLLING_DAYS[side]
  const extraToken = end.kind === 'rolling' && !rolling.includes(end.token) ? end.token : null
  const entries: MenuEntry[] = [
    { kind: 'label', text: 'Count' },
    ...(['ago', 'ahead'] as const).map((c): MenuEntry => ({
      kind: 'item', label: COUNT_WORDS[c].many, radio: true, checked: end.kind === 'count' && end.count === c, onSelect: () => pickCount(c),
    })),
    { kind: 'separator' },
    { kind: 'label', text: 'Fill in' },
    ...DAY_PRESETS.map((p): MenuEntry => ({ kind: 'item', label: p.label, note: String(Math.abs(p.days)), onSelect: () => fill(p.days) })),
    { kind: 'separator' },
    { kind: 'label', text: 'Rolling day' },
    ...[...rolling, ...(extraToken ? [extraToken] : [])].map((t): MenuEntry => ({
      kind: 'item', label: rollingDayLabel(t), radio: true, checked: end.kind === 'rolling' && end.token === t,
      onSelect: () => onChange({ kind: 'relative', token: t }),
    })),
    { kind: 'separator' },
    ...(end.kind === 'date' ? [{ kind: 'item' as const, label: relativeEndText(end, side), radio: true, checked: true }] : []),
    { kind: 'item', label: relativeEndText({ kind: 'none' }, side), radio: true, checked: end.kind === 'none', onSelect: () => onChange(null) },
  ]
  const text = relativeEndText(end, side)

  return (
    <div className={`${styles.wrapper} ${touch ? styles.touch : ''} ${className ?? ''}`}>
      {end.kind === 'count' && (
        <input
          ref={numberRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          className={`${styles.field} ${styles.number}`}
          value={draft ?? String(end.days)}
          onChange={(e) => {
            const raw = e.target.value
            if (!COUNT_DRAFT_PATTERN.test(raw)) return
            setDraft(raw)
            if (raw === '') return
            writeCount(parseInt(raw, 10), end.count)
          }}
          onBlur={() => setDraft(null)}
          aria-label={`${label}: number of days`}
          aria-describedby={describedBy}
        />
      )}
      <button
        ref={ref}
        type="button"
        className={`${styles.field} ${styles.select} ${end.kind === 'none' ? styles.placeholder : ''} ${open ? styles.open : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${text}`}
        aria-describedby={describedBy}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.selectValue}>{text}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <MenuPopover anchorRef={ref} width={MENU_WIDTH_PX} label={label} entries={entries} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
