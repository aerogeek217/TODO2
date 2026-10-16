import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useUIStore } from '../../stores/ui-store'
import { useWidgetSelection } from '../../hooks/use-widget-selection'
import { rowKey, type ScopedRow } from '../../utils/scoped-selection'

const ROWS: ScopedRow[] = [1, 2, 3, 4].map((id) => ({ key: rowKey('s', id), todoId: id }))
const NONE = { shift: false, ctrl: false }
const ids = () => [...useUIStore.getState().selectedTodoIds].sort()

/** A click event whose target / currentTarget are the given elements. */
function clickOn(target: Element, currentTarget: Element): React.MouseEvent {
  return { target, currentTarget } as unknown as React.MouseEvent
}

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
})

describe('useWidgetSelection', () => {
  it('a click selects one task, Ctrl toggles, Shift takes the range from the anchor', () => {
    const { result } = renderHook(() => useWidgetSelection('tab-a', () => ROWS))
    act(() => result.current.onSelect(rowKey('s', 2), 2, NONE))
    expect(ids()).toEqual([2])
    expect(result.current.inScope).toBe(true)
    expect(result.current.cursorKey).toBe(rowKey('s', 2))
    act(() => result.current.onSelect(rowKey('s', 4), 4, { shift: false, ctrl: true }))
    expect(ids()).toEqual([2, 4])
    act(() => result.current.onSelect(rowKey('s', 3), 3, { shift: true, ctrl: false }))
    // The anchor moved to the Ctrl-clicked row: 3 … 4.
    expect(ids()).toEqual([3, 4])
  })

  it('reads the rows at click time', () => {
    let rows = ROWS.slice(0, 2)
    const { result } = renderHook(() => useWidgetSelection('tab-a', () => rows))
    rows = ROWS
    act(() => result.current.onSelect(rowKey('s', 4), 4, NONE))
    expect(ids()).toEqual([4])
  })

  it('a click on empty space (the widget, or a named empty area) clears only its own selection', () => {
    const widget = document.createElement('div')
    const body = document.createElement('div')
    const row = document.createElement('div')
    widget.append(body)
    body.append(row)
    const { result } = renderHook(() => useWidgetSelection('tab-a', () => ROWS))
    act(() => result.current.onSelect(rowKey('s', 1), 1, NONE))

    act(() => result.current.clearOnEmptySpace(clickOn(row, widget), body))
    expect(ids()).toEqual([1])
    act(() => result.current.clearOnEmptySpace(clickOn(body, widget), body))
    expect(ids()).toEqual([])

    act(() => useUIStore.getState().setScopedSelection('tab-b', { ids: new Set([2]), anchorKey: 'tab-b:2', cursorKey: 'tab-b:2', cursorTodoId: 2 }))
    act(() => result.current.clearOnEmptySpace(clickOn(widget, widget)))
    expect(ids()).toEqual([2])
  })

  it('drops its selection when the widget unmounts', () => {
    const { result, unmount } = renderHook(() => useWidgetSelection('tab-a', () => ROWS))
    act(() => result.current.onSelect(rowKey('s', 1), 1, NONE))
    unmount()
    expect(ids()).toEqual([])
  })
})
