/**
 * Date revival for rows that crossed a JSON boundary (cr1 P3).
 *
 * `JSON.stringify` writes a `Date` as an ISO string and `JSON.parse` never
 * turns it back, so every export / backup / sync file carries its Date fields
 * as strings. Rows must be revived before they reach Dexie: IndexedDB orders
 * string keys after every Date key (so `dueDate` range queries miss them) and
 * call sites such as `dueDate.getTime()` throw on strings.
 */

/**
 * Lenient: a parseable string becomes a `Date`; anything else (a `Date`,
 * `undefined`, a malformed value) is returned unchanged. For schema-upgrade
 * transforms, which run before validation and must pass bad rows through.
 */
export function reviveDate(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? v : new Date(ms)
}

/**
 * Strict: for values already validated as date-like (`Date` or parseable
 * string — see `isDateLike` in `import-validation.ts`). A `Date` is returned
 * as-is. Throws on anything else: reaching that is a validator/picker drift
 * bug, not bad input.
 */
export function toDate(v: unknown): Date {
  if (v instanceof Date) return v
  if (typeof v === 'string') return new Date(v)
  throw new TypeError(`expected a Date or ISO date string, got ${v === null ? 'null' : typeof v}`)
}

/** `toDate` for optional fields: `null` / `undefined` → `undefined`. */
export function toOptDate(v: unknown): Date | undefined {
  return v == null ? undefined : toDate(v)
}
