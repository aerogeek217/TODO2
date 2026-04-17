export const FUZZY_TOKENS = ['today', 'tomorrow', 'this-week', 'next-week', 'this-month', 'next-month'] as const
export type FuzzyToken = typeof FUZZY_TOKENS[number]

export type ScheduledValue =
  | { kind: 'date'; value: Date }
  | { kind: 'fuzzy'; token: FuzzyToken }

/** True if v is a valid ScheduledValue shape (for import-validation + NLP parser). */
export function isScheduledValue(v: unknown): v is ScheduledValue {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.kind === 'date') return o.value instanceof Date || typeof o.value === 'string'
  if (o.kind === 'fuzzy') return typeof o.token === 'string' && (FUZZY_TOKENS as readonly string[]).includes(o.token)
  return false
}
