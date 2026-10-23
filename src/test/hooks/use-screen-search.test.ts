import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScreenSearch } from '../../hooks/use-screen-search'
import { useFilterStore } from '../../stores/filter-store'
import { SEARCH_DEBOUNCE_MS } from '../../constants'

afterEach(() => { vi.useRealTimers() })

describe('useScreenSearch', () => {
  it('writes typed text to the store after the debounce', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useScreenSearch())
    act(() => result.current[1]('ann'))
    expect(result.current[0]).toBe('ann')
    expect(useFilterStore.getState().filters.searchText).toBe('')
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS) })
    expect(useFilterStore.getState().filters.searchText).toBe('ann')
  })

  it('a clear reaches the store at once, even when the field unmounts straight after', () => {
    useFilterStore.getState().setSearchText('ann')
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useScreenSearch())
    expect(result.current[0]).toBe('ann')
    act(() => result.current[1](''))
    unmount()
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2) })
    expect(useFilterStore.getState().filters.searchText).toBe('')
  })

  it('a clear cancels a pending typed write', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useScreenSearch())
    act(() => result.current[1]('bo'))
    act(() => result.current[1](''))
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2) })
    expect(useFilterStore.getState().filters.searchText).toBe('')
    expect(result.current[0]).toBe('')
  })
})
