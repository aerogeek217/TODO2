import { useFollowupInput } from '../../../hooks/use-followup-input'
import { autoNextFollowup, useSettingsStore } from '../../../stores/settings-store'
import { startOfDay } from '../../../utils/date'
import { formatFollowupDate, nextAfterFollowup } from '../../../utils/followup'

/** Same day, or both none. */
export function sameDay(a: Date | null, b: Date | null): boolean {
  return (a ? startOfDay(a).getTime() : null) === (b ? startOfDay(b).getTime() : null)
}

/**
 * The Next follow-up field beside a Mark followed up button — the follow-up
 * popover's and a review card's (cr34 A4): it starts on what Mark followed
 * up would leave (`ruled`: the store's rule — a date after today kept, else
 * Settings' automatic one, `proposal`; a mixed selection: nothing, each
 * task's own), and reads back as a date, none (empty) or `invalid`.
 * - `kept`: Mark followed up keeps the next follow-up there is (while the
 *   field is untouched).
 * - `differs`: ⏎ in the field has something to set — its date isn't the
 *   one there is now (mixed: something was typed). Meaningless while invalid.
 * - `followUpNext`: the next follow-up Mark followed up passes — none while
 *   the field is untouched (the store's rule decides per task), else the
 *   field's date (null clears it).
 */
export function useNextFollowupField(current: Date | null | 'mixed', today: Date) {
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)
  const followupDefaultInterval = useSettingsStore((s) => s.followupDefaultInterval)
  const proposal = autoNextFollowup(today, { autoFollowup, followupDefaultInterval })
  const mixed = current === 'mixed'
  const ruled = mixed ? null : nextAfterFollowup(current, today, proposal)
  const kept = !mixed && current !== null && ruled === current
  const input = useFollowupInput(ruled ?? undefined, 'next', today)
  const s = input.state
  const untouched = s.kind === 'unchanged'
  const fieldDate: Date | null | 'invalid' =
    untouched ? ruled : s.kind === 'empty' ? null : s.kind === 'valid' ? s.date : 'invalid'
  const differs = mixed ? !untouched : fieldDate !== 'invalid' && !sameDay(fieldDate, current as Date | null)
  const followUpNext: Date | null | undefined = untouched || fieldDate === 'invalid' ? undefined : fieldDate
  return { input, proposal, ruled, mixed, kept, untouched, fieldDate, differs, followUpNext }
}

/**
 * What Mark followed up will do, for its tooltip: keep, set or clear the next
 * follow-up. `nameDate`: a set date is named (`… set the next follow-up to
 * Fri 11/20`) and a field that doesn't read says so (a review card); else
 * the date is `the date above` (the follow-up popover).
 */
export function followedUpWords({ untouched, mixed, kept, fieldDate, current, proposal, today, nameDate }: {
  untouched: boolean
  mixed: boolean
  kept: boolean
  fieldDate: Date | null | 'invalid'
  current: Date | null | 'mixed'
  proposal: Date | null
  today: Date
  nameDate: boolean
}): string {
  if (nameDate && fieldDate === 'invalid') return 'Fix the next follow-up date first'
  if (untouched && mixed) {
    return proposal
      ? `Record a follow-up today; future next follow-ups are kept, the rest set to ${formatFollowupDate(proposal, today)}`
      : 'Record a follow-up today; future next follow-ups are kept, the rest cleared'
  }
  if (untouched && kept) return 'Record a follow-up today and keep the next follow-up'
  if (fieldDate === null) {
    return current === null
      ? 'Record a follow-up today (no next follow-up)'
      : 'Record a follow-up today and clear the next follow-up'
  }
  return nameDate && fieldDate !== 'invalid'
    ? `Record a follow-up today and set the next follow-up to ${formatFollowupDate(fieldDate, today)}`
    : 'Record a follow-up today and set the next follow-up to the date above'
}
