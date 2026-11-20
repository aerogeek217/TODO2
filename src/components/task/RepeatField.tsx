import { useId, useRef, useState } from 'react'
import type { Interval } from '../../models'
import { formatInterval, INTERVAL_HINT, intervalsEqual, parseInterval } from '../../utils/interval'
import { makeRecurrenceRule, repeatReadBack } from '../../utils/recurrence'
import { RepeatIcon } from '../shared/icons'
import styles from './TaskDetails.module.css'

/** Where the read-back's next date starts (`repeatReadBack`). */
const NEXT = ' · next '

/**
 * The Due cell's repeat (the task editor's and the review card's; schema
 * v84): `Repeat every [2w]`, typed in the app's one interval grammar
 * (`utils/interval`: a number and d, w, m or y), read back after it —
 * `Every 2 weeks · next Mon, Dec 7` (the next due date completing the task
 * gives), `No repeat` while empty. ⏎ or a blur writes it (`onChange`, one
 * undo step — only when it changed; an empty field removes the repeat); Esc
 * puts the stored text back. A text that doesn't read says how to write one
 * and is never written: it stays in the field, the stored repeat unchanged.
 * While it isn't being typed in it follows the stored repeat (an undo, an
 * edit elsewhere).
 */
export function RepeatField({ value, due, onChange }: {
  /** The stored repeat; null for none. */
  value: Interval | null
  /** The due date it repeats from (its read-back's next date). */
  due: Date | null
  onChange: (every: Interval | null) => void
}) {
  // What is typed; null while not typing — the stored repeat shows.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const hintId = useId()
  const stored = value ? formatInterval(value) : ''
  const text = draft ?? stored
  const typed = text.trim() === '' ? null : parseInterval(text)
  const unreadable = text.trim() !== '' && typed == null

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(null)
      return
    }
    if (draft == null || unreadable) return
    setDraft(null)
    if (!intervalsEqual(typed, value)) onChange(typed)
  }
  /** Leaves the field, which commits (its blur); not focused, there is no blur to wait for. */
  const leave = (el: HTMLInputElement) => {
    if (el.ownerDocument.activeElement === el) el.blur()
    else commit()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!unreadable) leave(e.currentTarget)
    } else if (e.key === 'Escape') {
      // Puts the stored text back; the editor's own Esc handling (leaving
      // the field) still runs, and no dialog around it closes.
      e.preventDefault()
      cancelRef.current = true
      leave(e.currentTarget)
    }
  }

  // `Every 2 weeks · next Mon, Dec 7`, its next date in the text color.
  const readBackText = typed ? repeatReadBack(makeRecurrenceRule(typed, due), due) : 'No repeat'
  const [words, next] = readBackText.split(NEXT)
  const readBack = next == null ? words : <>{words}{NEXT}<b>{next}</b></>
  return (
    <div className={styles.repeat} data-repeat-field="">
      <label className={styles.repeatLine}>
        <RepeatIcon size={11} />
        <span className={styles.repeatLabel}>Repeat every</span>
        <input
          className={styles.repeatInput}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label="Repeat every"
          aria-invalid={unreadable || undefined}
          aria-describedby={hintId}
          maxLength={8}
          spellCheck={false}
          autoComplete="off"
          data-testid="repeat-input"
        />
      </label>
      {unreadable
        ? <span id={hintId} className={styles.repeatError} role="alert">{INTERVAL_HINT}</span>
        : <span id={hintId} className={styles.repeatReadBack} data-repeat-readback="" data-tooltip={readBackText}>{readBack}</span>}
    </div>
  )
}
