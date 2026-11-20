import { useRef, useState } from 'react'
import type { DateAnchor } from '../../models'
import {
  CALENDAR_PRESETS,
  RELATIVE_END_HINT,
  ROLLING_DAYS,
  dateAnchorsEqual,
  fixedAnchorOn,
  parseRelativeEnd,
  relativeEndText,
  rollingDayLabel,
  type DateAnchorSide,
  type DateEntryMode,
} from '../../utils/date-anchor'
import { toDateInputValue } from '../../utils/date'
import type { ChipDay } from '../../utils/filter-chips'
import { formatFollowupDate } from '../../utils/followup'
import { ChevronDownIcon } from './icons'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import styles from './DateAnchorInput.module.css'

const MENU_WIDTH_PX = 220

interface DateAnchorInputProps {
  /** Calendar: a date + Set to…; Relative: an interval from today typed (`+2w`), or a rolling day. */
  mode: DateEntryMode
  /** Which end: its presets (From: starts and past days; To: ends and future days) and its open end's name. */
  side: DateAnchorSide
  value: DateAnchor | null
  onChange: (v: DateAnchor | null) => void
  /** The end's name (`From` / `To`): the date input's label, and the start of the others'. */
  label: string
  /** Today and the week start the presets resolve against. */
  day: ChipDay
  /** The id of the line under a Relative end (its day today), read with its field and chevron. */
  describedBy?: string
  /** The phone sheet's touch sizes. */
  touch?: boolean
  className?: string
}

/** An open end's name in the Relative chevron's menu. */
function noEndText(side: DateAnchorSide): string {
  return side === 'from' ? 'No start' : 'No end'
}

/**
 * One end of a date range (`DateFilterPanel`'s From / To, cr25 P8 — D23
 * board B). **Calendar**: a native date input and a **Set to…** action menu
 * (`CALENDAR_PRESETS` for the end, each with its day today; Clear the
 * date) that fills the date and reads Set to… again — always a fixed date.
 * **Relative** (typed intervals, board R1): a field the end is typed into —
 * an interval from today in the app's one grammar, signed (`+2w`, `-1m`,
 * `+3d`), `today`, or a rolling day's words (`parseRelativeEnd`) — written as
 * soon as it reads, never while it doesn't (its hint shows once the field is
 * left or ⏎ is pressed; Esc puts the stored end back); and a chevron whose
 * menu keeps the rolling days (`ROLLING_DAYS` for the end; another token is
 * listed with them while it is the value) and No start / No end.
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

function RelativeEnd({ side, value, onChange, label, describedBy, touch, className }: DateAnchorInputProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  // What is typed; null while not typing — the stored end shows.
  const [draft, setDraft] = useState<string | null>(null)
  // The hint shows for unreadable text once the field was left (or ⏎ pressed), not while typing.
  const [showHint, setShowHint] = useState(false)
  const stored = relativeEndText(value)
  const text = draft ?? stored
  const unreadable = parseRelativeEnd(text) === 'invalid'

  const type = (next: string) => {
    setDraft(next)
    setShowHint(false)
    const read = parseRelativeEnd(next)
    if (read !== 'invalid' && !dateAnchorsEqual(read, value)) onChange(read)
  }
  const settle = () => {
    if (unreadable) setShowHint(true)
    else setDraft(null)
  }
  const pick = (next: DateAnchor | null) => {
    setDraft(null)
    setShowHint(false)
    onChange(next)
  }

  const rolling = ROLLING_DAYS[side]
  const extraToken = value?.kind === 'relative' && !rolling.includes(value.token) ? value.token : null
  const entries: MenuEntry[] = [
    { kind: 'label', text: 'Rolling day' },
    ...[...rolling, ...(extraToken ? [extraToken] : [])].map((t): MenuEntry => ({
      kind: 'item', label: rollingDayLabel(t), radio: true, checked: value?.kind === 'relative' && value.token === t,
      onSelect: () => pick({ kind: 'relative', token: t }),
    })),
    { kind: 'separator' },
    { kind: 'item', label: noEndText(side), radio: true, checked: value == null, onSelect: () => pick(null) },
  ]
  const hintId = `${describedBy ?? label}-hint`

  return (
    <div className={`${styles.relative} ${touch ? styles.touch : ''} ${className ?? ''}`}>
      <div className={styles.wrapper}>
        <input
          type="text"
          className={`${styles.field} ${styles.typed}`}
          value={text}
          placeholder={noEndText(side)}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => type(e.target.value)}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              settle()
            } else if (e.key === 'Escape' && draft !== null) {
              // Puts the stored end back; the popover around it stays open.
              e.preventDefault()
              e.stopPropagation()
              setDraft(null)
              setShowHint(false)
            }
          }}
          aria-label={label}
          aria-invalid={(unreadable && showHint) || undefined}
          aria-describedby={[describedBy, unreadable && showHint ? hintId : null].filter(Boolean).join(' ') || undefined}
          data-relative-end={side}
        />
        <button
          ref={ref}
          type="button"
          className={`${styles.field} ${styles.chevron} ${open ? styles.open : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${label}: rolling days`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDownIcon />
        </button>
      </div>
      {unreadable && showHint && <p id={hintId} className={styles.hint} role="alert">{RELATIVE_END_HINT}</p>}
      {open && (
        <MenuPopover anchorRef={ref} width={MENU_WIDTH_PX} label={`${label}: rolling days`} entries={entries} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
