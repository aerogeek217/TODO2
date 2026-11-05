import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, cleanup, act } from '@testing-library/react'
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

  it('renders three buttons in the nav, none a tab (there is no tablist) (cr31 UI F9)', () => {
    renderTabBar()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getAllByRole('button')).toHaveLength(3)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
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
    const workspace = () => screen.getByRole('button', { name: 'Workspace' })
    const filters = () => screen.getByRole('button', { name: 'Filters' })
    const settings = () => screen.getByRole('button', { name: 'Settings' })

    it('Workspace is the current page on /; Filters is a closed sheet', () => {
      renderTabBar('/')
      expect(workspace()).toHaveAttribute('aria-current', 'page')
      expect(settings()).not.toHaveAttribute('aria-current')
      expect(filters()).not.toHaveAttribute('aria-current')
      expect(filters()).toHaveAttribute('aria-haspopup', 'dialog')
      expect(filters()).toHaveAttribute('aria-expanded', 'false')
    })

    it('Settings is the current page on /settings', () => {
      renderTabBar('/settings')
      expect(workspace()).not.toHaveAttribute('aria-current')
      expect(settings()).toHaveAttribute('aria-current', 'page')
    })

    it('Filters is expanded while the sheet is open; the page under it isn’t marked current', () => {
      renderTabBar('/')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })
      expect(filters()).toHaveAttribute('aria-expanded', 'true')
      expect(workspace()).not.toHaveAttribute('aria-current')
    })

    it('Settings deactivates when the filter sheet is open', () => {
      renderTabBar('/settings')
      act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })
      expect(settings()).not.toHaveAttribute('aria-current')
      expect(filters()).toHaveAttribute('aria-expanded', 'true')
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
      expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    })

    it('counts each active screen filter', () => {
      useFilterStore.getState().setSearchText('active')
      useFilterStore.getState().setShowCompleted(true)
      renderTabBar()
      expect(screen.getByTestId('filter-count')).toHaveTextContent('2')
      expect(screen.getByRole('button', { name: 'Filters (2 active)' })).toBeInTheDocument()
    })
  })
})
