import { formatDateWith, formatRowDate, startOfDay, MS_PER_DAY } from './date'
import { relativeDayPhrase } from './followup'
import type { RowDates } from './row-dates'

/** Which of the task layout's dates (board BJ's facts rail): its words differ only when late. */
export type FactDateKind = 'due' | 'next' | 'last'

/** A date as the facts rail shows it. */
export interface FactDateWords {
  /** As a list row writes it (`Today`, `Fri`, `11/06` — `formatRowDate`). */
  words: string
  /**
   * How far it is, after the words, where they don't already say it: a due
   * date before today `3 days late`, any other numeric date `2 weeks ago` /
   * `in 3 weeks`; none for `Today` or a weekday.
   */
  relative?: string
  /** The full date, for the tooltip: `Friday, November 6, 2026`. */
  full: string
}

const dayDiff = (date: Date, today: Date) =>
  Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / MS_PER_DAY)

/**
 * One date look for the task layout (board BJ): the row's words for the
 * date (`utils/date.formatRowDate`, so Settings › Appearance › Dates applies
 * as on the rows), how far it is when the words don't say so, and the full
 * date for its tooltip.
 */
export function factDateWords(date: Date, today: Date, rowDates: RowDates, kind: FactDateKind): FactDateWords {
  const words = formatRowDate(date, today, rowDates)
  const full = formatDateWith(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const diff = dayDiff(date, today)
  if (kind === 'due' && diff < 0) {
    const late = -diff === 1 ? '1 day' : relativeDayPhrase(date, today).replace(/ ago$/, '')
    return { words, relative: `${late} late`, full }
  }
  // `Today` and the next six days' weekday say it themselves (the words mode).
  const numeric = rowDates === 'numeric' || diff < 0 || diff > 6
  if (!numeric || diff === 0) return { words, full }
  return { words, relative: relativeDayPhrase(date, today), full }
}
