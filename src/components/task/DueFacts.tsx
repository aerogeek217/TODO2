import { useRef, useState, type RefObject } from 'react'
import type { Interval } from '../../models'
import { NEXT_FOLLOWUP_PLACEHOLDER } from '../../hooks/use-followup-input'
import { useToday } from '../../hooks/use-today'
import { useSettingsStore } from '../../stores/settings-store'
import { factDateWords } from '../../utils/fact-dates'
import { describeRecurrence } from '../../utils/recurrence'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { RepeatGlyph } from '../shared/CommandIcons'
import followupStyles from '../shared/followup/Followup.module.css'
import { usePopoverFocus, useReturnFocus } from '../shared/use-popover-focus'
import { RepeatField } from './RepeatField'
import { FactSection } from './TaskFacts'
import { TypedDateField } from './TypedDateField'
import { useTypedDate } from './use-typed-date'
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
 * and the review card alike), on two short lines. The first is a typed date
 * field as the follow-up fields are (`TypedDateField`): at rest the date in
 * the rows' words (`Today`, `Fri`, `11/24`, coloured late / soon; its
 * tooltip the full date) or `None`; typed `fri`, `11/30` or `2w`, written
 * when the field is left; × (**Clear due date**, on hover and focus), the
 * **↻** repeat button while there is a date, and the calendar, opening the
 * browser's picker in one click. Under it how far the date is (`in 2 days`,
 * `3 days late`), muted — while typing, what the text means. The two lines
 * are kept without a date, so setting or clearing it never changes the
 * band's height.
 */
export function DueFacts({ deadline, repeat, onDeadlineChange, onRepeatChange, tone }: DueFactsProps) {
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)
  const entry = useTypedDate({ value: deadline ?? undefined, mode: 'next', onChange: onDeadlineChange })
  const repeatRef = useRef<HTMLButtonElement>(null)
  const [repeatOpen, setRepeatOpen] = useState(false)
  // Back on the ↻ once the popover goes, when the focus went with it.
  useReturnFocus(repeatOpen, repeatRef)

  const words = deadline ? factDateWords(deadline, today, rowDates, 'due') : null
  const repeatWords = deadline && repeat ? describeRecurrence({ every: repeat }, deadline) : null
  const under = entry.helpTitle ?? words?.relative

  return (
    <FactSection fact="due">
      <div className={styles.dateValue}>
        <TypedDateField
          entry={entry}
          label="Due date"
          placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
          date={deadline ?? undefined}
          kind="due"
          empty="None"
          words={words ? <span className={styles.dateWords} data-tone={tone ? `due-${tone}` : undefined}>{words.words}</span> : undefined}
          fill
          clear={{ label: 'Clear due date' }}
          pick={{ label: 'Pick due date' }}
          extra={deadline && (
            <button
              ref={repeatRef}
              type="button"
              className={`${followupStyles.inputClear} ${styles.repeatButton}`}
              aria-label={repeatWords ? `Repeat: ${repeatWords}` : 'Repeat'}
              aria-haspopup="dialog"
              aria-expanded={repeatOpen}
              data-tooltip={repeatWords ?? 'Repeat'}
              data-on={repeatWords ? '' : undefined}
              data-due-repeat={repeatWords ? '' : undefined}
              onClick={() => setRepeatOpen((v) => !v)}
            >
              <RepeatGlyph />
            </button>
          )}
        />
        <span className={styles.dateUnder} data-date-under="" data-tooltip={under} aria-live="polite">
          {entry.help ?? words?.relative}
        </span>
      </div>
      {repeatOpen && deadline && (
        <RepeatPopover
          anchorRef={repeatRef}
          deadline={deadline}
          repeat={repeat}
          onRepeatChange={onRepeatChange}
          onClose={() => setRepeatOpen(false)}
        />
      )}
    </FactSection>
  )
}

/**
 * The Due field's repeat popover (the app's `AnchoredPicker`, a small
 * dialog named `Repeat`, under the ↻): **Repeat every** (`RepeatField`,
 * which writes what was typed however the popover closes; ⏎ writes and
 * closes) and, while the task repeats, **Stop repeating** (after which
 * nothing typed is written). The focus moves in on open, Tab stays inside,
 * and on close it goes back to the ↻.
 */
function RepeatPopover({ anchorRef, deadline, repeat, onRepeatChange, onClose }: {
  anchorRef: RefObject<HTMLButtonElement | null>
  deadline: Date
  repeat: Interval | null
  onRepeatChange: (every: Interval | null) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onTab = usePopoverFocus({ open: true, panelRef, triggerRef: anchorRef })
  // Read synchronously: after Stop repeating, the field's write on close writes nothing.
  const stoppedRef = useRef(false)
  const stop = () => {
    stoppedRef.current = true
    onRepeatChange(null)
    onClose()
  }
  const change = (every: Interval | null) => { if (!stoppedRef.current) onRepeatChange(every) }

  return (
    <AnchoredPicker anchorRef={anchorRef} onClose={onClose} closeOnEscape dialogLabel="Repeat">
      <div ref={panelRef} className={styles.repeatPopover} data-repeat-popover="" onKeyDown={onTab}>
        <RepeatField value={repeat} due={deadline} onChange={change} onDone={onClose} />
        {repeat && (
          <div className={styles.repeatPopFoot}>
            <button type="button" className={styles.repeatStop} onClick={stop}>Stop repeating</button>
          </div>
        )}
      </div>
    </AnchoredPicker>
  )
}
