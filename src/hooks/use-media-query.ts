import { useCallback, useSyncExternalStore } from 'react'

/**
 * Media query lists by query, kept for the `window.matchMedia` they came
 * from: a replaced `matchMedia` (tests stub it) gets fresh lists instead of
 * the stale ones of the previous one.
 */
let cache: { matchMedia: typeof window.matchMedia; lists: Map<string, MediaQueryList> } | null = null

function mediaQuery(query: string): MediaQueryList {
  if (cache?.matchMedia !== window.matchMedia) {
    cache = { matchMedia: window.matchMedia, lists: new Map() }
  }
  let list = cache.lists.get(query)
  if (!list) {
    list = window.matchMedia(query)
    cache.lists.set(query, list)
  }
  return list
}

/**
 * Whether `query` matches the viewport now; re-renders when that changes.
 * The one `matchMedia` subscription for components (`useIsMobile` and
 * `useResolvedTheme` build on it).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((callback: () => void) => {
    const mq = mediaQuery(query)
    mq.addEventListener('change', callback)
    return () => mq.removeEventListener('change', callback)
  }, [query])
  const getSnapshot = useCallback(() => mediaQuery(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
