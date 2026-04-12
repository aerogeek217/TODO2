import { useSyncExternalStore } from 'react'
import { useSettingsStore } from '../stores/settings-store'

const DARK_QUERY = '(prefers-color-scheme: dark)'

let mediaQuery: MediaQueryList | null = null

function getMediaQuery(): MediaQueryList {
  if (!mediaQuery) {
    mediaQuery = window.matchMedia(DARK_QUERY)
  }
  return mediaQuery
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
  return true // default to dark
}

export function useResolvedTheme(): 'light' | 'dark' {
  const prefersDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const themeMode = useSettingsStore((s) => s.themeMode)
  if (themeMode === 'system') return prefersDark ? 'dark' : 'light'
  return themeMode
}
