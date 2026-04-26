import { describe, it, expect } from 'vitest'
import {
  parseHorizonSlots,
  normalizeHorizonSlots,
  resolveLegacySelectedHorizon,
  LEGACY_HORIZON_KEYS,
} from '../../utils/horizon-slots'

/**
 * `settings.horizonSlots` shape changed in stats-widgets-2026-04-25 P6 from
 * `Partial<Record<HorizonKey, number>>` (5-key map) to plain `number[]`. The
 * parser auto-flattens legacy values via `LEGACY_HORIZON_KEYS` iteration order
 * so existing user settings (and backups) keep working without a Dexie version
 * bump.
 *
 * `selectedHorizon: HorizonKey` likewise migrated to
 * `selectedHorizonDefId: number | null`. `resolveLegacySelectedHorizon`
 * resolves the legacy string against the legacy map so the right slot stays
 * selected on first load.
 */
describe('parseHorizonSlots — legacy 5-key map → number[] flatten', () => {
  it('flattens a complete legacy map in canonical iteration order', () => {
    const legacy = JSON.stringify({
      thisweek: 10,
      nextweek: 20,
      thismonth: 30,
      later: 40,
      someday: 50,
    })
    expect(parseHorizonSlots(legacy)).toEqual([10, 20, 30, 40, 50])
  })

  it('flattens a partial legacy map preserving canonical order (skips unset keys)', () => {
    const legacy = JSON.stringify({ thisweek: 1, thismonth: 3, someday: 5 })
    expect(parseHorizonSlots(legacy)).toEqual([1, 3, 5])
  })

  it('returns [] for an empty legacy map', () => {
    expect(parseHorizonSlots(JSON.stringify({}))).toEqual([])
  })

  it('drops unknown legacy keys silently', () => {
    const legacy = JSON.stringify({ thisweek: 1, unknownKey: 99, someday: 5 })
    expect(parseHorizonSlots(legacy)).toEqual([1, 5])
  })

  it('drops non-finite numeric values', () => {
    const legacy = JSON.stringify({ thisweek: 1, nextweek: NaN, later: Infinity, someday: 5 })
    // JSON.stringify converts NaN/Infinity to null — normalize drops them.
    expect(parseHorizonSlots(legacy)).toEqual([1, 5])
  })
})

describe('parseHorizonSlots — already-array (post-P6) shape', () => {
  it('passes a number[] through unchanged', () => {
    const arr = JSON.stringify([7, 11, 13])
    expect(parseHorizonSlots(arr)).toEqual([7, 11, 13])
  })

  it('drops non-numeric / non-finite array entries', () => {
    const mixed = JSON.stringify([7, 'oops', null, 13, NaN])
    expect(parseHorizonSlots(mixed)).toEqual([7, 13])
  })

  it('returns [] for an empty array', () => {
    expect(parseHorizonSlots('[]')).toEqual([])
  })
})

describe('parseHorizonSlots — degenerate / missing inputs', () => {
  it('returns [] for null / undefined', () => {
    expect(parseHorizonSlots(null)).toEqual([])
    expect(parseHorizonSlots(undefined)).toEqual([])
  })

  it('returns [] for empty string', () => {
    expect(parseHorizonSlots('')).toEqual([])
  })

  it('returns [] for invalid JSON', () => {
    expect(parseHorizonSlots('{not json')).toEqual([])
  })

  it('returns [] for primitive scalar values', () => {
    expect(parseHorizonSlots('42')).toEqual([])
    expect(parseHorizonSlots('"thisweek"')).toEqual([])
    expect(parseHorizonSlots('true')).toEqual([])
  })
})

describe('normalizeHorizonSlots (already-parsed input)', () => {
  it('mirrors parseHorizonSlots semantics over arrays', () => {
    expect(normalizeHorizonSlots([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('mirrors parseHorizonSlots semantics over legacy maps', () => {
    expect(normalizeHorizonSlots({ thisweek: 1, later: 4 })).toEqual([1, 4])
  })

  it('returns [] for a primitive scalar', () => {
    expect(normalizeHorizonSlots(42)).toEqual([])
    expect(normalizeHorizonSlots('foo')).toEqual([])
    expect(normalizeHorizonSlots(null)).toEqual([])
  })
})

describe('resolveLegacySelectedHorizon — legacy selectedHorizon → defId', () => {
  it('returns the defId stored under the legacy key', () => {
    const legacyMap = JSON.stringify({ thisweek: 100, nextweek: 200, someday: 300 })
    expect(resolveLegacySelectedHorizon('thisweek', legacyMap)).toBe(100)
    expect(resolveLegacySelectedHorizon('nextweek', legacyMap)).toBe(200)
    expect(resolveLegacySelectedHorizon('someday', legacyMap)).toBe(300)
  })

  it('returns null when the legacy key is not present in the map', () => {
    const legacyMap = JSON.stringify({ thisweek: 100 })
    expect(resolveLegacySelectedHorizon('someday', legacyMap)).toBeNull()
  })

  it('returns null when the legacy selectedHorizon string is unknown', () => {
    const legacyMap = JSON.stringify({ thisweek: 100 })
    expect(resolveLegacySelectedHorizon('not-a-known-key', legacyMap)).toBeNull()
  })

  it('returns null when legacySelected is missing', () => {
    expect(resolveLegacySelectedHorizon(null, JSON.stringify({ thisweek: 1 }))).toBeNull()
    expect(resolveLegacySelectedHorizon(undefined, JSON.stringify({ thisweek: 1 }))).toBeNull()
    expect(resolveLegacySelectedHorizon('', JSON.stringify({ thisweek: 1 }))).toBeNull()
  })

  it('returns null when the legacy map value is missing', () => {
    expect(resolveLegacySelectedHorizon('thisweek', null)).toBeNull()
    expect(resolveLegacySelectedHorizon('thisweek', undefined)).toBeNull()
    expect(resolveLegacySelectedHorizon('thisweek', '')).toBeNull()
  })

  it('returns null when the legacy map is invalid JSON or an array', () => {
    expect(resolveLegacySelectedHorizon('thisweek', '{not json')).toBeNull()
    expect(resolveLegacySelectedHorizon('thisweek', '[1, 2, 3]')).toBeNull()
  })

  it('returns null when the resolved value is not a finite number', () => {
    const legacyMap = JSON.stringify({ thisweek: 'not a number', someday: null })
    expect(resolveLegacySelectedHorizon('thisweek', legacyMap)).toBeNull()
    expect(resolveLegacySelectedHorizon('someday', legacyMap)).toBeNull()
  })
})

describe('LEGACY_HORIZON_KEYS — canonical iteration order', () => {
  it('lists the five legacy keys in the documented order', () => {
    expect(LEGACY_HORIZON_KEYS).toEqual([
      'thisweek',
      'nextweek',
      'thismonth',
      'later',
      'someday',
    ])
  })
})
