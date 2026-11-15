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

  describe('paused (the funnel)', () => {
    it('composes as no screen filter: the hooks and currentScreenFilter give none, the filter itself stays', () => {
      useFilterStore.getState().setSearchText('budget')
      const { result, rerender } = renderHook(() => ({ state: useScreenFilter(), active: useActiveScreenFilter() }))
      useFilterStore.getState().setPaused(true)
      rerender()
      const none = currentScreenFilter()
      expect(none).toMatchObject({ searchText: '', personIds: null, tags: null, showCompleted: false })
      // One object while paused, so readers compare by reference.
      expect(currentScreenFilter()).toBe(none)
      expect(result.current.state).toEqual({ filters: none, active: false })
      expect(result.current.state.filters).toBe(none)
      expect(result.current.active).toBeUndefined()
      expect(useFilterStore.getState().filters.searchText).toBe('budget')
      expect(useFilterStore.getState().isActive).toBe(true)
      useFilterStore.getState().setPaused(false)
      rerender()
      expect(result.current.state.filters.searchText).toBe('budget')
      expect(currentScreenFilter()).toBe(useFilterStore.getState().filters)
    })

    it('with no filter on there is nothing to pause', () => {
      useFilterStore.getState().setPaused(true)
      expect(useFilterStore.getState().paused).toBe(false)
    })

    it('any edit resumes it with the change: a chip, the typed field, a search token, Show completed', () => {
      const edits: Array<() => void> = [
        () => useFilterStore.getState().setTags(new Set([3])),
        () => useFilterStore.getState().applyExpression({ kind: 'text', text: 'plan' }, false),
        () => useFilterStore.getState().applySearchTokens([{ raw: '#q4', clause: { field: 'tags', id: 4 } }]),
        () => useFilterStore.getState().setShowCompleted(true),
        () => useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, searchText: 'x' }),
      ]
      for (const edit of edits) {
        useFilterStore.getState().setSearchText('budget')
        useFilterStore.getState().setPaused(true)
        expect(useFilterStore.getState().paused).toBe(true)
        edit()
        expect(useFilterStore.getState().paused).toBe(false)
        useFilterStore.getState().clearAll()
      }
    })

    it('Clear all ends it with the filter', () => {
      useFilterStore.getState().setSearchText('budget')
      useFilterStore.getState().setPaused(true)
      useFilterStore.getState().clearAll()
      expect(useFilterStore.getState().paused).toBe(false)
      expect(useFilterStore.getState().isActive).toBe(false)
    })
  })
})
