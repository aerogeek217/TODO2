import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import { TaskRowGrid } from '../../../components/task/TaskRowGrid'
import { createValueStore } from '../../../utils/value-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTaskRowColumn } from '../../../components/task/task-row-grid-context'

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

describe('TaskRowGrid zoom', () => {
  it('carries its zoom as data-zoom (rows by default), whatever the Settings default', () => {
    useSettingsStore.setState({ listZoom: 'stacked' })
    const { container, rerender } = render(<TaskRowGrid><div /></TaskRowGrid>)
    const grid = container.querySelector('[data-task-row-grid]')
    expect(grid).toHaveAttribute('data-zoom', 'rows')
    rerender(<TaskRowGrid zoom="lines"><div /></TaskRowGrid>)
    expect(grid).toHaveAttribute('data-zoom', 'lines')
  })

  it('draws the divider at rows only', () => {
    const { queryByRole, rerender } = render(<TaskRowGrid onDetailsWidthChange={() => {}} zoom="rows"><div /></TaskRowGrid>)
    expect(queryByRole('separator')).not.toBeNull()
    for (const zoom of ['stacked', 'lines'] as const) {
      rerender(<TaskRowGrid onDetailsWidthChange={() => {}} zoom={zoom}><div /></TaskRowGrid>)
      expect(queryByRole('separator')).toBeNull()
    }
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

describe('TaskRowGrid — columns for the fields its rows use (flair P8)', () => {
  const all = { notes: true, people: true, tags: true, due: true, followup: true, status: true }
  const noNotes = { ...all, notes: false }
  /** The grid's columns, read through a row-like child. */
  function Probe() {
    const notes = useTaskRowColumn((c) => c.notes)
    return <button type="button" aria-expanded={false} data-notes={notes}>row</button>
  }
  const notesTrack = (c: HTMLElement) => Number(c.querySelector('[data-notes]')!.getAttribute('data-notes'))

  it('a field the rows start using gets its column at once', () => {
    const { container, rerender } = render(<TaskRowGrid used={noNotes}><Probe /></TaskRowGrid>)
    expect(notesTrack(container)).toBe(0)
    rerender(<TaskRowGrid used={all}><Probe /></TaskRowGrid>)
    expect(notesTrack(container)).toBe(16)
  })

  it('one they stop using leaves at once while the list is idle, but not while a row’s picker is open — it goes when the picker closes', async () => {
    const { container, rerender } = render(<TaskRowGrid used={all}><Probe /></TaskRowGrid>)
    rerender(<TaskRowGrid used={noNotes}><Probe /></TaskRowGrid>)
    expect(notesTrack(container)).toBe(0)

    rerender(<TaskRowGrid used={all}><Probe /></TaskRowGrid>)
    const button = container.querySelector('button')!
    button.setAttribute('aria-expanded', 'true')
    rerender(<TaskRowGrid used={noNotes}><Probe /></TaskRowGrid>)
    expect(notesTrack(container)).toBe(16)
    await act(async () => {
      button.setAttribute('aria-expanded', 'false')
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(notesTrack(container)).toBe(0)
  })

  it('no field used: no divider', () => {
    const none = { notes: false, people: false, tags: false, due: false, followup: false, status: false }
    const { queryByRole } = render(<TaskRowGrid used={none} onDetailsWidthChange={() => {}}><div /></TaskRowGrid>)
    expect(queryByRole('separator')).toBeNull()
  })
})
