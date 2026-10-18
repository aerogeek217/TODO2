import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResolvedTheme } from '../../hooks/use-resolved-theme'
import { useSettingsStore } from '../../stores/settings-store'

const originalMatchMedia = window.matchMedia

/** A `matchMedia` whose dark-scheme answer the test sets; `flip` tells the subscribers. */
function stubOsTheme(dark: boolean) {
  let matches = dark
  let listeners: Array<() => void> = []
  window.matchMedia = ((query: string) => ({
    get matches() { return query === '(prefers-color-scheme: dark)' && matches },
    media: query,
    addEventListener: (_: string, cb: () => void) => { listeners.push(cb) },
    removeEventListener: (_: string, cb: () => void) => { listeners = listeners.filter((l) => l !== cb) },
  })) as unknown as typeof window.matchMedia
  return {
    flip(next: boolean) {
      matches = next
      for (const l of listeners) l()
    },
    listenerCount: () => listeners.length,
  }
}

afterEach(() => {
  window.matchMedia = originalMatchMedia
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
})

describe('useResolvedTheme', () => {
  it('follows the OS under the system setting, and re-renders when it flips', () => {
    useSettingsStore.setState({ themeMode: 'system' })
    const os = stubOsTheme(true)
    const { result, unmount } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
    act(() => os.flip(false))
    expect(result.current).toBe('light')
    unmount()
    expect(os.listenerCount()).toBe(0)
  })

  it('asks the current matchMedia, not one it saw earlier', () => {
    useSettingsStore.setState({ themeMode: 'system' })
    stubOsTheme(true)
    const first = renderHook(() => useResolvedTheme())
    expect(first.result.current).toBe('dark')
    first.unmount()

    stubOsTheme(false)
    const second = renderHook(() => useResolvedTheme())
    expect(second.result.current).toBe('light')
    second.unmount()
  })

  it('an explicit light / dark setting wins over the OS', () => {
    stubOsTheme(true)
    useSettingsStore.setState({ themeMode: 'light' })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')
    act(() => useSettingsStore.setState({ themeMode: 'dark' }))
    expect(result.current).toBe('dark')
  })
})
