import { HORIZON_KEYS, type HorizonKey } from '../services/horizons'

/**
 * Parse `settings.horizonSlots`. Returns `{}` when absent / invalid. Invalid
 * slot keys are silently dropped (never throw — a bad settings row should not
 * break dashboard rendering).
 */
export function parseHorizonSlots(value: string | undefined | null): Partial<Record<HorizonKey, number>> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<Record<HorizonKey, number>> = {}
    for (const key of HORIZON_KEYS) {
      const v = (parsed as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    }
    return out
  } catch {
    return {}
  }
}
