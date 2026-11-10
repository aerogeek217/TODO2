// The top bar's rare sky events: when each may show (the scene's day / night
// gating, reduced motion, Header motion 0), the gaps between them, and the
// paths they take — plus the stars' and the evening planet's visibility.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DEFAULT_AMBIENCE, type AmbienceSettings } from '../../models/ambience'
import { planetTonight, skyScene } from '../../utils/sky'
import {
  allowedSkyEvents, nextSkyEventGapMs, planSkyEvent, SKY_EVENT_DURATION_MS, SKY_EVENT_GAP_MS, SKY_EVENT_KINDS,
} from '../../utils/sky-events'

const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => { process.env.TZ = originalZone })

const CHICAGO = { lat: 41.88, lon: -87.63 }
const settings = (changes: Partial<AmbienceSettings> = {}): AmbienceSettings => ({ ...DEFAULT_AMBIENCE, ...changes })
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min)
const NOON = at(2026, 10, 7, 12)
const NIGHT = at(2026, 10, 7, 23)
const DUSK = at(2026, 10, 7, 16, 45)

/** A generator handing out `values` in turn (then 0.5). */
const draws = (...values: number[]) => () => values.shift() ?? 0.5

/** Park–Miller, for many draws. */
function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

describe('when the sky events may show', () => {
  it('a shooting star and a UFO at night, an airplane by day', () => {
    expect(allowedSkyEvents(skyScene(NIGHT, CHICAGO, settings(), 'dark'), false)).toEqual({ shootingStar: true, ufo: true, airplane: false })
    expect(allowedSkyEvents(skyScene(NOON, CHICAGO, settings(), 'dark'), false)).toEqual({ shootingStar: false, ufo: false, airplane: true })
  })

  it('none in the twilight between (the sky not yet dark, the sun too low for a clear day)', () => {
    expect(allowedSkyEvents(skyScene(DUSK, CHICAGO, settings(), 'dark'), false)).toEqual({ shootingStar: false, ufo: false, airplane: false })
  })

  it('the shooting star in the dark theme only, as the stars; the UFO and the airplane in both', () => {
    expect(allowedSkyEvents(skyScene(NIGHT, CHICAGO, settings(), 'light'), false)).toEqual({ shootingStar: false, ufo: true, airplane: false })
    expect(allowedSkyEvents(skyScene(NOON, CHICAGO, settings(), 'light'), false).airplane).toBe(true)
  })

  it('none under reduced motion', () => {
    for (const when of [NIGHT, NOON]) {
      expect(allowedSkyEvents(skyScene(when, CHICAGO, settings(), 'dark'), true)).toEqual({ shootingStar: false, ufo: false, airplane: false })
    }
  })

  it('none at Header motion 0; fainter at low motion and at Whisper', () => {
    for (const when of [NIGHT, NOON]) {
      const scene = skyScene(when, CHICAGO, settings({ motion: 0 }), 'dark')
      expect(scene.events).toEqual({ shootingStar: 0, ufo: 0, airplane: 0 })
      expect(allowedSkyEvents(scene, false)).toEqual({ shootingStar: false, ufo: false, airplane: false })
    }
    const ufo = (changes: Partial<AmbienceSettings>) => skyScene(NIGHT, CHICAGO, settings(changes), 'dark').events.ufo
    expect(ufo({ motion: 10 })).toBeLessThan(ufo({ motion: 40 }))
    expect(ufo({ sky: 'whisper', motion: 100 })).toBeLessThan(ufo({ sky: 'vivid', motion: 100 }))
    expect(ufo({ sky: 'vivid', motion: 100 })).toBe(1)
  })
})

describe('the gaps between them', () => {
  it('fall within each kind’s window: a shooting star every 2–5 minutes, a UFO every 1–2 hours, an airplane every 5–10 minutes', () => {
    expect(SKY_EVENT_GAP_MS).toEqual({ shootingStar: [120_000, 300_000], ufo: [3_600_000, 7_200_000], airplane: [300_000, 600_000] })
    for (const kind of SKY_EVENT_KINDS) {
      const [lo, hi] = SKY_EVENT_GAP_MS[kind]
      expect(nextSkyEventGapMs(kind, () => 0)).toBe(lo)
      expect(nextSkyEventGapMs(kind, () => 0.999999)).toBeLessThanOrEqual(hi)
      expect(nextSkyEventGapMs(kind, () => 0.999999)).toBeGreaterThan(hi - 10)
    }
  })

  it('average the middle of the window over many draws', () => {
    const random = seeded(11)
    const gaps = Array.from({ length: 2000 }, () => nextSkyEventGapMs('shootingStar', random))
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(120_000)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(300_000)
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    expect(mean).toBeGreaterThan(200_000)
    expect(mean).toBeLessThan(220_000)
  })
})

describe('the paths they take', () => {
  it('lasts its kind’s length: a shooting star about a second, a UFO 14–20 s, an airplane 50–75 s', () => {
    expect(SKY_EVENT_DURATION_MS).toEqual({ shootingStar: [800, 1200], ufo: [14_000, 20_000], airplane: [50_000, 75_000] })
    for (const kind of SKY_EVENT_KINDS) {
      const random = seeded(3)
      for (let i = 0; i < 50; i++) {
        const spec = planSkyEvent(kind, random, i)
        expect(spec.kind).toBe(kind)
        expect(spec.id).toBe(i)
        expect(spec.durMs).toBeGreaterThanOrEqual(SKY_EVENT_DURATION_MS[kind][0])
        expect(spec.durMs).toBeLessThanOrEqual(SKY_EVENT_DURATION_MS[kind][1])
      }
    }
  })

  it('sends a shooting star shallowly down, either way, starting on the side it falls away from', () => {
    // Duration, then direction (< 0.5 = toward the left), tilt, x …
    const left = planSkyEvent('shootingStar', draws(0.5, 0.1, 0, 0), 1)
    expect(left).toMatchObject({ kind: 'shootingStar', durMs: 1000, angle: 174, x: 0.3 })
    const right = planSkyEvent('shootingStar', draws(0.5, 0.9, 1, 1), 2)
    expect(right).toMatchObject({ angle: 16, x: 0.7 })
    const random = seeded(5)
    for (let i = 0; i < 100; i++) {
      const s = planSkyEvent('shootingStar', random, i)
      if (s.kind !== 'shootingStar') throw new Error('kind')
      expect(s.y).toBeGreaterThanOrEqual(2)
      expect(s.y).toBeLessThanOrEqual(14)
      expect(s.angle < 20 || s.angle > 160).toBe(true)
      expect(s.travel).toBeGreaterThanOrEqual(120)
    }
  })

  it('drifts a UFO across a stretch of the bar, not all of it, staying in the bar', () => {
    const random = seeded(9)
    for (let i = 0; i < 100; i++) {
      const u = planSkyEvent('ufo', random, i)
      if (u.kind !== 'ufo') throw new Error('kind')
      expect(Math.abs(u.travel)).toBeGreaterThanOrEqual(0.18)
      expect(Math.abs(u.travel)).toBeLessThanOrEqual(0.34)
      expect(u.x + u.travel).toBeGreaterThan(0)
      expect(u.x + u.travel).toBeLessThan(1)
    }
  })

  it('flies an airplane high in the bar, either way', () => {
    expect(planSkyEvent('airplane', draws(0, 0, 0.2), 1)).toEqual({ kind: 'airplane', id: 1, durMs: 50_000, y: 6, east: true })
    expect(planSkyEvent('airplane', draws(1, 1, 0.8), 2)).toEqual({ kind: 'airplane', id: 2, durMs: 75_000, y: 16, east: false })
  })
})

describe('the stars and the planet', () => {
  it('scales the stars by Sky strength, gone at Header motion 0', () => {
    const stars = (changes: Partial<AmbienceSettings>) => skyScene(NIGHT, CHICAGO, settings(changes), 'dark').opacity.stars
    expect(stars({ sky: 'whisper' })).toBeLessThan(stars({ sky: 'subtle' }))
    expect(stars({ sky: 'subtle' })).toBeLessThan(stars({ sky: 'vivid' }))
    // The defaults (Whisper, motion 40) show them clearly.
    expect(stars({})).toBeGreaterThan(0.6)
    expect(stars({ motion: 0 })).toBe(0)
  })

  it('shows the planet on about three nights in five, the same all night', () => {
    let shown = 0
    for (let d = 0; d < 200; d++) {
      const evening = at(2026, 0, 1 + d, 21)
      const smallHours = at(2026, 0, 2 + d, 3)
      expect(planetTonight(smallHours)).toEqual(planetTonight(evening))
      if (planetTonight(evening).shows) shown++
    }
    expect(shown).toBeGreaterThan(95)
    expect(shown).toBeLessThan(145)
  })

  it('draws it from dusk, low mid-bar, right of the moon, in the dark theme only; never by day', () => {
    const nights = Array.from({ length: 30 }, (_, d) => at(2026, 10, 1 + d, 18))
    const night = nights.find((n) => planetTonight(n).shows)
    const none = nights.find((n) => !planetTonight(n).shows)
    if (!night || !none) throw new Error('expected nights with and without the planet')
    const dusk = skyScene(night, CHICAGO, settings(), 'dark')
    expect(dusk.opacity.planet).toBeGreaterThan(0)
    expect(dusk.planetX).toBeGreaterThanOrEqual(0.5)
    expect(dusk.planetX).toBeLessThan(0.65)
    expect(dusk.planetY).toBeGreaterThan(24)
    // Right of the moon all the time it shows.
    for (let h = 18; h <= 30; h++) {
      const s = skyScene(new Date(night.getFullYear(), night.getMonth(), night.getDate(), h), CHICAGO, settings(), 'dark')
      if (s.opacity.planet > 0) expect(s.planetX - s.moonX).toBeGreaterThan(0.05)
    }
    expect(skyScene(night, CHICAGO, settings(), 'light').opacity.planet).toBe(0)
    expect(skyScene(none, CHICAGO, settings(), 'dark').opacity.planet).toBe(0)
    expect(skyScene(new Date(night.getFullYear(), night.getMonth(), night.getDate(), 12), CHICAGO, settings(), 'dark').opacity.planet).toBe(0)
    // Set by the night's last quarter (before dawn).
    expect(skyScene(new Date(night.getFullYear(), night.getMonth(), night.getDate() + 1, 5), CHICAGO, settings(), 'dark').opacity.planet).toBe(0)
  })
})
