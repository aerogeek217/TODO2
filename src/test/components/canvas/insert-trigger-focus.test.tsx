import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { InsertTrigger } from '../../../components/canvas/InsertTrigger'

afterEach(() => cleanup())

/**
 * Mirrors SortableTaskList's Enter-chain flow with ui-store indirection:
 * 1. User is editing InsertTrigger A (editing=true, input mounted+focused).
 * 2. User hits Enter → new item B appears (B mounts editing=false).
 * 3. useEffect reacts → activeId moves to B → A flips editing=false and B flips editing=true.
 */
function TwoRenderHarness({ activeId, items }: { activeId: number | null; items: number[] }) {
  return (
    <div>
      {items.map((id) => (
        <InsertTrigger
          key={id}
          editing={activeId === id}
          onActivate={() => {}}
          onCommit={() => {}}
          onCancel={() => {}}
        />
      ))}
    </div>
  )
}

describe('InsertTrigger focus', () => {
  it('focuses the input when editing transitions false→true on an already-mounted component (two-render ui-store path)', async () => {
    const { rerender } = render(<TwoRenderHarness activeId={1} items={[1]} />)
    const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    input1.focus()
    expect(document.activeElement).toBe(input1)

    await act(async () => {
      rerender(<TwoRenderHarness activeId={1} items={[1, 2]} />)
    })

    await act(async () => {
      rerender(<TwoRenderHarness activeId={2} items={[1, 2]} />)
    })

    const inputs = screen.getAllByPlaceholderText(/New task/)
    expect(inputs.length).toBe(1)
    expect(document.activeElement).toBe(inputs[0])
  })

  it('focuses the input when the new InsertTrigger mounts with editing=true on its first render (direct path)', async () => {
    const { rerender } = render(<TwoRenderHarness activeId={1} items={[1]} />)
    const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    input1.focus()
    expect(document.activeElement).toBe(input1)

    await act(async () => {
      rerender(<TwoRenderHarness activeId={2} items={[1, 2]} />)
    })

    const inputs = screen.getAllByPlaceholderText(/New task/)
    expect(inputs.length).toBe(1)
    expect(document.activeElement).toBe(inputs[0])
  })

  it('reclaims focus from document.body within the settle window (simulates a late focus steal)', async () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<TwoRenderHarness activeId={1} items={[1]} />)
      const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
      input1.focus()
      expect(document.activeElement).toBe(input1)

      await act(async () => {
        rerender(<TwoRenderHarness activeId={2} items={[1, 2]} />)
      })

      const input2 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
      expect(document.activeElement).toBe(input2)

      // Simulate a late focus steal to body (e.g., React Flow's ResizeObserver
      // re-render briefly dropping focus) — this is exactly what the prior rAF
      // fallback missed. The reclaim timers should refocus on the next tick.
      input2.blur()
      expect(document.activeElement).toBe(document.body)

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      expect(document.activeElement).toBe(input2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fight a real focus target (e.g. a button the user clicked)', async () => {
    vi.useFakeTimers()
    try {
      const button = document.createElement('button')
      button.textContent = 'elsewhere'
      document.body.appendChild(button)

      const { rerender } = render(<TwoRenderHarness activeId={1} items={[1]} />)
      const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
      input1.focus()

      await act(async () => {
        rerender(<TwoRenderHarness activeId={2} items={[1, 2]} />)
      })

      const input2 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
      expect(document.activeElement).toBe(input2)

      // User clicks another focusable control. Reclaim must NOT steal it back.
      button.focus()
      expect(document.activeElement).toBe(button)

      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      expect(document.activeElement).toBe(button)
      document.body.removeChild(button)
    } finally {
      vi.useRealTimers()
    }
  })
})
