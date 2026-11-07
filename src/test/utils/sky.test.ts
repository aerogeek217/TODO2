// The ambience scene: where the sun and moon sit over the bar and how each
// layer's opacity follows Sky strength, Header motion and Seasons.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DEFAULT_AMBIENCE, type AmbienceSettings } from '../../models/ambience'
import { cumulusBackground, CUMULUS_SHAPES, moonPath, skyBackground, skyScene } from '../../utils/sky'

const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => { process.env.TZ = originalZone })

const CHICAGO = { lat: 41.88, lon: -87.63 }
const settings = (changes: Partial<AmbienceSettings> = {}): AmbienceSettings => ({ ...DEFAULT_AMBIENCE, ...changes })
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min)

describe('skyScene', () => {
  it('puts the sun mid-bar at solar noon, on the hairline\'s bright point', () => {
    const s = skyScene(at(2026, 10, 7, 11, 44), CHICAGO, settings(), 'dark')
    expect(s.sunX).toBeGreaterThan(0.45)
    expect(s.sunX).toBeLessThan(0.55)
    expect(s.sunY).toBeLessThan(20)
    expect(s.hairline?.x).toBe(s.sunX)
    expect(s.opacity.stars).toBe(0)
    expect(s.opacity.moon).toBe(0)
  })

  it('sinks the sun toward the right edge at sunset and lights the evening', () => {
    const s = skyScene(at(2026, 10, 7, 16, 35), CHICAGO, settings(), 'dark')
    expect(s.sunX).toBeGreaterThan(0.9)
    expect(s.sunY).toBeGreaterThan(36)
    expect(s.hairline?.alpha).toBeGreaterThan(0.3)
  })

  it('shows the moon and the stars at night, the stars in the dark theme only', () => {
    const dark = skyScene(at(2026, 10, 7, 23), CHICAGO, settings(), 'dark')
    expect(dark.opacity.stars).toBeGreaterThan(0)
    expect(dark.opacity.moon).toBeGreaterThan(0)
    expect(dark.opacity.lamp).toBeGreaterThan(0)
    expect(dark.opacity.sunDisc).toBe(0)
    expect(skyScene(at(2026, 10, 7, 23), CHICAGO, settings(), 'light').opacity.stars).toBe(0)
  })

  it('shows the sky through the glass by strength', () => {
    const noon = at(2026, 10, 7, 12)
    expect(skyScene(noon, CHICAGO, settings({ sky: 'whisper' }), 'dark').opacity.sky).toBeCloseTo(0.14)
    expect(skyScene(noon, CHICAGO, settings({ sky: 'subtle' }), 'dark').opacity.sky).toBeCloseTo(0.28)
    expect(skyScene(noon, CHICAGO, settings({ sky: 'vivid' }), 'dark').opacity.sky).toBeCloseTo(0.5)
  })

  it('makes clouds fainter at Whisper than at Subtle and Vivid', () => {
    const noon = at(2026, 10, 7, 12)
    const clouds = (sky: AmbienceSettings['sky']) => skyScene(noon, CHICAGO, settings({ sky }), 'dark').opacity.clouds
    expect(clouds('whisper')).toBeLessThan(clouds('subtle'))
    expect(clouds('subtle')).toBeLessThan(clouds('vivid'))
  })

  it('stills everything that moves at Header motion 0, but keeps the sky', () => {
    const s = skyScene(at(2026, 0, 18, 23), CHICAGO, settings({ motion: 0 }), 'dark')
    expect(s.opacity.sky).toBeGreaterThan(0)
    expect(s.opacity.stars).toBe(0)
    expect(s.opacity.moon).toBe(0)
    expect(s.opacity.clouds).toBe(0)
    expect(s.opacity.aurora).toBe(0)
    expect(s.opacity.weather).toBe(0)
  })

  it('picks the season\'s weather, and the aurora on winter nights only', () => {
    expect(skyScene(at(2026, 0, 18, 23), CHICAGO, settings(), 'dark').weather).toBe('flake')
    expect(skyScene(at(2026, 0, 18, 23), CHICAGO, settings(), 'dark').opacity.aurora).toBeGreaterThan(0)
    expect(skyScene(at(2026, 0, 18, 12), CHICAGO, settings(), 'dark').opacity.aurora).toBe(0)
    expect(skyScene(at(2026, 10, 7, 12), CHICAGO, settings(), 'dark').weather).toBe('leaf')
    expect(skyScene(at(2026, 3, 12, 12), CHICAGO, settings(), 'dark').weather).toBe('petal')
    expect(skyScene(at(2026, 6, 12, 12), CHICAGO, settings(), 'dark').weather).toBe('seed')
    expect(skyScene(at(2026, 6, 12, 23), CHICAGO, settings(), 'dark').weather).toBe('firefly')
  })

  it('drops the weather, the aurora and the cells\' weather with Seasons off', () => {
    const s = skyScene(at(2026, 0, 18, 23), CHICAGO, settings({ seasons: false }), 'dark')
    expect(s.weather).toBeNull()
    expect(s.opacity.aurora).toBe(0)
    expect(s.opacity.weather).toBe(0)
    expect(s.opacity.behind).toBe(0)
  })

  it('lays mist on the hairline after sunrise only', () => {
    expect(skyScene(at(2026, 10, 7, 6, 50), CHICAGO, settings(), 'dark').opacity.mist).toBeGreaterThan(0)
    expect(skyScene(at(2026, 10, 7, 12), CHICAGO, settings(), 'dark').opacity.mist).toBe(0)
  })

  it('casts the sunbeam around golden hour only', () => {
    expect(skyScene(at(2026, 10, 7, 15, 55), CHICAGO, settings(), 'dark').opacity.sunbeam).toBeGreaterThan(0)
    expect(skyScene(at(2026, 10, 7, 23), CHICAGO, settings(), 'dark').opacity.sunbeam).toBe(0)
  })
})

describe('drawing helpers', () => {
  it('builds the sky as a glow over a sweep', () => {
    const bg = skyBackground(skyScene(at(2026, 10, 7, 16), CHICAGO, settings(), 'dark'))
    expect(bg).toMatch(/^radial-gradient\(ellipse/)
    expect(bg).toContain('linear-gradient(to right')
  })

  it('draws a full moon round and a crescent thin', () => {
    // Just before full: lit on the right, the terminator bulging all the way left.
    expect(moonPath(14.6, false, 6, 6, 5)).toMatch(/^M6 1 A5 5 0 0 1 6 11 A(4\.9\d|5\.00) 5 0 0 1 6 1 Z$/)
    expect(moonPath(3, false, 6, 6, 5)).toMatch(/A5 5 0 0 1 6 11 A[\d.]+ 5 0 0 0 6 1 Z$/)
    expect(moonPath(3, true, 6, 6, 5)).toMatch(/A5 5 0 0 0 6 11/)
  })

  it('makes a cumulus of puffs over a base', () => {
    const shape = CUMULUS_SHAPES[2] ?? []
    const bg = cumulusBackground(shape, 75, 30, [255, 255, 255], [200, 200, 200])
    expect(bg.match(/radial-gradient\(circle/g)).toHaveLength(shape.length)
    expect(bg).toContain('radial-gradient(ellipse')
  })
})
