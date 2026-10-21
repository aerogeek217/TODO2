import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { FilterSheet } from '../../components/overlays/FilterSheet'
import { useUIStore } from '../../stores/ui-store'
import { useFilterStore } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { makePerson } from '../helpers'

const alice = makePerson({ id: 1, name: 'Alice' })
const bob = makePerson({ id: 2, name: 'Bob' })

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
    useTagStore.setState({ tags: [] })
    useTodoStore.setState({ todos: [] })
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
      fireEvent.click(container.children[0]!)
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

    it('has no show-hidden toggle', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Show / hide'))
      expect(screen.queryByRole('switch', { name: /hidden/i })).toBeNull()
      expect(screen.queryByText('Show hidden')).toBeNull()
    })
  })

  // ── Dates ─────────────────────────────────────────────────────────

  describe('dates', () => {
    it('picking a date type writes nothing; the range then edits that type', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('tab', { name: 'Created' }))
      expect(useFilterStore.getState().filters.dates).toEqual({})
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-01' } })
      expect(Object.keys(useFilterStore.getState().filters.dates)).toEqual(['created'])
    })

    it('sets date range start from input', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-01' } })

      const due = useFilterStore.getState().filters.dates.deadline
      const dateRangeStart = due?.match === 'range' ? due.start : null
      if (!dateRangeStart || dateRangeStart.kind !== 'fixed') throw new Error('expected fixed anchor')
      expect(dateRangeStart.iso.slice(0, 10)).toBe('2026-04-01')
    })

    it('sets a relative-token anchor from the token dropdown', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.change(screen.getByLabelText('From (relative)'), { target: { value: 'end-of-week' } })

      const due = useFilterStore.getState().filters.dates.deadline
      const dateRangeStart = due?.match === 'range' ? due.start : null
      if (!dateRangeStart || dateRangeStart.kind !== 'relative') throw new Error('expected relative anchor')
      expect(dateRangeStart.token).toBe('end-of-week')
    })

    it('Show: Has a date / No date / In range on the due date', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('radio', { name: 'Has a date' }))
      expect(useFilterStore.getState().filters.dates).toEqual({ deadline: { match: 'set' } })
      fireEvent.click(screen.getByRole('radio', { name: 'No date' }))
      expect(useFilterStore.getState().filters.dates).toEqual({ deadline: { match: 'unset' } })
      fireEvent.click(screen.getByRole('radio', { name: 'In range' }))
      expect(useFilterStore.getState().filters.dates).toEqual({})
    })

    it('two types at once: the row reads both, Clear <Type> clears one', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('radio', { name: 'Has a date' }))
      fireEvent.click(screen.getByRole('tab', { name: 'Follow-up' }))
      fireEvent.click(screen.getByRole('radio', { name: 'No date' }))
      expect(useFilterStore.getState().filters.dates).toEqual({ deadline: { match: 'set' }, followup: { match: 'unset' } })
      expect(screen.getByText('Due + Follow-up')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Clear Follow-up' }))
      expect(useFilterStore.getState().filters.dates).toEqual({ deadline: { match: 'set' } })
    })

    it('offers no scheduled-date filter', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      expect(screen.queryByRole('tab', { name: /Sched/ })).toBeNull()
      expect(screen.queryByText('Sched.')).toBeNull()
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

    it('each person is a real checkbox named by the row: Space on it ticks, as a tap does', () => {
      renderSheet()
      fireEvent.click(screen.getByText('People'))
      const alice = screen.getByRole('checkbox', { name: 'Alice' })
      expect(alice).toBeChecked()
      expect(alice).not.toHaveAttribute('tabindex', '-1')
      expect(screen.getByRole('checkbox', { name: 'Unassigned' })).toBeInTheDocument()
      // A keyboard Space on a checkbox is a click.
      fireEvent.click(alice)
      expect(useFilterStore.getState().filters.personIds?.has(1)).toBe(false)
      expect(screen.getByRole('checkbox', { name: 'Alice' })).not.toBeChecked()
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

    it('hides people section when no people in store', () => {
      usePersonStore.setState({ people: [] })
      renderSheet()
      expect(screen.queryByText('People')).not.toBeInTheDocument()
    })
  })

  // ── Tags ──────────────────────────────────────────────────────────

  describe('tags', () => {
    const URGENT_ID = 10
    const SOON_ID = 20
    const seedTags = () => useTagStore.setState({
      tags: [
        { id: URGENT_ID, name: 'urgent', color: '#f00' },
        { id: SOON_ID, name: 'soon', color: '#0f0' },
      ],
    })

    it('shows empty state when registry has no tags', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Tags'))
      expect(screen.getByText('No tags yet.')).toBeInTheDocument()
    })

    it('renders registry tags sorted alphabetically prefixed with #', () => {
      seedTags()
      renderSheet()
      fireEvent.click(screen.getByText('Tags'))
      expect(screen.getByText('#urgent')).toBeInTheDocument()
      expect(screen.getByText('#soon')).toBeInTheDocument()
    })

    it('toggles a tag id into the filter store (null → all-except-clicked)', () => {
      seedTags()
      renderSheet()
      fireEvent.click(screen.getByText('Tags'))
      fireEvent.click(screen.getByText('#urgent'))

      const { tags } = useFilterStore.getState().filters
      expect(tags).not.toBeNull()
      // toggleItem from null creates "all known tag ids except URGENT_ID"
      expect(tags!.has(URGENT_ID)).toBe(false)
      expect(tags!.has(SOON_ID)).toBe(true)
    })

    it('reflects the active count in the section header', () => {
      seedTags()
      renderSheet()
      act(() => { useFilterStore.getState().setTags(new Set([URGENT_ID])) })
      // Tags section header wraps label + badge; badge renders the set size.
      const tagsLabel = screen.getByText('Tags').parentElement!
      expect(tagsLabel.textContent).toMatch(/Tags\s*1/)
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
