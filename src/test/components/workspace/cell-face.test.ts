import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createTab } from '../../../models/workspace-layout'
import { useCellFace } from '../../../components/workspace/cell-face'
import type { WidgetFace } from '../../../utils/widget-face'

/** The full-widget popover of a small face: open only while the face stays small (cr33 W6). */
describe('useCellFace', () => {
  const tab = createTab('lens', 'list', { listDefinitionId: 1 })

  function setup(initial: WidgetFace) {
    return renderHook(({ face }: { face: WidgetFace }) => useCellFace(tab, { forced: face }), { initialProps: { face: initial } })
  }

  it('opens at the small face and stays open while it is small', () => {
    const { result, rerender } = setup('small')
    act(() => result.current.openFull())
    expect(result.current.fullOpen).toBe(true)
    rerender({ face: 'small' })
    expect(result.current.fullOpen).toBe(true)
  })

  it('the face growing to medium closes it, as to large; shrinking back doesn’t reopen it', () => {
    for (const grown of ['medium', 'large'] as const) {
      const { result, rerender } = setup('small')
      act(() => result.current.openFull())
      rerender({ face: grown })
      expect(result.current.fullOpen).toBe(false)
      rerender({ face: 'small' })
      expect(result.current.fullOpen).toBe(false)
    }
  })
})
