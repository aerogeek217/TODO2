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

function renderTabBar(route = '/list') {
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

  it('renders four tabs', () => {
    renderTabBar()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
  })

  it('renders tab labels', () => {
    renderTabBar()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('List')).toBeInTheDocument()
    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('has main navigation aria-label', () => {
    renderTabBar()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  // ── Active tab states ─────────────────────────────────────────────

  describe('active states', () => {
    it('Dashboard tab is active on /dashboard', () => {
      renderTabBar('/dashboard')
      const tabs = screen.getAllByRole('tab')
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[3]).toHaveAttribute('aria-selected', 'false')
    })

    it('Dashboard tab is active on /', () => {
      renderTabBar('/')
      expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
    })

    it('List tab is active on /list', () => {
      renderTabBar('/list')
      const tabs = screen.getAllByRole('tab')
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[3]).toHaveAttribute('aria-selected', 'false')
    })

    it('Settings tab is active on /settings', () => {
      renderTabBar('/settings')
      const tabs = screen.getAllByRole('tab')
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[3]).toHaveAttribute('aria-selected', 'true')
    })

    it('Filters tab is active when filter sheet is open', () => {
      renderTabBar('/list')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      const tabs = screen.getAllByRole('tab')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
      // List tab deactivates when filter sheet is open
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    })

    it('Settings tab deactivates when filter sheet is open', () => {
      renderTabBar('/settings')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      const tabs = screen.getAllByRole('tab')
      expect(tabs[3]).toHaveAttribute('aria-selected', 'false')
      expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
    })
  })

  // ── Navigation ────────────────────────────────────────────────────

  describe('navigation', () => {
    it('navigates to /list when List tab clicked', () => {
      renderTabBar('/settings')
      fireEvent.click(screen.getByText('List'))
      expect(screen.getByTestId('location')).toHaveTextContent('/list')
    })

    it('navigates to /settings when Settings tab clicked', () => {
      renderTabBar('/list')
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

    it('closes filter sheet when List tab clicked while sheet is open', () => {
      renderTabBar('/list')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      fireEvent.click(screen.getByText('List'))
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
    })

    it('closes filter sheet when Settings tab clicked while sheet is open', () => {
      renderTabBar('/list')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })

      fireEvent.click(screen.getByText('Settings'))
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
      expect(screen.getByTestId('location')).toHaveTextContent('/settings')
    })
  })

  // ── Filter dot indicator ──────────────────────────────────────────

  describe('filter dot', () => {
    it('does not show filter dot when no filters active', () => {
      renderTabBar()
      const filtersTab = screen.getByText('Filters').closest('button')!
      const svg = filtersTab.querySelector('svg')!
      expect(svg.nextElementSibling).toBeNull()
    })

    it('shows filter dot when filters are active', () => {
      useFilterStore.getState().setSearchText('active')
      renderTabBar()
      const filtersTab = screen.getByText('Filters').closest('button')!
      const svg = filtersTab.querySelector('svg')!
      expect(svg.nextElementSibling).not.toBeNull()
    })
  })
})
