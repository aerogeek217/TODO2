import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

describe('useIsMobile', () => {
  let listeners: Array<() => void>
  let matches: boolean
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    listeners = []
    matches = false

    // Reset the module-level singleton by re-importing
    vi.resetModules()

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() { return matches },
      media: query,
      addEventListener: (_event: string, cb: () => void) => { listeners.push(cb) },
      removeEventListener: (_event: string, cb: () => void) => {
        listeners = listeners.filter((l) => l !== cb)
      },
    }))
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('returns false when viewport is wider than 640px', async () => {
    matches = false
    const { useIsMobile } = await import('../../hooks/use-is-mobile')
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('returns true when viewport is 640px or narrower', async () => {
    matches = true
    const { useIsMobile } = await import('../../hooks/use-is-mobile')
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('updates when media query changes', async () => {
    matches = false
    const { useIsMobile } = await import('../../hooks/use-is-mobile')
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    // Simulate viewport narrowing
    matches = true
    act(() => {
      listeners.forEach((cb) => cb())
    })
    expect(result.current).toBe(true)
  })

  it('unsubscribes on unmount', async () => {
    matches = false
    const { useIsMobile } = await import('../../hooks/use-is-mobile')
    const { unmount } = renderHook(() => useIsMobile())
    expect(listeners.length).toBe(1)

    unmount()
    expect(listeners.length).toBe(0)
  })

  it('queries max-width: 640px', async () => {
    const { useIsMobile } = await import('../../hooks/use-is-mobile')
    renderHook(() => useIsMobile())
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 640px)')
  })
})
