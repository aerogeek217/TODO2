/**
 * The ambience scene for one moment (`components/ambience`): where the sun
 * and the moon are over the top bar, the sky's colours, and how visible each
 * layer is once Sky strength and Header motion are applied. Pure — the
 * components only draw it.
 */
import type { AmbiencePlace, AmbienceSettings, Season, SkyStrength, WeatherKind } from '../models/ambience'
import { moonAge, seasonAt, sunDay, SYNODIC_MONTH, type SunDay } from './sun'

export type Rgb = readonly [number, number, number]

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number): number => clamp(v, 0, 1)

/** The top bar's height the sun and moon move in (`--topbar-height`). */
export const BAR_HEIGHT = 40

export function rgba(c: Rgb, alpha = 1): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Number(alpha.toFixed(3))})`
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function hex(h: string): Rgb {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

/** Interpolates a ramp of `[altitude, ...colours]` stops at `x`. */
function ramp(stops: readonly (readonly [number, ...string[]])[], x: number): Rgb[] {
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last) return []
  if (x <= first[0]) return first.slice(1).map((c) => hex(c as string))
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i]
    const lo = stops[i - 1]
    if (!hi || !lo || x > hi[0]) continue
    const t = (x - lo[0]) / (hi[0] - lo[0])
    return hi.slice(1).map((c, k) => mixRgb(hex(lo[k + 1] as string), hex(c as string), t))
  }
  return last.slice(1).map((c) => hex(c as string))
}

/** The sky by the sun's altitude: [altitude°, zenith, horizon]. */
const SKY_STOPS = [
  [-90, '#070a18', '#0b1024'], [-18, '#0a0f26', '#151b3e'], [-10, '#141c44', '#3b2f63'], [-4, '#24316b', '#a3527a'],
  [0, '#36508a', '#e57a58'], [4, '#4a72ad', '#f2a55e'], [10, '#5f93cc', '#f1cf9c'], [25, '#69a5dc', '#c3e1f1'], [90, '#5c9fe0', '#a9d4f0'],
] as const
/** The sun's colour by its altitude. */
const SUN_STOPS = [[-6, '#ff6a3d'], [0, '#ff8a4c'], [6, '#ffb35e'], [15, '#ffe2a0'], [40, '#fff6d8']] as const

export function skyColors(altitude: number): { zenith: Rgb; horizon: Rgb } {
  const [zenith = [0, 0, 0], horizon = [0, 0, 0]] = ramp(SKY_STOPS, altitude)
  return { zenith, horizon }
}

export function sunColor(altitude: number): Rgb {
  return ramp(SUN_STOPS, altitude)[0] ?? [255, 200, 120]
}

/** How much of the sky shows through the top bar's glass at each strength (the glass's complement). */
const SKY_SHOW: Readonly<Record<SkyStrength, number>> = { whisper: 0.14, subtle: 0.28, vivid: 0.5 }
/** The lamplight and the hairline glow's strength. */
const LIGHT: Readonly<Record<SkyStrength, number>> = { whisper: 0.6, subtle: 1, vivid: 1.35 }
/** Clouds, aurora, mist and the sunbeam (Vivid = full). */
const SOFT: Readonly<Record<SkyStrength, number>> = { whisper: 0.4, subtle: 0.68, vivid: 1 }
/** The clouds, fainter still at Whisper. */
const CLOUDS: Readonly<Record<SkyStrength, number>> = { whisper: 0.27, subtle: 0.68, vivid: 1 }
/** The weather behind the cells. */
const BEHIND: Readonly<Record<SkyStrength, number>> = { whisper: 0.54, subtle: 0.77, vivid: 0.9 }
/** More clouds in the grey months. */
const CLOUD_COVER: Readonly<Record<Season, number>> = { winter: 0.95, autumn: 0.85, spring: 0.65, summer: 0.45 }
/** Mist is heaviest in spring and autumn. */
const MIST_SEASON: Readonly<Record<Season, number>> = { spring: 1, autumn: 1, winter: 0.75, summer: 0.6 }

export interface SkyScene {
  season: Season
  /** South of the equator: the moon's lit side flips. */
  south: boolean
  /** The sun's altitude, degrees. */
  altitude: number
  /** Across the bar, 0 = left edge, 1 = right (sunrise on the left, sunset on the right); outside 0–1 while it is down. */
  sunX: number
  /** Down the bar in px (0 = top; below `BAR_HEIGHT` = under the horizon). */
  sunY: number
  moonX: number
  moonY: number
  moonAge: number
  zenith: Rgb
  horizon: Rgb
  sun: Rgb
  /** How much of the horizon's glow shows around the sun (0 at night). */
  glow: number
  /** The angle the sunbeam falls at, degrees (leaning away from the sun). */
  beamAngle: number
  cloud: Rgb
  cloudShade: Rgb
  /** What falls in the bar and behind the cells; `null` when Seasons is off. */
  weather: WeatherKind | null
  /** Each layer's opacity, Sky strength and Header motion applied (0 = not drawn). */
  opacity: {
    sky: number
    sunGlow: number
    sunDisc: number
    stars: number
    moon: number
    clouds: number
    aurora: number
    mist: number
    sunbeam: number
    lamp: number
    /** The bar's weather particles. */
    weather: number
    /** The weather behind the cells. */
    behind: number
  }
  /** The bright point on the hairline: under the sun by day, the moon by night; `null` when neither shows. */
  hairline: { x: number; color: Rgb; alpha: number; glowAlpha: number } | null
}

/** Local clock hours of `d` (fractional). */
export function clockHours(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

/** How far across its day the sun is: 0 at sunrise, 1 at sunset. */
function sunProgress(day: SunDay, hours: number): number {
  if (day.polar === 'day') return (hours - (day.noon - 12)) / 24
  if (day.polar === 'night') return -1
  return (hours - day.rise) / (day.set - day.rise)
}

/** How far across its night the moon is: 0 at sunset, 1 at the next sunrise. */
function nightProgress(day: SunDay, hours: number): number {
  if (day.polar) return hours / 24
  const h = hours < day.rise ? hours + 24 : hours
  return (h - day.set) / (24 - (day.set - day.rise))
}

/** The ambience at `now` at `place`, drawn in `theme`. */
export function skyScene(now: Date, place: AmbiencePlace, settings: AmbienceSettings, theme: 'dark' | 'light'): SkyScene {
  const day = sunDay(now, place)
  const hours = clockHours(now)
  const altitude = day.altitude(hours)
  const season = seasonAt(now, place.lat)
  const dark = theme === 'dark'
  const strength = settings.sky
  const motion = clamp01(settings.motion / 100) * 1.2

  const frac = sunProgress(day, hours)
  const sunX = 0.04 + clamp(frac, -0.25, 1.25) * 0.92
  const sunY = BAR_HEIGHT - clamp(altitude, -14, 80) / Math.max(18, day.maxAltitude) * 30
  const nf = clamp01(nightProgress(day, hours))
  const moonX = 0.04 + nf * 0.92
  const moonY = 32 - Math.sin(nf * Math.PI) * 16

  const { zenith, horizon } = skyColors(altitude)
  const sun = sunColor(altitude)
  const glow = clamp01((altitude + 12) / 12)
  const golden = 1 - clamp01(Math.abs(altitude - 1.5) / 8)
  const night = clamp01((-altitude - 4) / 10)
  const sunUp = clamp01((altitude + 3) / 5)
  const moonUp = clamp01((-altitude - 3) / 6)
  const lampK = clamp01(-altitude / 8)
  const sinceRise = hours - day.rise
  const mistK = day.polar || sinceRise < -0.5 || sinceRise > 2 ? 0 : sinceRise < 0.3 ? (sinceRise + 0.5) / 0.8 : 1 - (sinceRise - 0.3) / 1.7
  const beamK = clamp01(1 - Math.abs(altitude - 5) / 10)
  const seasons = settings.seasons
  const winter = season === 'winter'

  const cloud = dark
    ? mixRgb(mixRgb(horizon, [255, 255, 255], 0.5), [70, 80, 112], night)
    : mixRgb(mixRgb(horizon, [255, 255, 255], 0.2), [110, 125, 158], 0.55)
  const cloudShade = mixRgb(cloud, dark ? [40, 46, 66] : [90, 100, 125], 0.28)

  let weather: WeatherKind | null = null
  if (seasons) {
    weather = season === 'winter' ? 'flake' : season === 'autumn' ? 'leaf' : season === 'spring' ? 'petal' : altitude < -3 ? 'firefly' : 'seed'
  }

  let hairline: SkyScene['hairline'] = null
  if (altitude > -5) {
    hairline = { x: sunX, color: sun, alpha: clamp01((altitude + 5) / 8) * (0.55 + 0.45 * golden), glowAlpha: 0.4 * golden * LIGHT[strength] }
  } else if (moonUp > 0) {
    hairline = { x: moonX, color: [200, 212, 234], alpha: 0.5 * moonUp, glowAlpha: 0 }
  }

  return {
    season,
    south: place.lat < 0,
    altitude,
    sunX,
    sunY,
    moonX,
    moonY,
    moonAge: moonAge(now),
    zenith,
    horizon,
    sun,
    glow,
    beamAngle: 90 + (clamp01(frac) - 0.5) * 80,
    cloud,
    cloudShade,
    weather,
    opacity: {
      sky: SKY_SHOW[strength],
      sunGlow: clamp01(sunUp * 0.8 * motion * SKY_SHOW[strength] * 2.5),
      sunDisc: clamp01(sunUp * 0.38 * motion),
      stars: dark ? clamp01(night * 0.85 * motion) : 0,
      moon: clamp01(moonUp * (dark ? 0.5 : 0.4) * motion * 1.4),
      clouds: clamp01(CLOUD_COVER[season] * motion * 0.5 * CLOUDS[strength]),
      aurora: seasons && winter ? clamp01(night * motion * 1.4 * SOFT[strength]) : 0,
      mist: clamp01(mistK * MIST_SEASON[season] * motion * 2.2 * SOFT[strength]),
      sunbeam: clamp01(beamK * SOFT[strength]),
      lamp: clamp01(lampK * LIGHT[strength]),
      weather: seasons ? clamp01(motion) : 0,
      behind: seasons ? BEHIND[strength] : 0,
    },
    hairline,
  }
}

/** The sky behind the glass: the horizon's glow around the sun over a sweep from the sun's side to the zenith. */
export function skyBackground(scene: SkyScene): string {
  const { zenith, horizon, glow, sunX } = scene
  const x = (sunX * 100).toFixed(1)
  const edge = mixRgb(zenith, horizon, 0.35 * glow)
  const left = sunX < 0.5 ? edge : zenith
  const right = sunX < 0.5 ? zenith : edge
  return `radial-gradient(ellipse 34% 320% at ${x}% 120%, ${rgba(horizon, 0.95 * glow)} 0%, ${rgba(horizon, 0)} 100%), `
    + `linear-gradient(to right, ${rgba(left)}, ${rgba(zenith)} 50%, ${rgba(right)})`
}

/**
 * The moon's lit shape as an SVG path in a `2r` box centred on (`cx`, `cy`):
 * lit on the right while waxing in the north (the left in the south).
 */
export function moonPath(age: number, south: boolean, cx: number, cy: number, r: number): string {
  const p = age / SYNODIC_MONTH
  const lit = (1 - Math.cos(2 * Math.PI * p)) / 2
  const rightLit = (p < 0.5) !== south
  const rx = Math.abs(Math.cos(2 * Math.PI * p)) * r
  const top = `${cx} ${cy - r}`
  const bottom = `${cx} ${cy + r}`
  const outer = rightLit ? 1 : 0
  const inner = rightLit ? (lit < 0.5 ? 0 : 1) : (lit < 0.5 ? 1 : 0)
  return `M${top} A${r} ${r} 0 0 ${outer} ${bottom} A${rx.toFixed(2)} ${r} 0 0 ${inner} ${top} Z`
}

/** A cumulus's puffs as [x of the width, y of the height, radius of the height]: tallest near the middle, a flat base at 85 %. */
export const CUMULUS_SHAPES: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0.18, 0.7, 0.22], [0.33, 0.56, 0.32], [0.52, 0.46, 0.42], [0.7, 0.58, 0.32], [0.84, 0.7, 0.22]],
  [[0.2, 0.66, 0.26], [0.4, 0.48, 0.4], [0.62, 0.52, 0.36], [0.8, 0.68, 0.24]],
  [[0.24, 0.64, 0.28], [0.48, 0.46, 0.42], [0.72, 0.62, 0.28]],
  [[0.16, 0.72, 0.2], [0.3, 0.58, 0.3], [0.47, 0.44, 0.4], [0.64, 0.5, 0.34], [0.8, 0.66, 0.24]],
]

/** A cumulus `w` × `h` as CSS backgrounds: soft round puffs over a flat, slightly darker base. */
export function cumulusBackground(shape: readonly (readonly [number, number, number])[], w: number, h: number, lit: Rgb, shade: Rgb): string {
  const puffs = shape.map(([x, y, r]) =>
    `radial-gradient(circle ${(r * h).toFixed(1)}px at ${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%, ${rgba(lit)} 52%, ${rgba(lit, 0)} 100%)`)
  const base = `radial-gradient(ellipse ${(0.42 * w).toFixed(1)}px ${(0.17 * h).toFixed(1)}px at 51% 78%, ${rgba(shade)} 55%, ${rgba(shade, 0)} 100%)`
  return [...puffs, base].join(', ')
}
