import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUIStore } from '../../stores/ui-store'
import { useScopedSelectionRelease } from '../../hooks/use-scoped-selection-release'

const select = (scope: string, ids: number[]) =>
  useUIStore.getState().setScopedSelection(scope, { ids: new Set(ids), anchorKey: `${scope}:${ids[0]}`, cursorKey: `${scope}:${ids[0]}`, cursorTodoId: ids[0] ?? 0 })

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
})

describe('useScopedSelectionRelease', () => {
  it('clears the selection the widget owns when it unmounts', () => {
    const { unmount } = renderHook(() => useScopedSelectionRelease('tab-a'))
    select('tab-a', [1, 2])
    unmount()
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
    expect(useUIStore.getState().selectionScope).toBeNull()
  })

  it("leaves another widget's selection alone", () => {
    const { unmount } = renderHook(() => useScopedSelectionRelease('tab-a'))
    select('tab-b', [3])
    unmount()
    expect([...useUIStore.getState().selectedTodoIds]).toEqual([3])
    expect(useUIStore.getState().selectionScope).toBe('tab-b')
  })
})
