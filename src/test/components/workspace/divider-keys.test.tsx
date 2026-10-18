import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, renderHook } from '@testing-library/react'
import { BandDivider } from '../../../components/workspace/BandDivider'
import { WorkspaceDivider } from '../../../components/workspace/WorkspaceDivider'
import { useKeyboardShortcuts } from '../../../hooks/use-keyboard-shortcuts'
import { useUIStore } from '../../../stores/ui-store'
import type { LayoutBand } from '../../../models/workspace-layout'

// The arrow keys move a focused divider; they must not also run the app's
// "select the next / previous task" shortcut on the rows behind it.

const noop = () => {}

function withShortcutsAndARow() {
  renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings: noop, openShortcutsModal: noop }))
  const row = document.createElement('div')
  row.setAttribute('data-todo-id', '7')
  row.scrollIntoView = vi.fn()
  document.body.appendChild(row)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('workspace dividers and the arrow-key shortcuts', () => {
  it('↑ / ↓ on a band divider leave the task selection alone', () => {
    withShortcutsAndARow()
    const band: LayoutBand = { id: 'b', height: 160, tabs: [{ id: 't', kind: 'notes', config: {} }] }
    const { container } = render(<BandDivider edge="top" band={band} />)
    const divider = container.querySelector<HTMLElement>('[data-ws-band-divider]')!
    divider.focus()
    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    fireEvent.keyDown(divider, { key: 'ArrowUp' })
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
  })

  it('↑ / ↓ on a divider between two cells leave the task selection alone, and still resize', () => {
    withShortcutsAndARow()
    const onResize = vi.fn()
    const { container } = render(
      <>
        <div data-ws-cell="a" />
        <div data-ws-cell="b" />
        <WorkspaceDivider between="cells" aId="a" bId="b" weightA={1} weightB={1} min={40} onResize={onResize} label="Resize cells" />
      </>,
    )
    for (const id of ['a', 'b']) {
      vi.spyOn(container.querySelector(`[data-ws-cell="${id}"]`)!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 300))
    }
    const divider = container.querySelector<HTMLElement>('[data-ws-divider]')!
    divider.focus()
    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    expect(onResize).toHaveBeenCalledOnce()
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
  })
})
