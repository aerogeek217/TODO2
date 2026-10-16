/**
 * Helpers shared by the schema-upgrade transforms. The transforms must keep
 * their exact behaviour, so these never change: a transform that needs
 * something else gets its own helper.
 */
import { isRecord } from '../../utils/is-record'

/** A stored row id: a finite number. */
export function isId(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Key for matching names: trimmed, case-insensitive. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** The largest id among `rows` (rows without an id are skipped); 0 when none. */
export function maxId(rows: readonly unknown[] | undefined): number {
  let max = 0
  for (const row of rows ?? []) if (isRecord(row) && isId(row.id) && row.id > max) max = row.id
  return max
}
