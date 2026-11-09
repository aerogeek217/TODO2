import type { NumberCompare } from '../../../models/glance-widgets'
import type { NumberOldestBy } from '../../../models/number-shapes'
import type { GoalProgress } from '../../../services/stats/number-shapes'
import { formatDateWith } from '../../../utils/date'
import { signed } from './glance-copy'

/**
 * A Number's shapes' words (D26 P6, board Y): a share's change, an oldest
 * task's age, a goal's standing. Pure, so the copy is testable on its own.
 */

const plural = (n: number, one: string, many = `${one}s`) => (Math.abs(n) === 1 ? one : many)

/** `20 of 109`. */
export function shareOfLabel(part: number, whole: number): string {
  return `${part} of ${whole}`
}

/** A share's headline: `18%`, or `—` with nothing in the whole. */
export function percentLabel(percent: number | null): string {
  return percent == null ? '—' : `${percent}%`
}

/** A share's change in points: `+4 pts vs yesterday`, `No change vs last Wed`. */
export function shareDeltaLabel(delta: number, against: Exclude<NumberCompare, 'none'>, today?: Date): string {
  const then = against === 'lastWeek' && today ? `last ${formatDateWith(today, { weekday: 'short' })}` : 'yesterday'
  return delta === 0 ? `No change vs ${then}` : `${signed(delta)} ${plural(delta, 'pt')} vs ${then}`
}

/**
 * An oldest task's age, as its figure and what it is: `19` · `days since
 * last follow-up`; by due date, `3` · `days overdue`, `due today` (0) or
 * `days until due` (a due date still ahead).
 */
export function oldestAge(days: number, by: NumberOldestBy): { figure: string; caption: string } {
  const n = Math.abs(days)
  const d = plural(n, 'day')
  switch (by) {
    case 'lastFollowup': return { figure: String(days), caption: `${d} since last follow-up` }
    case 'created': return { figure: String(days), caption: `${d} old` }
    case 'modified': return { figure: String(days), caption: `${d} untouched` }
    case 'deadline':
      if (days === 0) return { figure: '0', caption: 'due today' }
      return days > 0 ? { figure: String(n), caption: `${d} overdue` } : { figure: String(n), caption: `${d} until due` }
  }
}

/** An Oldest's foot: `12 · median 6 days` (`12` alone without a median). */
export function oldestFoot(count: number, median: number | null): string {
  return median == null ? String(count) : `${count} · median ${median} ${plural(median, 'day')}`
}

/** A goal's figure after the count: `/ 12`. */
export function goalTargetLabel(target: number): string {
  return `/ ${target}`
}

/**
 * Where a goal stands: `Goal met`, `On pace (Thu)` / `Behind pace (Thu)`
 * (a weekly goal, today's weekday), `3 to go`, `Within the limit`,
 * `2 over the limit`.
 */
export function goalStateLabel(progress: Pick<GoalProgress, 'state' | 'target' | 'pace'>, count: number, today: Date): string {
  const day = formatDateWith(today, { weekday: 'short' })
  switch (progress.state) {
    case 'met': return 'Goal met'
    case 'onPace': return `On pace (${day})`
    case 'behind': return progress.pace != null ? `Behind pace (${day})` : `${progress.target - count} to go`
    case 'within': return 'Within the limit'
    case 'over': return `${count - progress.target} over the limit`
  }
}

/** The pace tick's tooltip: `Pace: 7 by the end of Thu`. */
export function paceLabel(pace: number, today: Date): string {
  return `Pace: ${Math.round(pace * 10) / 10} by the end of ${formatDateWith(today, { weekday: 'short' })}`
}

/** The date an Oldest ages by, inside a sentence. */
export const OLDEST_BY_WORDS: Record<NumberOldestBy, string> = {
  lastFollowup: 'last follow-up',
  created: 'created date',
  modified: 'last change',
  deadline: 'due date',
}
