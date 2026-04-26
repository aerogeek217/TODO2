import { describe, it, expect, afterEach } from 'vitest'
import { useLayoutEffect, useRef } from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'
import { InsertTrigger, type InsertTriggerHandle } from '../../../components/canvas/InsertTrigger'

afterEach(() => cleanup())

/**
 * Mirrors SortableTaskList's Phase 3 imperative-focus pattern: each
 * <InsertTrigger> registers its handle in a Map via a stable callback ref,
 * and the parent calls `focusInput()` on the matching handle when
 * activeId moves to that trigger. In real code SortableTaskList schedules
 * the call via `setTimeout(_, 50)` from `openTriggerAfterInsert` (Phase 2's
 * post-Phase-4 trace showed earlier mechanisms are 0/40 effective during
 * the Enter-chain race). JSDOM has no ResizeObserver-driven race, so the
 * harness fires synchronously via useLayoutEffect — verifying the
 * imperative method itself works. Real-browser focus timing is asserted
 * by `e2e/focus-trace.spec.ts` and `e2e/canvas-enter-chain.spec.ts`.
 */
function Harness({ activeId, items }: { activeId: number | null; items: number[] }) {
  const triggerRefs = useRef<Map<number, InsertTriggerHandle | null>>(new Map())
  const triggerRefCbs = useRef<Map<number, (h: InsertTriggerHandle | null) => void>>(new Map())
  const getRefCb = (id: number) => {
    let cb = triggerRefCbs.current.get(id)
    if (!cb) {
      cb = (handle: InsertTriggerHandle | null): void => {
        if (handle) triggerRefs.current.set(id, handle)
        else triggerRefs.current.delete(id)
      }
      triggerRefCbs.current.set(id, cb)
    }
    return cb
  }
  useLayoutEffect(() => {
    if (activeId == null) return
    triggerRefs.current.get(activeId)?.focusInput()
  }, [activeId])

  return (
    <div>
      {items.map((id) => (
        <InsertTrigger
          key={id}
          ref={getRefCb(id)}
          editing={activeId === id}
          onActivate={() => {}}
          onCommit={() => {}}
          onCancel={() => {}}
        />
      ))}
    </div>
  )
}

describe('InsertTrigger imperative focus', () => {
  it('focuses the new input on the two-render Enter-chain path', async () => {
    const { rerender } = render(<Harness activeId={1} items={[1]} />)
    const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    input1.focus()
    expect(document.activeElement).toBe(input1)

    // Render 1: items grow (new trigger 2 mounts as the "+" button), activeId stays.
    await act(async () => {
      rerender(<Harness activeId={1} items={[1, 2]} />)
    })

    // Render 2: activeId moves to trigger 2 → it flips editing=true →
    // its input mounts → useLayoutEffect calls focusInput on its handle.
    await act(async () => {
      rerender(<Harness activeId={2} items={[1, 2]} />)
    })

    const inputs = screen.getAllByPlaceholderText(/New task/)
    expect(inputs.length).toBe(1)
    expect(document.activeElement).toBe(inputs[0])
  })

  it('focuses the new input on the single-render direct path', async () => {
    const { rerender } = render(<Harness activeId={1} items={[1]} />)
    const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    input1.focus()
    expect(document.activeElement).toBe(input1)

    // items + activeId update together in a single render — the new trigger
    // mounts already in editing mode and useLayoutEffect calls focusInput.
    await act(async () => {
      rerender(<Harness activeId={2} items={[1, 2]} />)
    })

    const inputs = screen.getAllByPlaceholderText(/New task/)
    expect(inputs.length).toBe(1)
    expect(document.activeElement).toBe(inputs[0])
  })

  it('focuses on click-activate via autoFocus (no row insertion path)', async () => {
    // Click-activate doesn't go through openTriggerAfterInsert — no row was
    // inserted, so SortableTaskList does NOT schedule a t50 imperative call.
    // autoFocus is the sole focus mechanism for this path. The trigger was
    // initially rendered with editing=false (visible "+" button); when
    // activeId becomes its id, editing flips true and the input mounts.
    const { rerender } = render(<Harness activeId={null} items={[1]} />)
    expect(screen.queryByPlaceholderText(/New task/)).toBeNull()

    await act(async () => {
      rerender(<Harness activeId={1} items={[1]} />)
    })

    const input = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    expect(document.activeElement).toBe(input)
  })

  it('focusInput is a no-op when the trigger is not editing (input unmounted)', () => {
    // Safety: if a stale setTimeout fires after activeInsertAfterId moved
    // away (rapid Enter chain → next handler fires before previous's t50),
    // focusInput on the now-unmounted input must not throw or steal focus.
    const handleRef: { current: InsertTriggerHandle | null } = { current: null }
    render(
      <InsertTrigger
        ref={(h) => { handleRef.current = h }}
        editing={false}
        onActivate={() => {}}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    )

    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    expect(document.activeElement).toBe(button)

    expect(() => handleRef.current?.focusInput()).not.toThrow()
    expect(document.activeElement).toBe(button)

    document.body.removeChild(button)
  })

  it('focusInput recovers focus if it landed on body after mount', async () => {
    // Real-browser equivalent: the new input mounts during the Enter-chain
    // commit, autoFocus fires but is contested by React Flow's
    // ResizeObserver, focus lands on body, t50 setTimeout fires and
    // recovers via focusInput. JSDOM has no such contention; we simulate
    // by manually blurring after mount and calling focusInput.
    const handleRef: { current: InsertTriggerHandle | null } = { current: null }
    render(
      <InsertTrigger
        ref={(h) => { handleRef.current = h }}
        editing={true}
        onActivate={() => {}}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    )
    const input = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    input.blur()
    expect(document.activeElement).toBe(document.body)

    act(() => { handleRef.current?.focusInput() })
    expect(document.activeElement).toBe(input)
  })
})
