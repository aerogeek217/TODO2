/**
 * Legacy horizon iteration order used to flatten pre-P6 map-shape
 * `horizonSlots` settings into the new ordered `number[]`. New writes use
 * the array shape directly; this list only exists to make legacy backups
 * land in the same order users used to see them.
 */
const LEGACY_HORIZON_KEYS = ['thisweek', 'nextweek', 'thismonth', 'later', 'someday'] as const
export type LegacyHorizonKey = typeof LEGACY_HORIZON_KEYS[number]

/**
 * Parse `settings.horizonSlots`. Returns `[]` when absent / invalid. Accepts
 * both the legacy `Partial<Record<HorizonKey, number>>` shape (auto-flattens
 * via `LEGACY_HORIZON_KEYS` order) and the post-P6 plain `number[]` shape.
 * Unknown legacy keys / non-finite ids are silently dropped.
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

/** Same flatten logic as `parseHorizonSlots` but over an already-parsed value. */
export function normalizeHorizonSlots(value: unknown): number[] {
  if (Array.isArray(value)) {
    const out: number[] = []
    for (const v of value) {
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
    }
    return out
  }
  if (value && typeof value === 'object') {
    const out: number[] = []
    for (const key of LEGACY_HORIZON_KEYS) {
      const v = (value as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
    }
    return out
  }
  return []
}

/**
 * Resolve the legacy `selectedHorizon: HorizonKey` value to a defId via the
 * legacy map row. Returns null when the legacy map is missing or doesn't
 * have the requested key. Intended only for migration on settings load.
 */
export function resolveLegacySelectedHorizon(
  legacySelected: string | undefined | null,
  legacyHorizonSlotsValue: string | undefined | null,
): number | null {
  if (!legacySelected) return null
  if (!LEGACY_HORIZON_KEYS.includes(legacySelected as LegacyHorizonKey)) return null
  if (!legacyHorizonSlotsValue) return null
  try {
    const parsed = JSON.parse(legacyHorizonSlotsValue) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const v = (parsed as Record<string, unknown>)[legacySelected]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export { LEGACY_HORIZON_KEYS }
