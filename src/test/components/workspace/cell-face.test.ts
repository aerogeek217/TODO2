import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createTab } from '../../../models/workspace-layout'
import { useCellFace } from '../../../components/workspace/cell-face'
import { useUIStore } from '../../../stores/ui-store'
import type { WidgetFace } from '../../../utils/widget-face'

/** A cell's face and its Open larger: the widget popup, held in `ui-store`. */
describe('useCellFace', () => {
  const tab = createTab('lens', 'list', { listDefinitionId: 1 })

  function setup(initial: WidgetFace) {
    return renderHook(({ face }: { face: WidgetFace }) => useCellFace(tab, { forced: face }), { initialProps: { face: initial } })
  }

  it('opens the tab in the popup; it stays open as the face changes', () => {
    const { result, rerender } = setup('small')
    expect(result.current.opensLarger).toBe(true)
    act(() => result.current.openLarger())
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: 'list' })
    expect(result.current.open).toBe(true)
    rerender({ face: 'large' })
    expect(result.current.open).toBe(true)
  })

  it('the host offers it to the widget (a face’s +N more), not for a Number with nothing more to show', () => {
    const { result } = setup('medium')
    expect(result.current.host.openFull).toBeDefined()
    const number = createTab('number', 'n')
    const n = renderHook(() => useCellFace(number, { forced: 'small' }))
    expect(n.result.current.opensLarger).toBe(false)
    expect(n.result.current.host.openFull).toBeUndefined()
  })
})
