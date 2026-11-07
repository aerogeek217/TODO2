import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { guessPlace } from '../utils/sun'
import { skyScene, type SkyScene } from '../utils/sky'
import { useIsMobile } from './use-is-mobile'
import { useMediaQuery } from './use-media-query'
import { useResolvedTheme } from './use-resolved-theme'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The current minute, as state that ticks at each minute's turn while
 * `active` — and re-reads the clock when the page comes back into view
 * (timers are throttled in a hidden tab or a sleeping machine).
 */
function useMinute(active: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!active) return
    const refresh = () => setNow(new Date())
    const timer = setTimeout(refresh, Math.max(1000, 60_000 - (Date.now() % 60_000) + 50))
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [active, now])
  return now
}

export interface Ambience {
  scene: SkyScene
  /** The system asks for reduced motion: nothing falls, twinkles, drifts or ripples (the sky still follows the clock). */
  still: boolean
}

/**
 * The ambience to draw now (`components/ambience`): the scene for this minute
 * at the Settings place (or the time zone's guess), in the theme in effect —
 * `null` when it is off or on a phone (desktop only).
 */
export function useAmbience(): Ambience | null {
  const settings = useSettingsStore((s) => s.ambience)
  const isMobile = useIsMobile()
  const theme = useResolvedTheme()
  const still = useMediaQuery(REDUCED_MOTION_QUERY)
  const active = settings.enabled && !isMobile
  const now = useMinute(active)
  const guessed = useMemo(() => guessPlace(), [])
  const place = settings.place ?? guessed
  const scene = useMemo(
    () => (active ? skyScene(now, place, settings, theme) : null),
    [active, now, place, settings, theme],
  )
  return scene ? { scene, still } : null
}
