/**
 * Parse `settings.horizonSlots`. Returns `[]` when absent / invalid. The value
 * is a JSON-encoded `number[]` of `ListDefinition.id`s in the order users see
 * on the horizons widget. Non-finite ids are silently dropped.
 */
export function parseHorizonSlots(value: string | undefined | null): number[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return normalizeHorizonSlots(parsed)
  } catch {
    return []
  }
}

/** Same logic as `parseHorizonSlots` but over an already-parsed value. */
export function normalizeHorizonSlots(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const v of value) {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return out
}
