import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, fireEvent, screen } from '@testing-library/react'
import { CanvasToolbar } from '../../../components/canvas/CanvasToolbar'
import { useCanvasRailsStore } from '../../../stores/canvas-rails-store'
import { EMPTY_RAILS, type Rail } from '../../../models/canvas-rails'

const lensRail: Rail = {
  orientation: 'vertical',
  slots: [{ id: 'slot-a', tabs: [{ id: 'slot-a-t0', type: 'lens' }], activeTabId: 'slot-a-t0' }],
}

const topRail: Rail = {
  orientation: 'horizontal',
  slots: [{ id: 'slot-b', tabs: [{ id: 'slot-b-t0', type: 'notes' }], activeTabId: 'slot-b-t0' }],
}

beforeEach(() => {
  useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: true, pendingFocusSlotId: null })
})

afterEach(cleanup)

describe('CanvasToolbar', () => {
  it('always renders the fit-all-to-view button', () => {
    render(<CanvasToolbar />)
    expect(screen.getByRole('button', { name: 'Fit all to view' })).toBeInTheDocument()
  })

  it('dispatches a `canvas-fit-view` CustomEvent when the fit button is clicked', () => {
    const handler = vi.fn()
    window.addEventListener('canvas-fit-view', handler)
    try {
      render(<CanvasToolbar />)
      fireEvent.click(screen.getByRole('button', { name: 'Fit all to view' }))
      expect(handler).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('canvas-fit-view', handler)
    }
  })

  it('hides the rails-collapse button when no rails exist', () => {
    useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: true, pendingFocusSlotId: null })
    render(<CanvasToolbar />)
    expect(screen.queryByRole('button', { name: /collapse all rails|expand all rails/i })).toBeNull()
  })

  it('renders Collapse-all when a rail is present and not collapsed', () => {
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, left: lensRail },
      hydrated: true,
      pendingFocusSlotId: null,
    })
    render(<CanvasToolbar />)
    expect(screen.getByRole('button', { name: 'Collapse all rails' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand all rails' })).toBeNull()
  })

  it('flips to Expand-all when every present rail is already collapsed', () => {
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, left: lensRail, top: topRail, collapsed: { left: true, top: true } },
      hydrated: true,
      pendingFocusSlotId: null,
    })
    render(<CanvasToolbar />)
    expect(screen.getByRole('button', { name: 'Expand all rails' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse all rails' })).toBeNull()
  })

  it('clicking Collapse-all marks every present rail collapsed', () => {
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, left: lensRail, top: topRail },
      hydrated: true,
      pendingFocusSlotId: null,
    })
    render(<CanvasToolbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all rails' }))
    expect(useCanvasRailsStore.getState().rails.collapsed).toEqual({ left: true, top: true })
  })

  it('clicking Expand-all clears the collapsed bag', () => {
    useCanvasRailsStore.setState({
      rails: { ...EMPTY_RAILS, left: lensRail, collapsed: { left: true } },
      hydrated: true,
      pendingFocusSlotId: null,
    })
    render(<CanvasToolbar />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all rails' }))
    expect(useCanvasRailsStore.getState().rails.collapsed).toBeUndefined()
  })
})
