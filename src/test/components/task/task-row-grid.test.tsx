import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { TaskRowGrid } from '../../../components/task/TaskRowGrid'
import { createValueStore } from '../../../utils/value-store'
import { useSettingsStore } from '../../../stores/settings-store'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function startDrag(divider: Element) {
  // JSDOM has no pointer capture.
  Object.defineProperty(divider, 'setPointerCapture', { value: () => {}, configurable: true })
  fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 400 })
  fireEvent.pointerMove(divider, { pointerId: 1, clientX: 380 })
}

describe('TaskRowGrid density', () => {
  it('carries the Settings row density as data-density (compact by default), live', () => {
    const { container } = render(<TaskRowGrid><div /></TaskRowGrid>)
    const grid = container.querySelector('[data-task-row-grid]')
    expect(grid).toHaveAttribute('data-density', 'compact')
    act(() => useSettingsStore.setState({ rowDensity: 'comfortable' }))
    expect(grid).toHaveAttribute('data-density', 'comfortable')
  })
})

describe('TaskRowGrid divider', () => {
  it('a list unmounted mid-drag lets go of the width its tab shares, so the other lists show the stored one again', () => {
    const live = createValueStore<number | null>(null)
    const { getByRole, unmount } = render(
      <TaskRowGrid detailsWidth={300} onDetailsWidthChange={() => {}} liveDetailsWidth={live}>
        <div />
      </TaskRowGrid>,
    )
    startDrag(getByRole('separator'))
    expect(live.get()).not.toBeNull()
    act(() => unmount())
    expect(live.get()).toBeNull()
  })

  it('a lost pointer capture ends the drag without storing it', () => {
    const live = createValueStore<number | null>(null)
    const onChange = vi.fn()
    const { getByRole } = render(
      <TaskRowGrid detailsWidth={300} onDetailsWidthChange={onChange} liveDetailsWidth={live}>
        <div />
      </TaskRowGrid>,
    )
    const divider = getByRole('separator')
    startDrag(divider)
    expect(live.get()).not.toBeNull()
    fireEvent.lostPointerCapture(divider, { pointerId: 1 })
    expect(live.get()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
