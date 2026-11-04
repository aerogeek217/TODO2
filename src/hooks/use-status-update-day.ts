import { useFollowupInput } from './use-followup-input'

const FUTURE_MESSAGE = "A status update can't be in the future"

/**
 * A status update's day field's state: the Last follow-up field's
 * (`useFollowupInput`, `last` — words or a date, never after today), plus
 * the day it says: what it typed, the stored `value` while untouched, today
 * while empty, `'invalid'` while the text is no such day.
 */
export function useStatusUpdateDay(value: Date | undefined, today: Date) {
  const input = useFollowupInput(value, 'last', today, { futureMessage: FUTURE_MESSAGE })
  const s = input.state
  const day: Date | 'invalid' = s.kind === 'valid' ? s.date
    : s.kind === 'invalid' ? 'invalid'
      : s.kind === 'empty' ? today
        : (value ?? today)
  return { ...input, day }
}

export type StatusUpdateDayInput = ReturnType<typeof useStatusUpdateDay>
