/**
 * A plain object, i.e. a JSON object as `JSON.parse` makes it: not `null`,
 * not an array.
 *
 * Schema-upgrade transforms (`data/upgrades/`) may use it, and they must
 * keep their exact behaviour once released: never change what this accepts.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
