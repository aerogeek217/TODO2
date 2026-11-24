import { useRef } from 'react'
import { useFollowupInput, type FollowupInputOptions, type FollowupInputState } from '../../hooks/use-followup-input'
import { useToday } from '../../hooks/use-today'
import { formatFollowupDate, relativeDayPhrase } from '../../utils/followup'
import styles from '../shared/followup/Followup.module.css'

/** What a field's typed text means, in words (a help line's tooltip): `→ Mon 16 Nov · in 7 days`, or why it isn't a date. */
function helpWords(state: FollowupInputState, today: Date): string | undefined {
  if (state.kind === 'invalid') return state.message
  if (state.kind === 'valid') return `→ ${formatFollowupDate(state.date, today)} · ${relativeDayPhrase(state.date, today)}`
  return undefined
}

/** What a field's typed text means, after it: `→ Mon 16 Nov · in 7 days`, or why it isn't a date. */
function helpLine(state: FollowupInputState, today: Date) {
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
 * A typed date's entry (the task layout's date fields — the footer's Last
 * and Next follow-up, the band's Due and Planned): the text as
 * `useFollowupInput` reads it (`fri`, `11/30`, `2w`), written by `onChange`
 * when the field is left (⏎ and Tab leave it too) — a date, or null for an
 * emptied field; a text that doesn't read is kept, unwritten, until fixed —,
 * and Esc putting the stored text back (held there: the dialog stays open).
 * `set` writes a date picked or cleared at once. `help` is what the typed
 * text means, while typing; `helpTitle` the same in words.
 */
export function useTypedDate({ value, mode, options, onChange }: {
  value: Date | undefined
  mode: 'next' | 'last'
  options?: FollowupInputOptions
  onChange: (date: Date | null) => void
}) {
  const today = useToday()
  const input = useFollowupInput(value, mode, today, options)
  // Esc: the blur that follows writes nothing.
  const skipCommitRef = useRef(false)
  const set = (date: Date | null) => {
    onChange(date)
    input.settle(date)
  }
  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }
    const s = input.state
    if (s.kind === 'empty') set(null)
    else if (s.kind === 'valid') set(s.date)
  }
  const inputProps = {
    value: input.text,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => { skipCommitRef.current = false; input.change(e.target.value) },
    onFocus: () => { skipCommitRef.current = false },
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    },
    'aria-invalid': input.state.kind === 'invalid',
  }
  return {
    input,
    set,
    inputProps,
    invalid: input.state.kind === 'invalid',
    help: input.dirty ? helpLine(input.state, today) : null,
    helpTitle: input.dirty ? helpWords(input.state, today) : undefined,
  }
}

export type TypedDate = ReturnType<typeof useTypedDate>
