import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { InsertTrigger } from '../../../components/canvas/InsertTrigger'

afterEach(() => cleanup())

/**
 * Mirrors the SortableTaskList Enter-chain flow with ui-store indirection:
 * 1. User is editing InsertTrigger A (editing=true, input mounted+focused).
 * 2. User hits Enter → new item B appears (B trigger mounts editing=false).
 * 3. useEffect reacts → activeId moves to B → A's editing goes false, B's goes true.
 * Two renders interleave: first mount B as editing=false, then flip A→false/B→true.
 */
function Harness({ activeId, items }: { activeId: number | null; items: number[] }) {
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
    const { rerender } = render(<Harness activeId={1} items={[1]} />)

    // Initial: trigger 1 is editing, its input mounted.
    const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    input1.focus()
    expect(document.activeElement).toBe(input1)

    // Step 1 (ui-store path — todos updated, new item appears, but activeId still 1).
    // New InsertTrigger for item 2 mounts with editing=false (renders trigger div).
    await act(async () => {
      rerender(<Harness activeId={1} items={[1, 2]} />)
    })

    // Step 2 (useEffect fires — activeId moves to 2).
    // A's editing: true→false (input unmounts). B's editing: false→true (input mounts).
    await act(async () => {
      rerender(<Harness activeId={2} items={[1, 2]} />)
    })

    const inputs = screen.getAllByPlaceholderText(/New task/)
    expect(inputs.length).toBe(1)
    const input2 = inputs[0]
    expect(document.activeElement).toBe(input2)
  })

  it('focuses the input when the new InsertTrigger mounts with editing=true on its first render (direct path)', async () => {
    const { rerender } = render(<Harness activeId={1} items={[1]} />)

    // Initial: trigger 1 is editing, its input mounted.
    const input1 = screen.getByPlaceholderText(/New task/) as HTMLInputElement
    input1.focus()
    expect(document.activeElement).toBe(input1)

    // Single render: new item 2 appears AND activeId moves to 2 simultaneously.
    // The new InsertTrigger mounts with editing=true on its first render,
    // autoFocus fires on input's first DOM insertion.
    await act(async () => {
      rerender(<Harness activeId={2} items={[1, 2]} />)
    })

    const inputs = screen.getAllByPlaceholderText(/New task/)
    expect(inputs.length).toBe(1)
    const input2 = inputs[0]
    expect(document.activeElement).toBe(input2)
  })
})
