/**
 * The stored form of the ambience settings (`SETTING_KEYS.ambience`): one JSON
 * row — `{"enabled":true,"place":{"lat":41.88,"lon":-87.63},"sky":"whisper","motion":40,"seasons":true}`.
 * A field missing or out of range reads as its default; absent row = all defaults.
 */
import { DEFAULT_AMBIENCE, SKY_STRENGTHS, type AmbiencePlace, type AmbienceSettings, type SkyStrength } from '../models/ambience'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isSkyStrength(v: unknown): v is SkyStrength {
  return typeof v === 'string' && (SKY_STRENGTHS as readonly string[]).includes(v)
}

/** A latitude (−90 – 90) and longitude (−180 – 180), both finite numbers. */
export function isAmbiencePlace(v: unknown): v is AmbiencePlace {
  return isRecord(v)
    && typeof v.lat === 'number' && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90
    && typeof v.lon === 'number' && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180
}

/** Header motion: a whole percentage 0–100. */
export function isAmbienceMotion(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100
}

/** A coordinate kept to two decimals (about a kilometre — plenty for the sun). */
export function roundCoordinate(v: number): number {
  return Math.round(v * 100) / 100
}

/** The settings a stored row holds; `undefined` when it isn't a JSON object (import refuses it). */
export function parseAmbienceSettings(value: string): AmbienceSettings | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!isRecord(raw)) return undefined
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_AMBIENCE.enabled,
    place: isAmbiencePlace(raw.place) ? { lat: roundCoordinate(raw.place.lat), lon: roundCoordinate(raw.place.lon) } : null,
    sky: isSkyStrength(raw.sky) ? raw.sky : DEFAULT_AMBIENCE.sky,
    motion: isAmbienceMotion(raw.motion) ? raw.motion : DEFAULT_AMBIENCE.motion,
    seasons: typeof raw.seasons === 'boolean' ? raw.seasons : DEFAULT_AMBIENCE.seasons,
  }
}

export function formatAmbienceSettings(s: AmbienceSettings): string {
  return JSON.stringify({ enabled: s.enabled, place: s.place, sky: s.sky, motion: s.motion, seasons: s.seasons })
}

export function isDefaultAmbience(s: AmbienceSettings): boolean {
  const d = DEFAULT_AMBIENCE
  return s.enabled === d.enabled && s.place === null && s.sky === d.sky && s.motion === d.motion && s.seasons === d.seasons
}
