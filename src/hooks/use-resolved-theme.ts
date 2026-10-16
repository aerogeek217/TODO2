import { useMediaQuery } from './use-media-query'
import { useSettingsStore } from '../stores/settings-store'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The theme in effect: the Appearance setting, or the OS theme when it is `system`. */
export function useResolvedTheme(): 'light' | 'dark' {
  const prefersDark = useMediaQuery(DARK_QUERY)
  const themeMode = useSettingsStore((s) => s.themeMode)
  if (themeMode === 'system') return prefersDark ? 'dark' : 'light'
  return themeMode
}
