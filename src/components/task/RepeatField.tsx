import { useEffect, useId, useRef, useState } from 'react'
import type { Interval } from '../../models'
import { ESCAPE_OWN_ATTR } from '../../hooks/use-popover-anchor'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { formatInterval, INTERVAL_HINT, intervalsEqual, parseInterval } from '../../utils/interval'
import { makeRecurrenceRule, repeatReadBack } from '../../utils/recurrence'
import styles from './TaskDetails.module.css'

/** Where the read-back's next date starts (`repeatReadBack`). */
const NEXT = ' · next '

/**
 * The due date's repeat, in the Due field's repeat popover (`DueFacts`;
 * the task editor's and the review card's; schema v84): `Repeat every [2w]`,
 * typed in the app's one interval grammar (`utils/interval`: a number and d,
 * w, m or y), read back under it — `Every 2 weeks · next Mon, Dec 7` (the
 * next due date completing the task gives), `No repeat` while empty. ⏎ or a
 * blur writes it (`onChange`, one undo step — only when it changed; an empty
 * field removes the repeat), and so does the popover closing any other way
 * (the popover rule); ⏎ then closes the popover (`onDone`). Esc puts the
 * stored text back and keeps the popover open (the field takes it while it
 * holds typed text); a second Esc closes the popover. A text that doesn't
 * read says how to write one and is never written: it stays in the field,
 * the stored repeat unchanged. While it isn't being typed in it follows the
 * stored repeat (an undo, an edit elsewhere).
 */
export function RepeatField({ value, due, onChange, onDone }: {
  /** The stored repeat; null for none. */
  value: Interval | null
  /** The due date it repeats from (its read-back's next date). */
  due: Date | null
  onChange: (every: Interval | null) => void
  /** ⏎ wrote it (or there was nothing to write): the popover closes. */
  onDone?: () => void
}) {
  // What is typed; null while not typing — the stored repeat shows.
  const [draft, setDraft] = useState<string | null>(null)
  // Typed and not yet written or put back — read synchronously, so a close in the same event as a write
  // (⏎ writes, then closes the popover) never writes twice.
  const dirtyRef = useRef(false)
  const hintId = useId()
  const stored = value ? formatInterval(value) : ''
  const text = draft ?? stored
  const typed = text.trim() === '' ? null : parseInterval(text)
  const unreadable = text.trim() !== '' && typed == null

  const commit = () => {
    if (draft == null || unreadable) return
    dirtyRef.current = false
    setDraft(null)
    if (!intervalsEqual(typed, value)) onChange(typed)
  }
  // The popover closing (a press outside, Esc after a write, the editor closing) writes what was typed.
  const commitOnCloseRef = useLatestRef(() => {
    if (!dirtyRef.current || unreadable) return
    dirtyRef.current = false
    if (!intervalsEqual(typed, value)) onChange(typed)
  })
  useEffect(() => () => commitOnCloseRef.current(), [commitOnCloseRef])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (unreadable) return
      commit()
      onDone?.()
    } else if (e.key === 'Escape' && draft != null) {
      // Puts the stored text back; the popover stays open (the field holds the Esc: `ESCAPE_OWN_ATTR`).
      e.preventDefault()
      e.stopPropagation()
      dirtyRef.current = false
      setDraft(null)
    }
  }

  // `Every 2 weeks · next Mon, Dec 7`, its next date in the text color.
  const readBackText = typed ? repeatReadBack(makeRecurrenceRule(typed, due), due) : 'No repeat'
  const [words, next] = readBackText.split(NEXT)
  const readBack = next == null ? words : <>{words}{NEXT}<b>{next}</b></>
  return (
    <div className={styles.repeat} data-repeat-field="">
      <label className={styles.repeatRow}>
        <span className={styles.repeatLabel}>Repeat</span>
        <span className={styles.repeatEvery}>every</span>
        <input
          className={styles.repeatInput}
          value={text}
          onChange={(e) => { dirtyRef.current = true; setDraft(e.target.value) }}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-label="Repeat every"
          aria-invalid={unreadable || undefined}
          aria-describedby={hintId}
          maxLength={8}
          spellCheck={false}
          autoComplete="off"
          data-testid="repeat-input"
          {...(draft != null ? { [ESCAPE_OWN_ATTR]: '' } : {})}
        />
      </label>
      {unreadable
        ? <span id={hintId} className={styles.repeatError} role="alert">{INTERVAL_HINT}</span>
        : <span id={hintId} className={styles.repeatReadBack} data-repeat-readback="" data-tooltip={readBackText}>{readBack}</span>}
    </div>
  )
}
