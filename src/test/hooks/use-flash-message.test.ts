import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFlashMessage } from '../../hooks/use-flash-message'

afterEach(() => {
  vi.useRealTimers()
})

describe('useFlashMessage', () => {
  it('shows a message, then puts the empty value back after its time; a newer message restarts the clock', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useFlashMessage(''))
    act(() => result.current[1]('Saved', 1000))
    expect(result.current[0]).toBe('Saved')
    act(() => { vi.advanceTimersByTime(800) })
    act(() => result.current[1]('Saved again', 1000))
    act(() => { vi.advanceTimersByTime(800) })
    expect(result.current[0]).toBe('Saved again')
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current[0]).toBe('')
  })

  it('clears its timer on unmount', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useFlashMessage<string | null>(null))
    act(() => result.current[1]('Toast', 1000))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
