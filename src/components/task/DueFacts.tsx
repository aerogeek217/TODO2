import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Interval } from '../../models'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useToday } from '../../hooks/use-today'
import { useSettingsStore } from '../../stores/settings-store'
import { toDateInputValue } from '../../utils/date'
import { factDateWords } from '../../utils/fact-dates'
import { describeRecurrence } from '../../utils/recurrence'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { RepeatGlyph } from '../shared/CommandIcons'
import { RemoveButton } from '../shared/RemoveButton'
import { usePopoverFocus, useReturnFocus } from '../shared/use-popover-focus'
import { RepeatField } from './RepeatField'
import { FactSection } from './TaskFacts'
import styles from './TaskDetails.module.css'

interface DueFactsProps {
  deadline: Date | null
  /** The repeat (schema v84); null for none. */
  repeat: Interval | null
  onDeadlineChange: (next: Date | null) => void
  /** A new repeat typed (`RepeatField`: only when it changed; null removes it). */
  onRepeatChange: (every: Interval | null) => void
  /** The due date's state, as its row colours it (`row-date-state.dueState`): `past` bold in the late colour, `soon` in it. */
  tone?: 'past' | 'soon'
}

/**
 * **Due**, the fact band's cell after Tags (task layout B — the task editor
 * and the review card alike), on two short lines: the date in the rows'
 * words (`Today`, `Fri`, `11/24`; its tooltip the full date), the rows'
 * repeat glyph while it repeats (its name the rule in words, `Every 2
 * weeks`) and × to clear; under it how far the date is (`in 2 days`, `3 days
 * late`), muted, cut with an ellipsis (whole in its tooltip). The date — or,
 * without one, `Set a date` — opens the date popover (`DueDatePopover`):
 * the date, its repeat, Clear due date. The two lines are kept without a
 * date, so setting or clearing it never changes the band's height.
 */
export function DueFacts({ deadline, repeat, onDeadlineChange, onRepeatChange, tone }: DueFactsProps) {
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // Back on the date once the popover goes, when the focus went with it.
  useReturnFocus(open, triggerRef)

  const words = deadline ? factDateWords(deadline, today, rowDates, 'due') : null
  const repeatWords = deadline && repeat ? describeRecurrence({ every: repeat }, deadline) : null

  return (
    <FactSection fact="due">
      <div className={styles.dateValue}>
        <div className={styles.dateLine}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.dateButton}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={words ? `Due date: ${words.full}` : 'Set due date'}
            data-tooltip={words ? `Due ${words.full}` : 'Set due date'}
            onClick={() => setOpen((v) => !v)}
          >
            {words
              ? <span className={styles.dateWords} data-tone={tone ? `due-${tone}` : undefined}>{words.words}</span>
              : <span className={styles.dateEmpty}>Set a date</span>}
          </button>
          {repeatWords && (
            <span className={styles.dateRepeat} role="img" aria-label={repeatWords} data-tooltip={repeatWords} data-due-repeat="">
              <RepeatGlyph />
            </span>
          )}
          {deadline && (
            <RemoveButton size={20} label="Clear due date" tooltip onClick={() => onDeadlineChange(null)} />
          )}
        </div>
        <span className={styles.dateUnder} data-date-under="" data-tooltip={words?.relative}>{words?.relative}</span>
      </div>
      {open && (
        <DueDatePopover
          anchorRef={triggerRef}
          deadline={deadline}
          repeat={repeat}
          onDeadlineChange={onDeadlineChange}
          onRepeatChange={onRepeatChange}
          onClose={() => setOpen(false)}
        />
      )}
    </FactSection>
  )
}

/** A date input's value as a day (`2026-11-24` → that day at midnight), or null while it holds none. */
function dayOf(value: string): Date | null {
  return value ? new Date(`${value}T00:00:00`) : null
}

/**
 * The Due cell's date popover (the app's `AnchoredPicker`, a small dialog
 * named `Due date`, under the date): **Date** — the date input, its calendar
 * button opening the browser's picker —, **Repeat every** (`RepeatField`,
 * while there is a date) and **Clear due date**. The date is written when
 * the field is left, on ⏎ (which closes the popover too) and however the
 * popover closes — what was typed is kept (the popover rule); a field left
 * empty or half typed writes nothing. The focus moves in on open, Tab stays
 * inside, and on close it goes back to the date (`DueFacts`).
 */
function DueDatePopover({ anchorRef, deadline, repeat, onDeadlineChange, onRepeatChange, onClose }: {
  anchorRef: RefObject<HTMLButtonElement | null>
  deadline: Date | null
  repeat: Interval | null
  onDeadlineChange: (next: Date | null) => void
  onRepeatChange: (every: Interval | null) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onTab = usePopoverFocus({ open: true, panelRef, triggerRef: anchorRef })
  // What the date input holds while it differs from the stored date; null: the stored date shows.
  const [draft, setDraft] = useState<string | null>(null)
  // Read synchronously: a write and a close in one event (⏎) never write twice, and Clear writes nothing after.
  const pendingRef = useRef(false)
  const clearedRef = useRef(false)
  const shown = draft ?? toDateInputValue(deadline ?? undefined)
  const dueShown = dayOf(shown) ?? deadline

  const writeDate = (value: string) => {
    pendingRef.current = false
    const next = dayOf(value)
    // Empty or half typed: nothing to write (Clear due date and × clear it).
    if (!next || Number.isNaN(next.getTime())) return
    if (deadline && next.getTime() === deadline.getTime()) return
    onDeadlineChange(next)
  }
  const commit = () => {
    if (draft == null) return
    setDraft(null)
    writeDate(draft)
  }
  const commitOnCloseRef = useLatestRef(() => {
    if (pendingRef.current && draft != null && !clearedRef.current) writeDate(draft)
  })
  useEffect(() => () => commitOnCloseRef.current(), [commitOnCloseRef])

  const clear = () => {
    clearedRef.current = true
    pendingRef.current = false
    onDeadlineChange(null)
    onClose()
  }
  // After Clear due date nothing typed in the repeat is written either.
  const repeatChange = (every: Interval | null) => { if (!clearedRef.current) onRepeatChange(every) }

  return (
    <AnchoredPicker anchorRef={anchorRef} onClose={onClose} closeOnEscape dialogLabel="Due date">
      <div ref={panelRef} className={styles.duePopover} data-due-popover="" onKeyDown={onTab}>
        <label className={styles.duePopRow}>
          <span className={styles.duePopLabel}>Date</span>
          <input
            type="date"
            className={styles.duePopDate}
            value={shown}
            aria-label="Date"
            onChange={(e) => { pendingRef.current = true; setDraft(e.target.value) }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              commit()
              onClose()
            }}
          />
        </label>
        {dueShown && (
          <RepeatField value={repeat} due={dueShown} onChange={repeatChange} onDone={onClose} />
        )}
        {deadline && (
          <div className={styles.duePopFoot}>
            <button type="button" className={styles.duePopClear} onClick={clear}>Clear due date</button>
          </div>
        )}
      </div>
    </AnchoredPicker>
  )
}
