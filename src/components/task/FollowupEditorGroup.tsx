import { NEXT_FOLLOWUP_PLACEHOLDER } from '../../hooks/use-followup-input'
import { useSelectAllOnFocus } from '../../hooks/use-select-all-on-focus'
import { useToday } from '../../hooks/use-today'
import { addFollowupInterval } from '../../utils/followup'
import type { FactDateTone } from './TaskFacts'
import { TaskFollowupFields } from './TaskFollowupFields'
import { TypedDateField } from './TypedDateField'
import { useTypedDate } from './use-typed-date'
import { FollowupQuickButtons } from '../shared/followup/FollowupQuickButtons'
import styles from '../shared/followup/Followup.module.css'

interface FollowupEditorGroupProps {
  next: Date | undefined
  last: Date | undefined
  onNextChange: (date: Date | null) => void
  onLastChange: (date: Date | null) => void
  /** The next follow-up's state, as its row colours it (late, today). */
  nextTone?: FactDateTone
  /** After the Next field while it shows the stored value (create mode: `Default · 1 month`). */
  nextHint?: string
  /** Focus (click, Tab) selects the Next field's text — create mode, while it shows the untouched default. */
  selectNextOnFocus?: boolean
  /** Hides the Last row (a draft task has no history). */
  hideLast?: boolean
}

/**
 * The task editor's follow-up fields, in its footer before Mark followed up
 * (task layout B; `TaskFollowupFields` draws them): **Last** (a date, never
 * in the future; the calendar), then **Next** — the date in the rows' words
 * at rest, typed entry on a click or the focus (an interval or a date; ×
 * clears, the calendar picks), then the quick intervals (Settings › Tasks); their
 * help lines in the footer's spare room. ⏎ / Tab / blur commit; Esc reverts;
 * invalid input keeps the old value until fixed.
 */
export function FollowupEditorGroup({
  next, last, onNextChange, onLastChange, nextTone, nextHint, selectNextOnFocus = false,
  hideLast = false,
}: FollowupEditorGroupProps) {
  const today = useToday()
  const nextEntry = useTypedDate({ value: next, mode: 'next', onChange: onNextChange })
  const lastEntry = useTypedDate({ value: last, mode: 'last', onChange: onLastChange })
  const selectNext = useSelectAllOnFocus(selectNextOnFocus)

  return (
    <TaskFollowupFields
      next={{
        field: (
          <TypedDateField
            entry={nextEntry}
            label="Next follow-up"
            placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
            date={next}
            kind="next"
            tone={nextTone}
            empty="None"
            clear={{ label: 'Clear next follow-up' }}
            pick={{ label: 'Pick next follow-up date' }}
            selectOnFocus={selectNext}
          />
        ),
        quick: (
          <FollowupQuickButtons
            labelStyle="short"
            onPick={(i) => nextEntry.set(addFollowupInterval(today, i))}
          />
        ),
        help: (
          <span className={styles.rowHelp} aria-live="polite">
            {nextEntry.input.dirty
              ? nextEntry.help
              : nextHint && <span className={styles.editorHint} data-tooltip={nextHint}>{nextHint}</span>}
          </span>
        ),
      }}
      last={hideLast ? undefined : {
        field: (
          <TypedDateField
            entry={lastEntry}
            label="Last follow-up"
            placeholder="Never"
            date={last}
            kind="last"
            empty="Never"
            pick={{ label: 'Pick last follow-up date', max: today }}
          />
        ),
        help: (
          <span className={styles.rowHelp} aria-live="polite">
            {lastEntry.help}
          </span>
        ),
      }}
    />
  )
}
