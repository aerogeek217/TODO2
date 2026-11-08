import { afterAll, beforeAll } from 'vitest'

/**
 * Runs the enclosing `describe`'s tests in `zone` (e.g. `America/Chicago`,
 * a zone with daylight saving), so a daylight-saving test asserts on any
 * machine — the deploy runs in UTC, which has none. Node re-reads `TZ` when
 * it is assigned; the worker's own zone is put back by name afterwards
 * (workers are shared). Build the dates inside the tests: one built at a
 * module's top level was made in the worker's zone.
 */
export function pinTimeZone(zone: string): void {
  const original = Intl.DateTimeFormat().resolvedOptions().timeZone
  beforeAll(() => { process.env.TZ = zone })
  afterAll(() => { process.env.TZ = original })
}

/** The US zone the daylight-saving tests use: 2026's changes are Sun 8 Mar (23 hours) and Sun 1 Nov (25 hours). */
export const DST_ZONE = 'America/Chicago'
