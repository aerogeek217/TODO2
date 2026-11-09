/**
 * The ambience scene for one moment (`components/ambience`): where the sun
 * and the moon are over the top bar, the sky's colours, and how visible each
 * layer is once Sky strength and Header motion are applied. Pure — the
 * components only draw it.
 *
 * Its colours are CSS, never literals: the `--ambience-*` tokens in
 * `tokens.css` (where each theme defines its own), mixed by the time of day
 * with `color-mix()` — so the theme picks every colour and the scene only
 * says how much of each.
 */
import type { AmbiencePlace, AmbienceSettings, Season, SkyStrength, WeatherKind } from '../models/ambience'
import { moonAge, seasonAt, sunDay, SYNODIC_MONTH, type SunDay } from './sun'

/** A CSS colour: an `--ambience-*` token, or a `color-mix()` over them. */
export type CssColor = string

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number): number => clamp(v, 0, 1)

/** The top bar's height the sun and moon move in (`--topbar-height`). */
export const BAR_HEIGHT = 40

const share = (v: number): string => `${Number((v * 100).toFixed(3))}%`

/** `a` mixed toward `b` by `t` (0 = `a`, 1 = `b`), channel by channel in sRGB. */
export function mixColor(a: CssColor, b: CssColor, t: number): CssColor {
  if (t <= 0) return a
  if (t >= 1) return b
  return `color-mix(in srgb, ${a}, ${b} ${share(t)})`
}

/** The opaque colour `c` at `alpha`, as `rgba()` would draw it. */
export function withAlpha(c: CssColor, alpha: number): CssColor {
  if (alpha >= 1) return c
  if (alpha <= 0) return 'transparent'
  return `color-mix(in srgb, ${c} ${share(alpha)}, transparent)`
}

type Stop = readonly [altitude: number, ...colours: CssColor[]]

/** Interpolates colour `k` of a ramp of `[altitude, ...colours]` stops at `x`. */
function ramp(stops: readonly Stop[], k: number, x: number): CssColor {
  const colour = (stop: Stop | undefined): CssColor => stop?.[k + 1] as CssColor | undefined ?? 'transparent'
  const first = stops[0]
  if (!first || x <= first[0]) return colour(first)
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i]
    const lo = stops[i - 1]
    if (!hi || !lo || x > hi[0]) continue
    return mixColor(colour(lo), colour(hi), (x - lo[0]) / (hi[0] - lo[0]))
  }
  return colour(stops.at(-1))
}

/** The sky by the sun's altitude: [altitude°, zenith, horizon]. */
const SKY_STOPS: readonly Stop[] = [
  [-90, 'var(--ambience-sky-zenith-0)', 'var(--ambience-sky-horizon-0)'],
  [-18, 'var(--ambience-sky-zenith-1)', 'var(--ambience-sky-horizon-1)'],
  [-10, 'var(--ambience-sky-zenith-2)', 'var(--ambience-sky-horizon-2)'],
  [-4, 'var(--ambience-sky-zenith-3)', 'var(--ambience-sky-horizon-3)'],
  [0, 'var(--ambience-sky-zenith-4)', 'var(--ambience-sky-horizon-4)'],
  [4, 'var(--ambience-sky-zenith-5)', 'var(--ambience-sky-horizon-5)'],
  [10, 'var(--ambience-sky-zenith-6)', 'var(--ambience-sky-horizon-6)'],
  [25, 'var(--ambience-sky-zenith-7)', 'var(--ambience-sky-horizon-7)'],
  [90, 'var(--ambience-sky-zenith-8)', 'var(--ambience-sky-horizon-8)'],
]
/** The sun's colour by its altitude. */
const SUN_STOPS: readonly Stop[] = [
  [-6, 'var(--ambience-sun-0)'],
  [0, 'var(--ambience-sun-1)'],
  [6, 'var(--ambience-sun-2)'],
  [15, 'var(--ambience-sun-3)'],
  [40, 'var(--ambience-sun-4)'],
]

export function skyColors(altitude: number): { zenith: CssColor; horizon: CssColor } {
  return { zenith: ramp(SKY_STOPS, 0, altitude), horizon: ramp(SKY_STOPS, 1, altitude) }
}

export function sunColor(altitude: number): CssColor {
  return ramp(SUN_STOPS, 0, altitude)
}

/** How much of the sky shows through the top bar's glass at each strength (the glass's complement). */
const SKY_SHOW: Readonly<Record<SkyStrength, number>> = { whisper: 0.14, subtle: 0.28, vivid: 0.5 }
/** The lamplight and the hairline glow's strength. */
const LIGHT: Readonly<Record<SkyStrength, number>> = { whisper: 0.6, subtle: 1, vivid: 1.35 }
/** Clouds, aurora, mist and the sunbeam (Vivid = full). */
const SOFT: Readonly<Record<SkyStrength, number>> = { whisper: 0.4, subtle: 0.68, vivid: 1 }
/** The clouds, fainter still at Whisper. */
const CLOUDS: Readonly<Record<SkyStrength, number>> = { whisper: 0.27, subtle: 0.68, vivid: 1 }
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
  zenith: CssColor
  horizon: CssColor
  sun: CssColor
  /** How much of the horizon's glow shows around the sun (0 at night). */
  glow: number
  /** How deep into the night, 0–1 (the dark theme's clouds darken by it: `--ambience-cloud-tint-night`). */
  night: number
  /** The angle the sunbeam falls at, degrees (leaning away from the sun). */
  beamAngle: number
  /** What falls in the top bar; `null` when Seasons is off. */
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
  }
  /** The bright point on the hairline: under the sun by day, the moon by night; `null` when neither shows. */
  hairline: { x: number; color: CssColor; alpha: number; glowAlpha: number } | null
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

/**
 * The ambience at `now` at `place`. `theme` changes no colour (`tokens.css`
 * picks those), only two strengths: the stars show in the dark theme alone,
 * and the moon a little brighter there.
 */
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

  let weather: WeatherKind | null = null
  if (seasons) {
    weather = season === 'winter' ? 'flake' : season === 'autumn' ? 'leaf' : season === 'spring' ? 'petal' : altitude < -3 ? 'firefly' : 'seed'
  }

  let hairline: SkyScene['hairline'] = null
  if (altitude > -5) {
    hairline = { x: sunX, color: sun, alpha: clamp01((altitude + 5) / 8) * (0.55 + 0.45 * golden), glowAlpha: 0.4 * golden * LIGHT[strength] }
  } else if (moonUp > 0) {
    hairline = { x: moonX, color: 'var(--ambience-moon-point)', alpha: 0.5 * moonUp, glowAlpha: 0 }
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
    night,
    beamAngle: 90 + (clamp01(frac) - 0.5) * 80,
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
    },
    hairline,
  }
}

/** The sky behind the glass: the horizon's glow around the sun over a sweep from the sun's side to the zenith. */
export function skyBackground(scene: SkyScene): string {
  const { zenith, horizon, glow, sunX } = scene
  const x = (sunX * 100).toFixed(1)
  const edge = mixColor(zenith, horizon, 0.35 * glow)
  const left = sunX < 0.5 ? edge : zenith
  const right = sunX < 0.5 ? zenith : edge
  return `radial-gradient(ellipse 34% 320% at ${x}% 120%, ${withAlpha(horizon, 0.95 * glow)} 0%, transparent 100%), `
    + `linear-gradient(to right, ${left}, ${zenith} 50%, ${right})`
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

/**
 * A cumulus `w` × `h` as CSS backgrounds: soft round puffs over a flat,
 * slightly darker base, in the clouds layer's `--cloud` and `--cloud-shade`
 * (`AmbienceSky.module.css`, from the sky's horizon and the theme's tokens).
 */
export function cumulusBackground(shape: readonly (readonly [number, number, number])[], w: number, h: number): string {
  const puffs = shape.map(([x, y, r]) =>
    `radial-gradient(circle ${(r * h).toFixed(1)}px at ${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%, var(--cloud) 52%, transparent 100%)`)
  const base = `radial-gradient(ellipse ${(0.42 * w).toFixed(1)}px ${(0.17 * h).toFixed(1)}px at 51% 78%, var(--cloud-shade) 55%, transparent 100%)`
  return [...puffs, base].join(', ')
}
