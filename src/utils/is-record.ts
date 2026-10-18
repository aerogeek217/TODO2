/**
 * A plain object, i.e. a JSON object as `JSON.parse` makes it: not `null`,
 * not an array.
 *
 * The schema-upgrade transforms (`data/upgrades/`) use it, and they must
 * keep their exact behaviour: never change what this accepts.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}
