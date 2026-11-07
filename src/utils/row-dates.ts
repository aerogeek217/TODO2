/**
 * How the task rows show their due and next follow-up dates (Settings ›
 * Appearance › Dates, app-wide; D25 D1): `relative` = `Today`, the weekday
 * for the next six days, else `11/20` (`01/15/27` in another year) — the
 * default; `numeric` = `MM/DD`. Only the task rows read it (`formatRowDate`);
 * the calendar, pickers, status updates, emails and exports keep `MM/DD`.
 */
export type RowDates = 'relative' | 'numeric'

export const DEFAULT_ROW_DATES: RowDates = 'relative'

export const ROW_DATES: readonly RowDates[] = ['relative', 'numeric']

export function isRowDates(v: unknown): v is RowDates {
  return typeof v === 'string' && (ROW_DATES as readonly string[]).includes(v)
}
