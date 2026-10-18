import { useState } from 'react'
import {
  formatFollowupDate,
  isFutureDay,
  parseFollowupInput,
  relativeDayPhrase,
} from '../utils/followup'

export type FollowupInputMode = 'next' | 'last'

/** What the input currently means. `unchanged` = showing the stored value. */
export type FollowupInputState =
  | { kind: 'unchanged' }
  | { kind: 'empty' }
  | { kind: 'valid'; date: Date }
  | { kind: 'invalid'; message: string }

export const NEXT_FOLLOWUP_PLACEHOLDER = '2w, 1m, fri or a date'
export const NEXT_FOLLOWUP_INVALID = 'Try 2w, 10d, 1m, fri, 24 Oct or 10/24'
const LAST_FOLLOWUP_INVALID = 'Try a date like 24 Sep, 9/24 or yesterday'
const LAST_FOLLOWUP_FUTURE = "Last follow-up can't be in the future"

/** Interpret `text` for a next- or last-follow-up input (pure; exported for tests). */
export function interpretFollowupText(
  text: string,
  mode: FollowupInputMode,
  today: Date,
): Exclude<FollowupInputState, { kind: 'unchanged' }> {
  const parsed = parseFollowupInput(text, today, mode === 'last' ? 'past' : 'future')
  if (parsed.kind === 'empty') return { kind: 'empty' }
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid', message: mode === 'next' ? NEXT_FOLLOWUP_INVALID : LAST_FOLLOWUP_INVALID }
  }
  if (mode === 'last') {
    // Last follow-up takes dates only — an interval counts forward from today.
    if (parsed.interval) return { kind: 'invalid', message: LAST_FOLLOWUP_INVALID }
    if (isFutureDay(parsed.date, today)) return { kind: 'invalid', message: LAST_FOLLOWUP_FUTURE }
  }
  return { kind: 'valid', date: parsed.date }
}

/**
 * Text state for a follow-up date input (the row popover and the task
 * editor). Shows the stored value as `Tue 13 Oct`; once the user types, the
 * text is parsed live (`2w`, `fri`, `24 Oct`, …). Re-syncs to the stored value
 * during render when it changes underneath a clean input.
 */
export function useFollowupInput(value: Date | undefined, mode: FollowupInputMode, today: Date) {
  const display = value ? formatFollowupDate(value, today) : ''
  const [text, setText] = useState(display)
  const [dirty, setDirty] = useState(false)
  const [syncedDisplay, setSyncedDisplay] = useState(display)
  if (display !== syncedDisplay) {
    setSyncedDisplay(display)
    if (!dirty) setText(display)
  }

  const state: FollowupInputState = dirty ? interpretFollowupText(text, mode, today) : { kind: 'unchanged' }

  return {
    text,
    dirty,
    state,
    /** Relative phrase for the stored value (`in 3 days`, `4 weeks ago`), or null. */
    storedHint: value ? relativeDayPhrase(value, today) : null,
    change(next: string) {
      setText(next)
      setDirty(true)
    },
    /** Back to the stored value (Esc, or after a commit). */
    reset() {
      setText(display)
      setDirty(false)
    },
    /** After committing `date`, show it as clean text without waiting for the store round-trip. */
    settle(date: Date | null) {
      const shown = date ? formatFollowupDate(date, today) : ''
      setText(shown)
      setSyncedDisplay(shown)
      setDirty(false)
    },
  }
}
