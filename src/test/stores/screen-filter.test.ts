import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFilterStore } from '../../stores/filter-store'
import { currentScreenFilter, useActiveScreenFilter, useScreenFilter } from '../../stores/screen-filter'
import { clearFilterStore } from '../helpers'

beforeEach(clearFilterStore)

describe('the screen filter', () => {
  it('is the top bar’s chips, the same object while nothing changed (stores compare by reference)', () => {
    useFilterStore.getState().setSearchText('budget')
    const screen = currentScreenFilter()
    expect(screen).toBe(useFilterStore.getState().filters)
    expect(screen.searchText).toBe('budget')
    expect(currentScreenFilter()).toBe(screen)
  })

  it('the hooks: the chips and whether they narrow; a list composes them in only while they do', () => {
    const { result, rerender } = renderHook(() => ({ state: useScreenFilter(), active: useActiveScreenFilter() }))
    expect(result.current.state).toEqual({ filters: useFilterStore.getState().filters, active: false })
    expect(result.current.active).toBeUndefined()
    useFilterStore.getState().setSearchText('budget')
    rerender()
    expect(result.current.state.active).toBe(true)
    expect(result.current.active).toBe(useFilterStore.getState().filters)
  })

  it('Clear all clears it', () => {
    useFilterStore.getState().setSearchText('budget')
    useFilterStore.getState().clearAll()
    expect(currentScreenFilter().searchText).toBe('')
  })
})
