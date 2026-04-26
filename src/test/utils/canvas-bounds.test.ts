import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_CANVAS_MAX_EXTENT,
  MIN_CANVAS_MAX_EXTENT,
  MAX_CANVAS_MAX_EXTENT,
  ABSOLUTE_MIN_ZOOM,
  DEFAULT_MIN_ZOOM,
  clampCanvasPosition,
  deriveCanvasMinZoom,
  getCanvasMaxExtent,
  isValidCanvasMaxExtent,
} from '../../utils/canvas-bounds'
import { useSettingsStore } from '../../stores/settings-store'

beforeEach(() => {
  useSettingsStore.setState({ canvasMaxExtent: DEFAULT_CANVAS_MAX_EXTENT })
})

describe('isValidCanvasMaxExtent', () => {
  it('accepts integers within [MIN, MAX]', () => {
    expect(isValidCanvasMaxExtent(MIN_CANVAS_MAX_EXTENT)).toBe(true)
    expect(isValidCanvasMaxExtent(DEFAULT_CANVAS_MAX_EXTENT)).toBe(true)
    expect(isValidCanvasMaxExtent(MAX_CANVAS_MAX_EXTENT)).toBe(true)
    expect(isValidCanvasMaxExtent(5000)).toBe(true)
  })

  it('rejects out-of-range, NaN, and non-numbers', () => {
    expect(isValidCanvasMaxExtent(MIN_CANVAS_MAX_EXTENT - 1)).toBe(false)
    expect(isValidCanvasMaxExtent(MAX_CANVAS_MAX_EXTENT + 1)).toBe(false)
    expect(isValidCanvasMaxExtent(0)).toBe(false)
    expect(isValidCanvasMaxExtent(-100)).toBe(false)
    expect(isValidCanvasMaxExtent(NaN)).toBe(false)
    expect(isValidCanvasMaxExtent(Infinity)).toBe(false)
    expect(isValidCanvasMaxExtent('5000')).toBe(false)
    expect(isValidCanvasMaxExtent(null)).toBe(false)
    expect(isValidCanvasMaxExtent(undefined)).toBe(false)
  })
})

describe('getCanvasMaxExtent', () => {
  it('reads from the settings store when valid', () => {
    useSettingsStore.setState({ canvasMaxExtent: 7500 })
    expect(getCanvasMaxExtent()).toBe(7500)
  })

  it('falls back to DEFAULT when the store value is outside [MIN, MAX]', () => {
    useSettingsStore.setState({ canvasMaxExtent: 99999999 as unknown as number })
    expect(getCanvasMaxExtent()).toBe(DEFAULT_CANVAS_MAX_EXTENT)
  })
})

describe('clampCanvasPosition', () => {
  it('passes coordinates inside the band through unchanged', () => {
    expect(clampCanvasPosition(0, 0)).toEqual({ x: 0, y: 0 })
    expect(clampCanvasPosition(100, -100)).toEqual({ x: 100, y: -100 })
    expect(clampCanvasPosition(DEFAULT_CANVAS_MAX_EXTENT, -DEFAULT_CANVAS_MAX_EXTENT)).toEqual({
      x: DEFAULT_CANVAS_MAX_EXTENT,
      y: -DEFAULT_CANVAS_MAX_EXTENT,
    })
  })

  it('clamps coordinates beyond the band to the band edge', () => {
    expect(clampCanvasPosition(99999, 99999)).toEqual({
      x: DEFAULT_CANVAS_MAX_EXTENT,
      y: DEFAULT_CANVAS_MAX_EXTENT,
    })
    expect(clampCanvasPosition(-99999, -99999)).toEqual({
      x: -DEFAULT_CANVAS_MAX_EXTENT,
      y: -DEFAULT_CANVAS_MAX_EXTENT,
    })
  })

  it('reproduces the bug: stray (32723, -3278) gets pulled inside the default ±10000 band', () => {
    expect(clampCanvasPosition(32723, -3278)).toEqual({ x: 10000, y: -3278 })
  })

  it('respects an explicit max override', () => {
    expect(clampCanvasPosition(20000, -20000, 5000)).toEqual({ x: 5000, y: -5000 })
  })

  it('uses the live settings store when no max is passed', () => {
    useSettingsStore.setState({ canvasMaxExtent: 2000 })
    expect(clampCanvasPosition(5000, -5000)).toEqual({ x: 2000, y: -2000 })
  })
})

describe('deriveCanvasMinZoom', () => {
  // Default desktop viewport (1280) reference math:
  //   minZoom = 1280 / (2 × maxExtent × 1.15), clamped to [0.02, 0.2]

  it('caps at DEFAULT_MIN_ZOOM (0.2) for small extents — keeps legacy behavior', () => {
    // 1280 / (2 × 1000 × 1.15) ≈ 0.557 → clamped to 0.2
    expect(deriveCanvasMinZoom(1000)).toBe(DEFAULT_MIN_ZOOM)
    // 1280 / (2 × 2700 × 1.15) ≈ 0.206 → still clamped to 0.2
    expect(deriveCanvasMinZoom(2700)).toBe(DEFAULT_MIN_ZOOM)
  })

  it('drops below 0.2 when the extent forces it', () => {
    // 1280 / (2 × 5000 × 1.15) ≈ 0.111
    expect(deriveCanvasMinZoom(5000)).toBeCloseTo(0.111, 2)
    expect(deriveCanvasMinZoom(5000)).toBeLessThan(DEFAULT_MIN_ZOOM)
  })

  it('handles the default extent so fitView covers the full ±10000 band', () => {
    // 1280 / (2 × 10000 × 1.15) ≈ 0.0557
    const z = deriveCanvasMinZoom(DEFAULT_CANVAS_MAX_EXTENT)
    expect(z).toBeCloseTo(0.0557, 3)
    // sanity: at this zoom, 20000 px of canvas fits inside a ~1280 viewport
    // (with the 15% padding fitView applies)
    expect(20000 * z * 1.15).toBeLessThanOrEqual(1280 + 1)
  })

  it('floors at ABSOLUTE_MIN_ZOOM for the maximum allowed extent', () => {
    // 1280 / (2 × 100000 × 1.15) ≈ 0.0056 → clamped to 0.02
    expect(deriveCanvasMinZoom(MAX_CANVAS_MAX_EXTENT)).toBe(ABSOLUTE_MIN_ZOOM)
  })

  it('respects an explicit viewport-width override', () => {
    expect(deriveCanvasMinZoom(10000, 2560)).toBeCloseTo(0.111, 2)
  })
})
