export type RecurrenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  type: RecurrenceType
}
