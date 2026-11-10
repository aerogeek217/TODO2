// The top bar's sky events as drawn: each appears only when its gap has run
// and its hours allow it, goes when it has run, and none come under reduced
// motion, at Header motion 0 or with ambience off. The stars and the planet
// render in the dark night sky.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, renderHook } from '@testing-library/react'
import { AmbienceSky } from '../../../components/ambience/AmbienceSky'
import { SKY_EVENT_DEBUG, useSkyEvents } from '../../../hooks/use-sky-events'
import { useSettingsStore } from '../../../stores/settings-store'
import { DEFAULT_AMBIENCE, type AmbienceSettings } from '../../../models/ambience'
import { planetTonight } from '../../../utils/sky'
import { pinTimeZone } from '../../time-zone'

pinTimeZone('America/Chicago')

const CHICAGO = { lat: 41.88, lon: -87.63 }
const MINUTE = 60_000
const realMatchMedia = window.matchMedia

function setAmbience(changes: Partial<AmbienceSettings> = {}) {
  useSettingsStore.setState({ themeMode: 'dark', ambience: { ...DEFAULT_AMBIENCE, place: CHICAGO, sky: 'vivid', motion: 100, ...changes } })
}

function reducedMotion(on: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: on && query.includes('reduced-motion') })) as typeof window.matchMedia
}

const shown = (container: HTMLElement) => [...container.querySelectorAll('[data-sky-event]')].map((el) => el.getAttribute('data-sky-event'))
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const renderSky = () => render(<header style={{ position: 'relative' }}><AmbienceSky /></header>).container

beforeEach(() => {
  vi.useFakeTimers()
  // Every draw 0: each gap its kind's shortest, each event its shortest.
  vi.spyOn(Math, 'random').mockReturnValue(0)
  setAmbience()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.matchMedia = realMatchMedia
})

describe('the sky events in the top bar', () => {
  it('a shooting star at night once its gap has run, gone a second later', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 23))
    const container = renderSky()
    expect(shown(container)).toEqual([])
    advance(2 * MINUTE - 1)
    expect(shown(container)).toEqual([])
    advance(1)
    expect(shown(container)).toEqual(['shootingStar'])
    const streak = container.querySelector('[data-sky-event="shootingStar"]') as HTMLElement
    expect(streak.style.getPropertyValue('--dur')).toBe('800ms')
    advance(800 + 250)
    expect(shown(container)).toEqual([])
    // The next one waits its own gap from there.
    advance(2 * MINUTE - 1)
    expect(shown(container)).toEqual([])
    advance(1)
    expect(shown(container)).toEqual(['shootingStar'])
  })

  it('a UFO at most once an hour at night; never an airplane', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 22))
    const container = renderSky()
    const seen = new Set<string | null>()
    for (let m = 0; m < 59; m++) { advance(MINUTE); shown(container).forEach((k) => seen.add(k)) }
    expect(seen.has('ufo')).toBe(false)
    advance(MINUTE)
    expect(shown(container)).toContain('ufo')
    expect(seen.has('airplane')).toBe(false)
  })

  it('an airplane by day every 5–10 minutes, crossing the bar; no shooting star or UFO', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 11))
    const container = renderSky()
    advance(5 * MINUTE - 1)
    expect(shown(container)).toEqual([])
    advance(1)
    expect(shown(container)).toEqual(['airplane'])
    const plane = container.querySelector('[data-sky-event="airplane"]') as HTMLElement
    expect(plane.style.getPropertyValue('--dur')).toBe('50000ms')
    expect(plane.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    advance(50_000 + 250)
    expect(shown(container)).toEqual([])
    for (let m = 0; m < 120; m++) { advance(MINUTE); expect(shown(container)).not.toContain('ufo') }
  })

  it('draws them inside the aria-hidden sky layer', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 11))
    const container = renderSky()
    advance(5 * MINUTE)
    expect(container.querySelector('[data-sky-event]')?.closest('[data-ambience="sky"]')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('none under reduced motion, and the stars hold still', () => {
    reducedMotion(true)
    vi.setSystemTime(new Date(2026, 10, 7, 23))
    const container = renderSky()
    for (let m = 0; m < 70; m++) { advance(MINUTE); expect(shown(container)).toEqual([]) }
    expect(container.querySelector('[data-ambience="sky"]')?.className).toMatch(/still/)
  })

  it('none at Header motion 0', () => {
    setAmbience({ motion: 0 })
    vi.setSystemTime(new Date(2026, 10, 7, 23))
    const container = renderSky()
    for (let m = 0; m < 70; m++) { advance(MINUTE); expect(shown(container)).toEqual([]) }
  })

  it('none with ambience off (and no timers left running)', () => {
    setAmbience({ enabled: false })
    vi.setSystemTime(new Date(2026, 10, 7, 23))
    const container = renderSky()
    expect(vi.getTimerCount()).toBe(0)
    advance(70 * MINUTE)
    expect(container.querySelector('[data-ambience]')).toBeNull()
  })

  it('skips one due while the page is hidden', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 23))
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    const container = renderSky()
    advance(2 * MINUTE)
    expect(shown(container)).toEqual([])
    hidden.mockReturnValue(false)
    advance(2 * MINUTE)
    expect(shown(container)).toEqual(['shootingStar'])
  })

  it('development: calls one up now, out of its hours', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 11))
    const container = renderSky()
    act(() => { document.dispatchEvent(new CustomEvent(SKY_EVENT_DEBUG, { detail: 'ufo' })) })
    expect(shown(container)).toEqual(['ufo'])
    act(() => { document.dispatchEvent(new CustomEvent(SKY_EVENT_DEBUG, { detail: 'nonsense' })) })
    expect(shown(container)).toEqual(['ufo'])
    advance(14_000 + 250)
    expect(shown(container)).toEqual([])
  })
})

describe('the stars and the planet', () => {
  it('draws the stars at night, a few bright', () => {
    vi.setSystemTime(new Date(2026, 10, 7, 23))
    const container = renderSky()
    const stars = container.querySelectorAll('[class*="stars"] > i')
    expect(stars.length).toBe(40)
    expect(container.querySelectorAll('[class*="starBright"]').length).toBeGreaterThan(2)
  })

  it('draws the planet on its nights, steady (no animation of its own)', () => {
    const evenings = Array.from({ length: 30 }, (_, d) => new Date(2026, 10, 1 + d, 19))
    const on = evenings.find((e) => planetTonight(e).shows)
    const off = evenings.find((e) => !planetTonight(e).shows)
    if (!on || !off) throw new Error('expected evenings with and without the planet')
    vi.setSystemTime(on)
    const container = renderSky()
    expect(container.querySelector('[class*="planet"]')).not.toBeNull()
    cleanup()
    vi.setSystemTime(off)
    expect(renderSky().querySelector('[class*="planet"]')).toBeNull()
  })
})

describe('useSkyEvents', () => {
  it('stops the wait and takes down the one showing when its kind may no longer show', () => {
    const allowed = { shootingStar: true, ufo: false, airplane: false }
    const { result, rerender } = renderHook((a: typeof allowed) => useSkyEvents(a, () => 0), { initialProps: allowed })
    advance(2 * MINUTE)
    expect(result.current.shootingStar?.kind).toBe('shootingStar')
    rerender({ ...allowed, shootingStar: false })
    expect(result.current.shootingStar).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('takes its draws from the random it is given', () => {
    const random = vi.fn(() => 1)
    const { result } = renderHook(() => useSkyEvents({ shootingStar: false, ufo: false, airplane: true }, random))
    advance(5 * MINUTE)
    expect(result.current.airplane).toBeUndefined()
    advance(5 * MINUTE)
    expect(result.current.airplane).toMatchObject({ kind: 'airplane', durMs: 75_000, east: false })
    expect(random).toHaveBeenCalled()
  })
})
