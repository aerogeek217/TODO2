export type RecurrenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  type: RecurrenceType
  /** Original day-of-month to prevent drift (e.g., Jan 31 → Feb 28 → Mar 31, not Mar 28) */
  originalDayOfMonth?: number
}
