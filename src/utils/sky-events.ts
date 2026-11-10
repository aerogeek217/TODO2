/**
 * The top bar's rare sky events (`components/ambience/AmbienceSky`): a
 * shooting star or a UFO at night, an airplane by day. Pure — when each may
 * show (from the scene), how long until the next one, and the path one takes;
 * `hooks/use-sky-events` runs the timers and the CSS draws the motion.
 */
import type { SkyScene } from './sky'

export type SkyEventKind = 'shootingStar' | 'ufo' | 'airplane'

export const SKY_EVENT_KINDS: readonly SkyEventKind[] = ['shootingStar', 'ufo', 'airplane']

const MINUTE = 60_000

/**
 * The wait before each kind's next event, `[shortest, longest]` in ms, drawn
 * evenly between the two — counted from when the last one ended (or from when
 * the kind could first show: a reload never starts with one).
 */
export const SKY_EVENT_GAP_MS: Readonly<Record<SkyEventKind, readonly [number, number]>> = {
  shootingStar: [2 * MINUTE, 5 * MINUTE],
  ufo: [60 * MINUTE, 120 * MINUTE],
  airplane: [5 * MINUTE, 10 * MINUTE],
}

/** How long one lasts on screen, `[shortest, longest]` in ms. */
export const SKY_EVENT_DURATION_MS: Readonly<Record<SkyEventKind, readonly [number, number]>> = {
  shootingStar: [800, 1200],
  ufo: [14_000, 20_000],
  airplane: [50_000, 75_000],
}

const between = (range: readonly [number, number], r: number): number => range[0] + (range[1] - range[0]) * r
const round = (v: number, digits = 1): number => Number(v.toFixed(digits))

/** The wait before the next `kind`, in ms, from one draw of `random` (0–1). */
export function nextSkyEventGapMs(kind: SkyEventKind, random: () => number): number {
  return Math.round(between(SKY_EVENT_GAP_MS[kind], random()))
}

/**
 * Which kinds may show now: only while the scene draws them (`scene.events`:
 * the dark sky for the shooting star and the UFO — the shooting star in the
 * dark theme only, as the stars —, full day for the airplane, none at Header
 * motion 0) and never under reduced motion.
 */
export function allowedSkyEvents(scene: SkyScene, still: boolean): Record<SkyEventKind, boolean> {
  return {
    shootingStar: !still && scene.events.shootingStar > 0,
    ufo: !still && scene.events.ufo > 0,
    airplane: !still && scene.events.airplane > 0,
  }
}

/** A shooting star: a short streak from (`x` of the bar, `y` px), at `angle`° (over 90 = toward the left), `travel` px along it. */
export interface ShootingStarSpec { kind: 'shootingStar'; id: number; durMs: number; x: number; y: number; angle: number; travel: number; length: number }
/** A UFO: from (`x` of the bar, `y` px), drifting `travel` of the bar's width (negative = left), hovering and hopping midway. */
export interface UfoSpec { kind: 'ufo'; id: number; durMs: number; x: number; y: number; travel: number }
/** An airplane: across the whole bar at `y` px, west to east (`east`) or back. */
export interface AirplaneSpec { kind: 'airplane'; id: number; durMs: number; y: number; east: boolean }

export type SkyEventSpec = ShootingStarSpec | UfoSpec | AirplaneSpec

/** One `kind` event's path and length, each draw of `random` (0–1) placing it. */
export function planSkyEvent(kind: SkyEventKind, random: () => number, id: number): SkyEventSpec {
  const durMs = Math.round(between(SKY_EVENT_DURATION_MS[kind], random()))
  switch (kind) {
    case 'shootingStar': {
      const left = random() < 0.5
      const tilt = 6 + random() * 10
      return {
        kind, id, durMs,
        // Starting toward the side it falls away from, so the streak stays in the bar.
        x: round(left ? 0.3 + random() * 0.6 : 0.1 + random() * 0.6, 3),
        y: round(2 + random() * 12),
        angle: round(left ? 180 - tilt : tilt),
        travel: Math.round(120 + random() * 90),
        length: Math.round(56 + random() * 34),
      }
    }
    case 'ufo': {
      const left = random() < 0.5
      const travel = 0.18 + random() * 0.16
      return {
        kind, id, durMs,
        x: round(left ? 0.4 + random() * 0.45 : 0.1 + random() * 0.45, 3),
        y: round(9 + random() * 12),
        travel: round(left ? -travel : travel, 3),
      }
    }
    case 'airplane':
      return { kind, id, durMs, y: round(6 + random() * 10), east: random() < 0.5 }
  }
}
