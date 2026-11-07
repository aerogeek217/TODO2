import { describe, it, expect } from 'vitest'
import { DEFAULT_AMBIENCE } from '../../models/ambience'
import { formatAmbienceSettings, isDefaultAmbience, parseAmbienceSettings } from '../../utils/ambience-settings'

describe('ambience settings row', () => {
  it('round-trips', () => {
    const s = { enabled: false, place: { lat: -33.87, lon: 151.21 }, sky: 'vivid' as const, motion: 70, seasons: false }
    expect(parseAmbienceSettings(formatAmbienceSettings(s))).toEqual(s)
  })

  it('reads a missing or bad field as its default', () => {
    expect(parseAmbienceSettings('{}')).toEqual(DEFAULT_AMBIENCE)
    expect(parseAmbienceSettings('{"sky":"loud","motion":140,"place":{"lat":95,"lon":0},"enabled":"yes"}')).toEqual(DEFAULT_AMBIENCE)
    expect(parseAmbienceSettings('{"motion":12.5}')?.motion).toBe(DEFAULT_AMBIENCE.motion)
  })

  it('keeps a place to two decimals', () => {
    expect(parseAmbienceSettings('{"place":{"lat":41.87811,"lon":-87.62980}}')?.place).toEqual({ lat: 41.88, lon: -87.63 })
  })

  it('refuses text that is not a JSON object', () => {
    expect(parseAmbienceSettings('nope')).toBeUndefined()
    expect(parseAmbienceSettings('[1,2]')).toBeUndefined()
    expect(parseAmbienceSettings('null')).toBeUndefined()
  })

  it('knows the defaults', () => {
    expect(isDefaultAmbience(DEFAULT_AMBIENCE)).toBe(true)
    expect(isDefaultAmbience({ ...DEFAULT_AMBIENCE, place: { lat: 1, lon: 1 } })).toBe(false)
  })
})
