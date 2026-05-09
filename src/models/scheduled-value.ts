export const FUZZY_TOKENS = ['today', 'tomorrow', 'this-week', 'next-week', 'this-month', 'next-month'] as const
export type FuzzyToken = typeof FUZZY_TOKENS[number]

/**
 * Discriminated union for `TodoItem.scheduledDate`. The fuzzy variant carries
 * a `setAt` stamp — the moment the user picked the token — so resolution can
 * age the value (a "this week" picked three weeks ago resolves to its
 * original window, not the current one). Dexie v49 backfills `setAt` on
 * pre-existing fuzzy rows.
 */
export type ScheduledValue =
  | { kind: 'date'; value: Date }
  | { kind: 'fuzzy'; token: FuzzyToken; setAt: Date }

/**
 * Construct a fuzzy `ScheduledValue` stamped with `now`. Single source of
 * truth for fuzzy construction — every production call site (NLP parser,
 * picker preset) routes through this so `setAt` is never accidentally
 * omitted. Tests may pass an explicit `now` for deterministic ageing.
 */
export function makeFuzzy(token: FuzzyToken, now: Date = new Date()): ScheduledValue {
  return { kind: 'fuzzy', token, setAt: now }
}

/** True if v is a valid ScheduledValue shape (for import-validation + NLP parser). */
export function isScheduledValue(v: unknown): v is ScheduledValue {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.kind === 'date') return o.value instanceof Date || typeof o.value === 'string'
  if (o.kind === 'fuzzy') {
    if (typeof o.token !== 'string' || !(FUZZY_TOKENS as readonly string[]).includes(o.token)) return false
    return o.setAt instanceof Date || typeof o.setAt === 'string'
  }
  return false
}
