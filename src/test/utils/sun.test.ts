// The sun's day for ambience, checked against published sunrise / sunset times
// in a daylight-saving zone (US Central). Runs with TZ pinned to Chicago.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { dayOfYear, guessPlace, moonAge, moonIllumination, placeForTimeZone, seasonAt, solarNoon, sunDay } from '../../utils/sun'

// Node re-reads TZ when it is assigned; put back this worker's zone by name (shared workers).
const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => { process.env.TZ = originalZone })

const CHICAGO = { lat: 41.88, lon: -87.63 }
const minutes = (hours: number) => Math.round(hours * 60)
/** Within `tol` minutes of hh:mm. */
function near(hours: number, hh: number, mm: number, tol = 4) {
  expect(Math.abs(minutes(hours) - (hh * 60 + mm))).toBeLessThanOrEqual(tol)
}

describe('sunDay', () => {
  it('matches Chicago in November (standard time): rise 06:33, set 16:35', () => {
    const day = sunDay(new Date(2026, 10, 7), CHICAGO)
    near(day.rise, 6, 33)
    near(day.set, 16, 35)
    expect(day.polar).toBeNull()
    expect(day.daylight).toBeGreaterThan(9.9)
    expect(day.daylight).toBeLessThan(10.2)
  })

  it('matches Chicago at midsummer (daylight saving): rise 05:15, set 20:29', () => {
    const day = sunDay(new Date(2026, 5, 21), CHICAGO)
    near(day.rise, 5, 15, 5)
    near(day.set, 20, 29, 5)
  })

  it('puts solar noon at the meridian less the equation of time', () => {
    // Early November the sun runs ~16 min fast: Chicago's noon ≈ 11:34 CST (halfway from 06:33 to 16:35).
    near(solarNoon(new Date(2026, 10, 3), CHICAGO.lon), 11, 34, 3)
  })

  it('climbs to its height at noon and is below the horizon at midnight', () => {
    const day = sunDay(new Date(2026, 10, 7), CHICAGO)
    expect(day.altitude(day.noon)).toBeCloseTo(day.maxAltitude, 6)
    expect(day.maxAltitude).toBeGreaterThan(25)
    expect(day.altitude(0)).toBeLessThan(-30)
    expect(Math.abs(day.altitude(day.rise))).toBeLessThan(1.5)
  })

  it('reports a polar night and a polar day', () => {
    expect(sunDay(new Date(2026, 11, 21), { lat: 78, lon: 15 }).polar).toBe('night')
    expect(sunDay(new Date(2026, 5, 21), { lat: 78, lon: 15 }).polar).toBe('day')
    expect(sunDay(new Date(2026, 5, 21), { lat: 78, lon: 15 }).daylight).toBe(24)
  })
})

describe('the moon', () => {
  it('is full on 24 Nov 2026 and new on 9 Nov 2026', () => {
    expect(moonIllumination(moonAge(new Date(Date.UTC(2026, 10, 24, 15))))).toBeGreaterThan(0.97)
    expect(moonIllumination(moonAge(new Date(Date.UTC(2026, 10, 9, 7))))).toBeLessThan(0.03)
  })

  it('ages within one synodic month', () => {
    const age = moonAge(new Date(1990, 0, 1))
    expect(age).toBeGreaterThanOrEqual(0)
    expect(age).toBeLessThan(29.54)
  })
})

describe('seasonAt', () => {
  it('reads whole months, six months on south of the equator', () => {
    expect(seasonAt(new Date(2026, 0, 15), 41)).toBe('winter')
    expect(seasonAt(new Date(2026, 3, 15), 41)).toBe('spring')
    expect(seasonAt(new Date(2026, 6, 15), 41)).toBe('summer')
    expect(seasonAt(new Date(2026, 10, 7), 41)).toBe('autumn')
    expect(seasonAt(new Date(2026, 0, 15), -33)).toBe('summer')
    expect(seasonAt(new Date(2026, 6, 15), -33)).toBe('winter')
  })
})

describe('places', () => {
  it('guesses a known zone\'s main city', () => {
    expect(placeForTimeZone('America/Chicago')).toEqual({ name: 'Chicago', lat: 41.88, lon: -87.63 })
    expect(placeForTimeZone('Mars/Olympus')).toBeNull()
    expect(guessPlace()).toMatchObject({ name: 'Chicago' })
  })

  it('counts the day of the year from 1 January', () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1)
    expect(dayOfYear(new Date(2026, 11, 31))).toBe(365)
  })
})
