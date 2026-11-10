import { useRef } from 'react'
import { useFollowupInput, NEXT_FOLLOWUP_PLACEHOLDER, type FollowupInputState } from '../../hooks/use-followup-input'
import { useSelectAllOnFocus } from '../../hooks/use-select-all-on-focus'
import { useToday } from '../../hooks/use-today'
import { addFollowupInterval, formatFollowupDate, relativeDayPhrase, QUICK_FOLLOWUP_INTERVALS } from '../../utils/followup'
import { startOfDay } from '../../utils/date'
import { FactDateField, FactRow, type FactDateTone } from './TaskFacts'
import { FollowupDateButton } from '../shared/followup/FollowupDateButton'
import { FollowupQuickButtons } from '../shared/followup/FollowupQuickButtons'
import { MarkFollowedUpButton } from '../shared/followup/MarkFollowedUpButton'
import styles from '../shared/followup/Followup.module.css'

interface FollowupEditorGroupProps {
  next: Date | undefined
  last: Date | undefined
  onNextChange: (date: Date | null) => void
  onLastChange: (date: Date | null) => void
  onFollowedUp: () => void
  /** The next follow-up's state, as its row colours it (late, today). */
  nextTone?: FactDateTone
  /** Under the Next field while it shows the stored value (create mode: `Default · 1 month`). */
  nextHint?: string
  /** Focus (click, Tab) selects the Next field's text — create mode, while it shows the untouched default. */
  selectNextOnFocus?: boolean
  /** Hides the Last row and the Mark followed up button (a draft task has no history). */
  hideLast?: boolean
}

/** What a field's typed text means, under it: `→ Mon 16 Nov · in 7 days`, or why it isn't a date. */
function HelpText({ state, today }: { state: FollowupInputState; today: Date }) {
  if (state.kind === 'invalid') return <span className={`${styles.editorHint} ${styles.helpError}`}>{state.message}</span>
  if (state.kind === 'valid') {
    return (
      <span className={styles.editorHint}>
        → <strong className={styles.helpDate}>{formatFollowupDate(state.date, today)}</strong>
        {' · '}{relativeDayPhrase(state.date, today)}
      </span>
    )
  }
  return null
}

/**
 * The task editor's Follow-up rows, in the facts rail's yellow box (board
 * BJ; the host's `FollowupFacts` draws the box and its header): **Next** —
 * the date in the rows' words at rest, typed entry on a click or the focus
 * (an interval or a date; × clears, the calendar picks), then the quick
 * intervals 1w 2w 1m 3m; **Last** (a date, never in the future; the
 * calendar); then **Mark followed up**. ⏎ / Tab / blur commit; Esc
 * reverts; invalid input keeps the old value until fixed.
 */
export function FollowupEditorGroup({
  next, last, onNextChange, onLastChange, onFollowedUp, nextTone, nextHint, selectNextOnFocus = false,
  hideLast = false,
}: FollowupEditorGroupProps) {
  const today = useToday()
  const nextInput = useFollowupInput(next, 'next', today)
  const lastInput = useFollowupInput(last, 'last', today)
  const skipCommitRef = useRef(false)
  const selectNext = useSelectAllOnFocus(selectNextOnFocus)

  const commit = (input: typeof nextInput, onChange: (d: Date | null) => void) => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }
    const s = input.state
    if (s.kind === 'empty') {
      onChange(null)
      input.settle(null)
    } else if (s.kind === 'valid') {
      onChange(s.date)
      input.settle(s.date)
    }
  }

  const keyHandler = (input: typeof nextInput) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      // Revert without committing; keep the editor open.
      e.preventDefault()
      e.stopPropagation()
      skipCommitRef.current = true
      input.reset()
      e.currentTarget.blur()
    }
  }

  const lastIsToday = !!last && startOfDay(last).getTime() === today.getTime()

  return (
    <>
      <FactRow label="Next">
        <FactDateField date={next} kind="next" tone={nextTone} empty="None" showWords={!nextInput.dirty}>
          <div className={`${styles.editorInputWrap} ${nextInput.state.kind === 'invalid' ? styles.inputWrapError : ''}`}>
            <input
              className={styles.input}
              value={nextInput.text}
              placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
              onChange={(e) => { skipCommitRef.current = false; nextInput.change(e.target.value) }}
              onMouseDown={selectNext.onMouseDown}
              onMouseUp={selectNext.onMouseUp}
              onFocus={(e) => { skipCommitRef.current = false; selectNext.onFocus(e) }}
              onBlur={() => commit(nextInput, onNextChange)}
              onKeyDown={keyHandler(nextInput)}
              aria-label="Next follow-up"
              aria-invalid={nextInput.state.kind === 'invalid'}
              autoComplete="off"
              spellCheck={false}
            />
            {nextInput.text !== '' && (
              <button
                type="button"
                className={styles.inputClear}
                aria-label="Clear next follow-up"
                title="Clear next follow-up"
                // Keep the input's blur from committing the text we're about to clear.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onNextChange(null); nextInput.settle(null) }}
              >
                &times;
              </button>
            )}
            <FollowupDateButton
              label="Pick next follow-up date"
              value={next}
              onPick={(d) => { onNextChange(d); nextInput.settle(d) }}
            />
          </div>
        </FactDateField>
      </FactRow>
      <div className={styles.factIndent}>
        {nextInput.dirty
          ? <HelpText state={nextInput.state} today={today} />
          : nextHint && <span className={styles.editorHint}>{nextHint}</span>}
        <FollowupQuickButtons
          intervals={QUICK_FOLLOWUP_INTERVALS}
          labelStyle="short"
          onPick={(i) => {
            const d = addFollowupInterval(today, i)
            onNextChange(d)
            nextInput.settle(d)
          }}
        />
      </div>

      {!hideLast && (
        <>
          <FactRow label="Last">
            <FactDateField date={last} kind="last" empty="Never" showWords={!lastInput.dirty}>
              <div className={`${styles.editorInputWrap} ${lastInput.state.kind === 'invalid' ? styles.inputWrapError : ''}`}>
                <input
                  className={styles.input}
                  value={lastInput.text}
                  placeholder="Never"
                  onChange={(e) => { skipCommitRef.current = false; lastInput.change(e.target.value) }}
                  onFocus={() => { skipCommitRef.current = false }}
                  onBlur={() => commit(lastInput, onLastChange)}
                  onKeyDown={keyHandler(lastInput)}
                  aria-label="Last follow-up"
                  aria-invalid={lastInput.state.kind === 'invalid'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FollowupDateButton
                  label="Pick last follow-up date"
                  value={last}
                  max={today}
                  onPick={(d) => { onLastChange(d); lastInput.settle(d) }}
                />
              </div>
            </FactDateField>
          </FactRow>
          {lastInput.dirty && (
            <div className={styles.factIndent}>
              <HelpText state={lastInput.state} today={today} />
            </div>
          )}
          <MarkFollowedUpButton fullWidth doneToday={lastIsToday} onClick={onFollowedUp} />
        </>
      )}
    </>
  )
}
