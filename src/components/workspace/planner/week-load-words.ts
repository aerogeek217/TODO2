import { WEEK_LOAD_KINDS, type WeekLoad, type WeekLoadCounts, type WeekLoadDay, type WeekLoadKind, type WeekLoadWeek } from '../../../services/stats/week-load'
import { addDays } from '../../../utils/calendar-grid'
import { formatDateWith } from '../../../utils/date'
import { plannerDayLabel, plannerRangeLabel } from '../../../utils/planner'

/**
 * The week load's words and numbers as the meter and the popover show them
 * (`WeekLoadMeter`, `WeekLoadPopover`), from `services/stats/week-load`'s
 * result. The usual week is shown whole (`usualShown`: a half rounds up),
 * and every comparison in words — the pill, the line under the chart — uses
 * that shown number, so the words agree with what is on screen; the marks
 * (the meter's, each weekday's) sit at the exact value.
 */

/** Each kind's name in words, in the order a day's boxes stack. */
const WEEK_LOAD_KIND_NAME: Readonly<Record<WeekLoadKind, string>> = { due: 'due', followup: 'follow-up', planned: 'planned' }

/** Each kind's color: due the deadline's, follow-up the follow-up's, planned the Planner's plan tick's (`tokens.css`). */
export const WEEK_LOAD_COLOR: Readonly<Record<WeekLoadKind, string>> = {
  due: 'var(--color-deadline)',
  followup: 'var(--color-followup)',
  planned: 'var(--color-week-load-planned)',
}

/** The fewest dates a day's column is scaled to, so a quiet history doesn't draw one date as a full column. */
const CHART_FLOOR = 6

/** Every landing in `c`: done, slipped and still ahead. */
export function countsTotal(c: WeekLoadCounts): number {
  return c.done + c.late + c.moved + c.removed + c.ahead
}

/** A day's landings, every kind. */
export function dayTotal(day: WeekLoadDay): number {
  return WEEK_LOAD_KINDS.reduce((n, k) => n + countsTotal(day.kinds[k]), 0)
}

/** A week's landings of each kind. */
export function weekKindTotals(week: WeekLoadWeek): Record<WeekLoadKind, number> {
  const out: Record<WeekLoadKind, number> = { due: 0, followup: 0, planned: 0 }
  for (const day of week.days) for (const k of WEEK_LOAD_KINDS) out[k] += countsTotal(day.kinds[k])
  return out
}

/** The usual week as shown: whole, a half rounded up (12.5 → 13). */
export function usualShown(load: WeekLoad): number {
  return Math.round(load.usual.perWeek)
}

/** This week, or null when the result holds none. */
export function thisWeek(load: WeekLoad): WeekLoadWeek | null {
  return load.weeks.find((w) => w.offset === 0) ?? null
}

const dates = (n: number) => `${n} ${n === 1 ? 'date' : 'dates'}`

/** The meter's accessible name and tooltip: `This week: 19 dates, usual 13`. */
export function meterLabel(load: number, usual: number): string {
  return `This week: ${dates(load)}, usual ${usual}`
}

/** A week's name by its offset: `This week`, `Last week`, `3 weeks ago`, `Next week`, `In 2 weeks`. */
export function weekTitle(offset: number): string {
  if (offset === 0) return 'This week'
  if (offset === -1) return 'Last week'
  if (offset === 1) return 'Next week'
  return offset < 0 ? `${-offset} weeks ago` : `In ${offset} weeks`
}

/** A week's days: `Nov 23 – 29`, `Nov 30 – Dec 6`. */
export function weekRange(week: WeekLoadWeek): string {
  return plannerRangeLabel({ first: week.start, last: addDays(week.start, 6) })
}

/** What became of one kind's landings: `2 done, 1 late`. */
function outcomeWords(c: WeekLoadCounts): string {
  const bits: string[] = []
  if (c.done) bits.push(`${c.done} done`)
  if (c.late) bits.push(`${c.late} late`)
  if (c.moved) bits.push(`${c.moved} moved`)
  if (c.removed) bits.push(`${c.removed} removed`)
  if (c.ahead) bits.push(`${c.ahead} ahead`)
  return bits.join(', ')
}

/** A day column's name: `Wed, Nov 25: 3 due (2 done, 1 late); 2 follow-up (2 ahead)`; `Thu, Nov 26: nothing`. */
export function dayWords(day: WeekLoadDay): string {
  const parts = WEEK_LOAD_KINDS.flatMap((k) => {
    const c = day.kinds[k]
    const n = countsTotal(c)
    return n > 0 ? [`${n} ${WEEK_LOAD_KIND_NAME[k]} (${outcomeWords(c)})`] : []
  })
  return `${plannerDayLabel(day.date)}: ${parts.join('; ') || 'nothing'}`
}

/** The slipped share's pill — past weeks and this one, once something has closed: `50% slipped`; else null. */
export function slipPill(week: WeekLoadWeek): string | null {
  return week.offset <= 0 && week.slipPct != null ? `${week.slipPct}% slipped` : null
}

/** The load against the usual week: `6 over usual`, `Room for 4`, `At usual`. */
export function loadPill(week: WeekLoadWeek, usual: number): { text: string; over: boolean } {
  const d = week.totals.load - usual
  if (d > 0) return { text: `${d} over usual`, over: true }
  return { text: d < 0 ? `Room for ${-d}` : 'At usual', over: false }
}

/** What slipped, by how: `4 done late, 8 moved, 1 removed`. */
function slipWords(week: WeekLoadWeek): string {
  const { late, moved, removed } = week.totals
  const bits: string[] = []
  if (late) bits.push(`${late} done late`)
  if (moved) bits.push(`${moved} moved`)
  if (removed) bits.push(`${removed} removed`)
  return bits.join(', ')
}

/**
 * The line under the chart. A past week: `13 of 26 slipped: 4 done late, 8
 * moved, 1 removed.` (`Nothing slipped.`); this week: `12 still ahead this
 * week; 2 slipped so far (2 moved).`; a week ahead: `Already over your usual
 * week.` / `Already at your usual week.` / `Room for 4 more before your
 * usual week.`
 */
export function weekWords(week: WeekLoadWeek, usual: number): string {
  const { load, slipped, ahead } = week.totals
  if (week.offset < 0) return slipped > 0 ? `${slipped} of ${load} slipped: ${slipWords(week)}.` : 'Nothing slipped.'
  if (week.offset === 0) return `${ahead} still ahead this week${slipped > 0 ? `; ${slipped} slipped so far (${slipWords(week)}).` : '.'}`
  if (load > usual) return 'Already over your usual week.'
  if (load === usual) return 'Already at your usual week.'
  return `Room for ${usual - load} more before your usual week.`
}

/** The legend's entry for a box's empty part: `Slipped` (a past week), `Slipped or ahead` (this week), `Ahead`. */
export function emptyBoxWords(offset: number): string {
  return offset < 0 ? 'Slipped' : offset === 0 ? 'Slipped or ahead' : 'Ahead'
}

/** A week reaching back before a log began: `Planned days are recorded from Nov 25`, `Follow-ups are recorded from Sep 3, 2026`. */
export function noteWords(note: WeekLoadWeek['notes'][number], today: Date): string {
  const sameYear = note.since.getFullYear() === today.getFullYear()
  const when = formatDateWith(note.since, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${note.log === 'planned' ? 'Planned days' : 'Follow-ups'} are recorded from ${when}`
}

/**
 * The dates a day's full column stands for: one scale for every week the
 * popover steps through, so the weeks compare as they are stepped — the
 * busiest day of them all, or the highest usual mark, never under
 * `CHART_FLOOR`.
 */
export function chartScale(load: WeekLoad): number {
  let max = CHART_FLOOR
  for (const w of load.weeks) for (const d of w.days) max = Math.max(max, dayTotal(d))
  for (const share of load.usual.weekdayShares) max = Math.max(max, Math.ceil(load.usual.perWeek * share))
  return max
}
