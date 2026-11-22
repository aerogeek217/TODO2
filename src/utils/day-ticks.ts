/**
 * The one day mark of a small day cell (the Planner's strip, the
 * Calendar's small and medium faces and its compact month): a **solid
 * tick** per real date on the day — a due date, a follow-up —, then a
 * **hollow tick** per plan, at most `DAY_TICKS_MAX` in all, then `+N`.
 * `components/shared/DayTicks` draws them.
 */

/** The most ticks a day draws before `+N`. */
export const DAY_TICKS_MAX = 8

/** A real date's tick: a due date (the deadline color) or a follow-up (the follow-up color). */
type DayTickDate = 'due' | 'followup'

/** What falls on a day: its real dates, due dates first, and its plans. */
interface DayMarks {
  /** One per real date: due dates, then follow-ups. */
  dates: readonly DayTickDate[]
  /** The plans on the day. */
  plans: number
}

/** The ticks a day draws: its real dates, then its plans, then how many it leaves out. */
export interface DayTicks {
  /** A solid tick per real date drawn: due dates, then follow-ups. */
  dates: DayTickDate[]
  /** The hollow ticks drawn: plans. */
  plans: number
  /** The marks past `DAY_TICKS_MAX` (`+N`). */
  more: number
}

/**
 * A day's ticks: a solid one for each real date (`dates`), then a hollow
 * one for each plan (`plans`) — at most `DAY_TICKS_MAX` in all, the real
 * dates first, then `+N`.
 */
export function dayTicks(marks: DayMarks): DayTicks {
  const dates = marks.dates.slice(0, DAY_TICKS_MAX)
  const plans = Math.min(marks.plans, DAY_TICKS_MAX - dates.length)
  return { dates, plans, more: marks.dates.length + marks.plans - dates.length - plans }
}

/**
 * A calendar day's marks from its entries (a `CalendarEntry` fits): a due
 * date — an occurrence of a recurring task among them — or a follow-up
 * each, due dates first; and its plans. One per entry, as the day counts
 * them.
 */
export function entryDayMarks(entries: readonly { kind: DayTickDate | 'plan' }[]): DayMarks {
  let due = 0
  let followup = 0
  let plans = 0
  for (const e of entries) {
    if (e.kind === 'due') due++
    else if (e.kind === 'followup') followup++
    else plans++
  }
  return { dates: [...Array<DayTickDate>(due).fill('due'), ...Array<DayTickDate>(followup).fill('followup')], plans }
}
