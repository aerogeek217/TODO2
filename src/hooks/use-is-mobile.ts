import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 640px)'

/**
 * The media query list, kept for the `window.matchMedia` it came from: a
 * replaced `matchMedia` (tests stub it) gets a fresh query instead of the
 * stale list of the previous one.
 */
let cached: { matchMedia: typeof window.matchMedia; list: MediaQueryList } | null = null

function getMediaQuery(): MediaQueryList {
  if (cached?.matchMedia !== window.matchMedia) {
    cached = { matchMedia: window.matchMedia, list: window.matchMedia(MOBILE_QUERY) }
  }
  return cached.list
}

function subscribe(callback: () => void): () => void {
  const mq = getMediaQuery()
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

function getSnapshot(): boolean {
  return getMediaQuery().matches
}

function getServerSnapshot(): boolean {
  return false
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
