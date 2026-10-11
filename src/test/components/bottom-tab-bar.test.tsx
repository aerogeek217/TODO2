import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { BottomTabBar } from '../../components/layout/BottomTabBar'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'

/** Helper component to observe the current route in tests */
function LocationDisplay() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

function renderTabBar(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <BottomTabBar />
      <LocationDisplay />
    </MemoryRouter>,
  )
}

describe('BottomTabBar', () => {
  beforeEach(() => {
    useFilterStore.getState().clearAll()
    useUIStore.setState({ isFilterSheetOpen: false })
  })

  afterEach(cleanup)

  // ── Rendering ─────────────────────────────────────────────────────

  it('renders three tabs', () => {
    renderTabBar()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('renders tab labels', () => {
    renderTabBar()
    expect(screen.getByText('Workspace')).toBeInTheDocument()
    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('has main navigation aria-label', () => {
    renderTabBar()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  // ── Active tab states ─────────────────────────────────────────────

  describe('active states', () => {
    it('Workspace tab is active on /', () => {
      renderTabBar('/')
      const tabs = screen.getAllByRole('tab')
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false')
    })

    it('Workspace tab is active on /', () => {
      renderTabBar('/')
      expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
    })

    it('Settings tab is active on /settings', () => {
      renderTabBar('/settings')
      const tabs = screen.getAllByRole('tab')
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
    })

    it('Filters tab is active when filter sheet is open', () => {
      renderTabBar('/')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      const tabs = screen.getAllByRole('tab')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
      // Workspace tab deactivates when filter sheet is open
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    })

    it('Settings tab deactivates when filter sheet is open', () => {
      renderTabBar('/settings')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      const tabs = screen.getAllByRole('tab')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    })
  })

  // ── Navigation ────────────────────────────────────────────────────

  describe('navigation', () => {
    it('navigates to the workspace (/) when Workspace tab clicked', () => {
      renderTabBar('/settings')
      fireEvent.click(screen.getByText('Workspace'))
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    })

    it('navigates to /settings when Settings tab clicked', () => {
      renderTabBar('/')
      fireEvent.click(screen.getByText('Settings'))
      expect(screen.getByTestId('location')).toHaveTextContent('/settings')
    })

    it('toggles filter sheet when Filters tab clicked', () => {
      renderTabBar()
      fireEvent.click(screen.getByText('Filters'))
      expect(useUIStore.getState().isFilterSheetOpen).toBe(true)

      fireEvent.click(screen.getByText('Filters'))
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
    })

    it('closes filter sheet when Workspace tab clicked while sheet is open', () => {
      renderTabBar('/')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      fireEvent.click(screen.getByText('Workspace'))
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
    })

    it('closes filter sheet when Settings tab clicked while sheet is open', () => {
      renderTabBar('/')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      fireEvent.click(screen.getByText('Settings'))
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
      expect(screen.getByTestId('location')).toHaveTextContent('/settings')
    })
  })

  // ── Active filter count ───────────────────────────────────────────

  describe('filter count badge', () => {
    it('shows no badge when no filters are active', () => {
      renderTabBar()
      expect(screen.queryByTestId('filter-count')).toBeNull()
      expect(screen.getByRole('tab', { name: 'Filters' })).toBeInTheDocument()
    })

    it('counts each active screen filter', () => {
      useFilterStore.getState().setSearchText('active')
      useFilterStore.getState().setShowCompleted(true)
      renderTabBar()
      expect(screen.getByTestId('filter-count')).toHaveTextContent('2')
      expect(screen.getByRole('tab', { name: 'Filters (2 active)' })).toBeInTheDocument()
    })
  })
})
