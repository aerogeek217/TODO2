/**
 * The sun and the moon for ambience (`utils/sky`), from the clock and a place
 * alone — no location lookup, no network. Accurate to a minute or two, which
 * is plenty for light and colour.
 */
import type { AmbiencePlace, Season } from '../models/ambience'

const RAD = Math.PI / 180
/** The moon's synodic month, in days. */
export const SYNODIC_MONTH = 29.530588853

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The day of the year, 1 = January 1 (local calendar). */
export function dayOfYear(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5)
}

/**
 * Solar noon on `d`'s day at `lon`, in local clock hours: the zone's offset
 * that day (daylight saving included), less the longitude, less the equation
 * of time.
 */
export function solarNoon(d: Date, lon: number): number {
  const B = 2 * Math.PI * (dayOfYear(d) - 81) / 364
  const eotMinutes = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)
  const offsetHours = -new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTimezoneOffset() / 60
  return 12 + offsetHours - lon / 15 - eotMinutes / 60
}

export interface SunDay {
  /** Solar noon, sunrise and sunset in local clock hours (rise / set unset on a polar day or night). */
  noon: number
  rise: number
  set: number
  /** `day`: the sun never sets; `night`: it never rises; `null`: an ordinary day. */
  polar: 'day' | 'night' | null
  /** Hours of daylight. */
  daylight: number
  /** The sun's height at noon, in degrees. */
  maxAltitude: number
  /** The sun's height at `hours` (local clock), in degrees. */
  altitude: (hours: number) => number
}

/** The sun's day at `place` on `d`'s date. */
export function sunDay(d: Date, place: AmbiencePlace): SunDay {
  const decl = -23.44 * Math.cos(2 * Math.PI / 365 * (dayOfYear(d) + 10)) * RAD
  const phi = place.lat * RAD
  const noon = solarNoon(d, place.lon)
  // Sunrise / sunset: the sun's top edge on the horizon, refraction included.
  const cosH0 = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl))
  const polar = cosH0 >= 1 ? 'night' : cosH0 <= -1 ? 'day' : null
  const halfDay = Math.acos(clamp(cosH0, -1, 1)) / RAD / 15
  // Clamped: with the sun overhead at noon the sum can round past 1 (`asin` → NaN).
  const altitude = (hours: number): number =>
    Math.asin(clamp(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(15 * (hours - noon) * RAD), -1, 1)) / RAD
  return {
    noon,
    rise: noon - halfDay,
    set: noon + halfDay,
    polar,
    daylight: polar === 'day' ? 24 : polar === 'night' ? 0 : 2 * halfDay,
    maxAltitude: altitude(noon),
    altitude,
  }
}

/** The moon's age at `d`, in days since the new moon (0 – 29.53). */
export function moonAge(d: Date): number {
  // A new moon: 2000-01-06 18:14 UTC.
  const days = (d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5
  return ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH
}

/** The lit share of the moon's disc at `age` (0 new – 1 full). */
export function moonIllumination(age: number): number {
  return (1 - Math.cos(2 * Math.PI * age / SYNODIC_MONTH)) / 2
}

/** The season at `lat` in `d`'s month (meteorological: whole months; the south six months on). */
export function seasonAt(d: Date, lat: number): Season {
  const month = lat < 0 ? (d.getMonth() + 6) % 12 : d.getMonth()
  if (month >= 2 && month <= 4) return 'spring'
  if (month >= 5 && month <= 7) return 'summer'
  if (month >= 8 && month <= 10) return 'autumn'
  return 'winter'
}

/** A time zone's main city — the place guessed until one is typed in Settings. */
const ZONE_PLACES: Readonly<Record<string, readonly [name: string, lat: number, lon: number]>> = {
  'America/New_York': ['New York', 40.71, -74.01],
  'America/Detroit': ['Detroit', 42.33, -83.05],
  'America/Toronto': ['Toronto', 43.65, -79.38],
  'America/Halifax': ['Halifax', 44.65, -63.57],
  'America/Chicago': ['Chicago', 41.88, -87.63],
  'America/Winnipeg': ['Winnipeg', 49.9, -97.14],
  'America/Mexico_City': ['Mexico City', 19.43, -99.13],
  'America/Denver': ['Denver', 39.74, -104.99],
  'America/Edmonton': ['Edmonton', 53.55, -113.49],
  'America/Phoenix': ['Phoenix', 33.45, -112.07],
  'America/Los_Angeles': ['Los Angeles', 34.05, -118.24],
  'America/Vancouver': ['Vancouver', 49.28, -123.12],
  'America/Anchorage': ['Anchorage', 61.22, -149.9],
  'Pacific/Honolulu': ['Honolulu', 21.31, -157.86],
  'America/Sao_Paulo': ['São Paulo', -23.55, -46.63],
  'America/Argentina/Buenos_Aires': ['Buenos Aires', -34.6, -58.38],
  'America/Bogota': ['Bogotá', 4.71, -74.07],
  'America/Lima': ['Lima', -12.05, -77.04],
  'America/Santiago': ['Santiago', -33.45, -70.67],
  'Europe/London': ['London', 51.51, -0.13],
  'Europe/Dublin': ['Dublin', 53.35, -6.26],
  'Europe/Lisbon': ['Lisbon', 38.72, -9.14],
  'Europe/Madrid': ['Madrid', 40.42, -3.7],
  'Europe/Paris': ['Paris', 48.86, 2.35],
  'Europe/Brussels': ['Brussels', 50.85, 4.35],
  'Europe/Amsterdam': ['Amsterdam', 52.37, 4.9],
  'Europe/Berlin': ['Berlin', 52.52, 13.4],
  'Europe/Zurich': ['Zurich', 47.38, 8.54],
  'Europe/Rome': ['Rome', 41.9, 12.5],
  'Europe/Vienna': ['Vienna', 48.21, 16.37],
  'Europe/Prague': ['Prague', 50.08, 14.44],
  'Europe/Warsaw': ['Warsaw', 52.23, 21.01],
  'Europe/Copenhagen': ['Copenhagen', 55.68, 12.57],
  'Europe/Oslo': ['Oslo', 59.91, 10.75],
  'Europe/Stockholm': ['Stockholm', 59.33, 18.07],
  'Europe/Helsinki': ['Helsinki', 60.17, 24.94],
  'Europe/Athens': ['Athens', 37.98, 23.73],
  'Europe/Istanbul': ['Istanbul', 41.01, 28.98],
  'Europe/Kiev': ['Kyiv', 50.45, 30.52],
  'Europe/Kyiv': ['Kyiv', 50.45, 30.52],
  'Europe/Moscow': ['Moscow', 55.76, 37.62],
  'Africa/Cairo': ['Cairo', 30.04, 31.24],
  'Africa/Lagos': ['Lagos', 6.52, 3.38],
  'Africa/Nairobi': ['Nairobi', -1.29, 36.82],
  'Africa/Johannesburg': ['Johannesburg', -26.2, 28.05],
  'Asia/Dubai': ['Dubai', 25.2, 55.27],
  'Asia/Karachi': ['Karachi', 24.86, 67.0],
  'Asia/Kolkata': ['Kolkata', 22.57, 88.36],
  'Asia/Calcutta': ['Kolkata', 22.57, 88.36],
  'Asia/Dhaka': ['Dhaka', 23.81, 90.41],
  'Asia/Bangkok': ['Bangkok', 13.76, 100.5],
  'Asia/Jakarta': ['Jakarta', -6.2, 106.85],
  'Asia/Singapore': ['Singapore', 1.29, 103.85],
  'Asia/Kuala_Lumpur': ['Kuala Lumpur', 3.14, 101.69],
  'Asia/Manila': ['Manila', 14.6, 120.98],
  'Asia/Hong_Kong': ['Hong Kong', 22.32, 114.17],
  'Asia/Shanghai': ['Shanghai', 31.23, 121.47],
  'Asia/Taipei': ['Taipei', 25.03, 121.57],
  'Asia/Seoul': ['Seoul', 37.57, 126.98],
  'Asia/Tokyo': ['Tokyo', 35.68, 139.69],
  'Australia/Perth': ['Perth', -31.95, 115.86],
  'Australia/Adelaide': ['Adelaide', -34.93, 138.6],
  'Australia/Brisbane': ['Brisbane', -27.47, 153.03],
  'Australia/Sydney': ['Sydney', -33.87, 151.21],
  'Australia/Melbourne': ['Melbourne', -37.81, 144.96],
  'Pacific/Auckland': ['Auckland', -36.85, 174.76],
}

/** The place a time zone guesses, with its city's name; `null` for a zone not in the table. */
export function placeForTimeZone(timeZone: string): (AmbiencePlace & { name: string }) | null {
  const entry = ZONE_PLACES[timeZone]
  return entry ? { name: entry[0], lat: entry[1], lon: entry[2] } : null
}

/** This browser's time zone (`''` when it can't say). */
export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

/** The place guessed from this browser's time zone: its main city, else on the zone's meridian at 40° (north of the equator). */
export function guessPlace(): AmbiencePlace & { name: string | null } {
  const known = placeForTimeZone(currentTimeZone())
  if (known) return known
  const offsetHours = -new Date().getTimezoneOffset() / 60
  return { name: null, lat: 40, lon: offsetHours * 15 }
}
