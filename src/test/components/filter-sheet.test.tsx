import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { FilterSheet } from '../../components/overlays/FilterSheet'
import { useUIStore } from '../../stores/ui-store'
import { useFilterStore } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { makePerson, makeTag, makeOrg } from '../helpers'

const alice = makePerson({ id: 1, name: 'Alice' })
const bob = makePerson({ id: 2, name: 'Bob' })
const bugTag = makeTag({ id: 1, name: 'Bug' })
const featureTag = makeTag({ id: 2, name: 'Feature' })
const acmeOrg = makeOrg({ id: 1, name: 'Acme' })

/**
 * Renders FilterSheet inside a MemoryRouter, then opens it.
 * Opening after mount avoids the route-change useEffect closing it immediately.
 */
function renderSheet(route = '/list') {
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <FilterSheet />
    </MemoryRouter>,
  )
  act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })
  return result
}

describe('FilterSheet', () => {
  beforeEach(() => {
    useFilterStore.getState().clearAll()
    useUIStore.setState({ isFilterSheetOpen: false })
    usePersonStore.setState({ people: [alice, bob] })
    useTagStore.setState({ tags: [bugTag, featureTag] })
    useOrgStore.setState({ orgs: [acmeOrg] })
  })

  afterEach(cleanup)

  // ── Visibility ────────────────────────────────────────────────────

  describe('visibility', () => {
    it('renders nothing when closed', () => {
      const { container } = render(
        <MemoryRouter><FilterSheet /></MemoryRouter>,
      )
      expect(container.innerHTML).toBe('')
    })

    it('renders content when open', () => {
      renderSheet()
      expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument()
    })

    it('closes when backdrop is clicked', () => {
      const { container } = renderSheet()
      // Backdrop is the first child element in the fragment
      fireEvent.click(container.children[0])
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
    })
  })

  // ── Search ────────────────────────────────────────────────────────

  describe('search', () => {
    it('updates searchText in filter store', () => {
      renderSheet()
      fireEvent.change(screen.getByPlaceholderText('Search tasks...'), { target: { value: 'hello' } })
      expect(useFilterStore.getState().filters.searchText).toBe('hello')
    })

    it('clears search with the clear button', () => {
      renderSheet()
      fireEvent.change(screen.getByPlaceholderText('Search tasks...'), { target: { value: 'query' } })
      fireEvent.click(screen.getByText('\u00d7'))
      expect(useFilterStore.getState().filters.searchText).toBe('')
    })
  })

  // ── Toggle filters ────────────────────────────────────────────────

  describe('toggle filters', () => {
    it('toggles show completed filter', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Show / hide'))
      const toggle = screen.getByRole('switch', { name: 'Show completed' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')

      fireEvent.click(toggle)
      expect(useFilterStore.getState().filters.showCompleted).toBe(true)
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })

    it('toggles show hidden statuses filter', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Show / hide'))
      const toggle = screen.getByRole('switch', { name: 'Show hidden statuses' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')

      fireEvent.click(toggle)
      expect(useFilterStore.getState().filters.showHiddenStatuses).toBe(true)
      expect(toggle).toHaveAttribute('aria-checked', 'true')
    })
  })

  // ── Date range ────────────────────────────────────────────────────

  describe('date range', () => {
    it('changes date field', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Date range'))
      fireEvent.click(screen.getByText('Created'))
      expect(useFilterStore.getState().filters.dateField).toBe('created')
    })

    it('sets date range start from input', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Date range'))
      const dateInputs = document.querySelectorAll('input[type="date"]')
      fireEvent.change(dateInputs[0], { target: { value: '2026-04-01' } })

      const { dateRangeStart } = useFilterStore.getState().filters
      expect(dateRangeStart).not.toBeNull()
      if (!dateRangeStart || dateRangeStart.kind !== 'fixed') throw new Error('expected fixed anchor')
      expect(dateRangeStart.iso.slice(0, 10)).toBe('2026-04-01')
    })
  })

  // ── Entity lists ──────────────────────────────────────────────────

  describe('entity lists', () => {
    it('toggles a person filter', () => {
      renderSheet()
      fireEvent.click(screen.getByText('People'))
      fireEvent.click(screen.getByText('Alice'))

      const { personIds } = useFilterStore.getState().filters
      expect(personIds).not.toBeNull()
      // Toggling from null creates set-of-all-except-Alice: {0 (unassigned), 2 (Bob)}
      expect(personIds!.has(1)).toBe(false)
      expect(personIds!.has(0)).toBe(true)
      expect(personIds!.has(2)).toBe(true)
    })

    it('shows Unassigned option in people list', () => {
      renderSheet()
      fireEvent.click(screen.getByText('People'))
      expect(screen.getByText('Unassigned')).toBeInTheDocument()
    })

    it('filters people by search', () => {
      renderSheet()
      fireEvent.click(screen.getByText('People'))
      fireEvent.change(screen.getByPlaceholderText('Search people...'), { target: { value: 'Ali' } })
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    })

    it('toggles a tag filter', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Tags'))
      fireEvent.click(screen.getByText('Bug'))

      const { tagIds } = useFilterStore.getState().filters
      expect(tagIds).not.toBeNull()
      expect(tagIds!.has(1)).toBe(false) // Bug deselected
    })

    it('toggles an org filter', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Orgs'))
      fireEvent.click(screen.getByText('Acme'))

      const { orgIds } = useFilterStore.getState().filters
      expect(orgIds).not.toBeNull()
      expect(orgIds!.has(1)).toBe(false) // Acme deselected
    })

    it('hides people section when no people in store', () => {
      usePersonStore.setState({ people: [] })
      renderSheet()
      expect(screen.queryByText('People')).not.toBeInTheDocument()
    })
  })

  // ── Clear all ─────────────────────────────────────────────────────

  describe('clear all', () => {
    it('is hidden when no filters active', () => {
      renderSheet()
      expect(screen.queryByText('Clear all filters')).not.toBeInTheDocument()
    })

    it('clears filters and closes sheet', () => {
      renderSheet()
      // Activate a filter — search text
      fireEvent.change(screen.getByPlaceholderText('Search tasks...'), { target: { value: 'x' } })
      expect(useFilterStore.getState().isActive).toBe(true)

      fireEvent.click(screen.getByText('Clear all filters'))
      expect(useFilterStore.getState().isActive).toBe(false)
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
    })
  })
})
