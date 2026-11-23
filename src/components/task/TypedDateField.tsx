import type { ReactNode } from 'react'
import type { useSelectAllOnFocus } from '../../hooks/use-select-all-on-focus'
import type { FactDateKind } from '../../utils/fact-dates'
import { FollowupDateButton } from '../shared/followup/FollowupDateButton'
import styles from '../shared/followup/Followup.module.css'
import { RemoveButton } from '../shared/RemoveButton'
import { FactDateField, type FactDateTone } from './TaskFacts'
import type { TypedDate } from './use-typed-date'

/**
 * A typed date field in the one date look (`FactDateField`): the input,
 * its × (`clear`: while it holds text, or while `clear.shown` says so; it
 * keeps the focus where it is), the host's own buttons (`extra`, Due's ↻)
 * and the calendar (`FollowupDateButton`: one click opens the browser's
 * picker, `min` / `max` its range). Its help line is the host's to place
 * (`entry.help`).
 */
export function TypedDateField({
  entry, label, placeholder, date, kind, tone, empty, words, fill, clear, pick, extra, selectOnFocus, testId,
}: {
  entry: TypedDate
  /** The input's accessible name (`Next follow-up`, `Due date`). */
  label: string
  placeholder: string
  /** The date the words at rest show (and the calendar opens on). */
  date: Date | undefined
  kind: FactDateKind
  tone?: FactDateTone
  empty: string
  words?: ReactNode
  fill?: boolean
  /** The × (writes null) — none without. `shown`: also while the field is empty (Planned's held state). */
  clear?: { label: string; shown?: boolean }
  pick: { label: string; min?: Date; max?: Date }
  /** Buttons between the × and the calendar (Due's ↻). */
  extra?: ReactNode
  /** Focus selects the text (create mode's untouched default Next). */
  selectOnFocus?: ReturnType<typeof useSelectAllOnFocus>
  testId?: string
}) {
  const { input, inputProps, set } = entry
  return (
    <FactDateField
      date={date}
      kind={kind}
      tone={tone}
      empty={empty}
      words={words}
      showWords={!input.dirty}
      fill={fill}
      ends={extra ? 2 : 1}
      testId={testId}
    >
      <div className={`${styles.editorInputWrap} ${entry.invalid ? styles.inputWrapError : ''}`}>
        <input
          className={styles.input}
          placeholder={placeholder}
          {...inputProps}
          onMouseDown={selectOnFocus?.onMouseDown}
          onMouseUp={selectOnFocus?.onMouseUp}
          onFocus={(e) => { inputProps.onFocus(); selectOnFocus?.onFocus(e) }}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
        />
        {clear && (input.text !== '' || clear.shown) && (
          <RemoveButton
            size={24}
            className={styles.inputClear}
            label={clear.label}
            tooltip
            data-field-clear=""
            // Keep the input's blur from committing the text we're about to clear.
            keepFocus
            onClick={() => set(null)}
          />
        )}
        {extra}
        <FollowupDateButton label={pick.label} value={date} min={pick.min} max={pick.max} onPick={set} />
      </div>
    </FactDateField>
  )
}
