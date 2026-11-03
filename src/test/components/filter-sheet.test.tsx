import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { FilterSheet } from '../../components/overlays/FilterSheet'
import { useUIStore } from '../../stores/ui-store'
import { useFilterStore } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { makePerson, makeTodo } from '../helpers'

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

  // ── Show N tasks ──────────────────────────────────────────────────

  describe('Show N tasks', () => {
    it('ends the sheet while a filter is on; a tap closes the sheet and opens the tasks in the task dialog', () => {
      useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Call Alice' }), makeTodo({ id: 2, title: 'Buy milk' })] })
      renderSheet()
      expect(screen.queryByRole('button', { name: /^Show \d+ tasks?$/ })).toBeNull()
      act(() => useFilterStore.getState().setSearchText('alice'))
      fireEvent.click(screen.getByRole('button', { name: 'Show 1 task' }))
      expect(useUIStore.getState().isFilterSheetOpen).toBe(false)
      expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Filtered tasks', source: { kind: 'screen' } })
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
      fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }))
      expect(useFilterStore.getState().filters.dates).toEqual({})
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-01' } })
      expect(Object.keys(useFilterStore.getState().filters.dates)).toEqual(['created'])
    })

    it('sets date range start from the Calendar date input', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('radio', { name: 'Calendar' }))
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-01' } })

      const due = useFilterStore.getState().filters.dates.deadline
      const dateRangeStart = due?.match === 'range' ? due.start : null
      if (!dateRangeStart || dateRangeStart.kind !== 'fixed') throw new Error('expected fixed anchor')
      // The day's local midnight (its ISO's own day is UTC's).
      expect(dateRangeStart.iso).toBe(new Date(2026, 3, 1).toISOString())
    })

    it('sets a rolling day from the Relative dropdown', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('button', { name: 'From: No start' }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'start of week' }))

      const due = useFilterStore.getState().filters.dates.deadline
      const dateRangeStart = due?.match === 'range' ? due.start : null
      if (!dateRangeStart || dateRangeStart.kind !== 'relative') throw new Error('expected relative anchor')
      expect(dateRangeStart.token).toBe('start-of-week')
    })

    it('Show: Any / None / Relative on the due date', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('radio', { name: 'Any' }))
      expect(useFilterStore.getState().filters.dates).toEqual({ deadline: { match: 'set' } })
      fireEvent.click(screen.getByRole('radio', { name: 'None' }))
      expect(useFilterStore.getState().filters.dates).toEqual({ deadline: { match: 'unset' } })
      fireEvent.click(screen.getByRole('radio', { name: 'Relative' }))
      expect(useFilterStore.getState().filters.dates).toEqual({})
    })

    it('two types at once: the row reads both, Clear <Type> clears one', () => {
      renderSheet()
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('radio', { name: 'Any' }))
      fireEvent.click(screen.getByRole('tab', { name: 'Next follow-up' }))
      fireEvent.click(screen.getByRole('radio', { name: 'None' }))
      expect(useFilterStore.getState().filters.dates).toEqual({ deadline: { match: 'set' }, followup: { match: 'unset' } })
      expect(screen.getByText('Due + Next follow-up')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Clear Next follow-up' }))
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

    const rowNames = () => screen.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)
    const separatedRows = () => screen.getAllByRole('checkbox').map((c) => !!c.closest('label')?.className.includes('entityItemSeparated'))

    it('the ticked rows first, a separator, then the rest; a tick with no search text moves nothing', () => {
      usePersonStore.setState({ people: [alice, bob, makePerson({ id: 3, name: 'Cara' })] })
      act(() => { useFilterStore.getState().setPersonIds(new Set([3])) })
      renderSheet()
      fireEvent.click(screen.getByText('People'))
      expect(rowNames()).toEqual(['Cara', 'Unassigned', 'Alice', 'Bob'])
      expect(separatedRows()).toEqual([false, true, false, false])
      fireEvent.click(screen.getByRole('checkbox', { name: 'Bob' }))
      expect(screen.getByRole('checkbox', { name: 'Bob' })).toBeChecked()
      expect(rowNames()).toEqual(['Cara', 'Unassigned', 'Alice', 'Bob'])
    })

    it('a tick while searching clears the search (focus kept) and re-sorts', () => {
      usePersonStore.setState({ people: [alice, bob, makePerson({ id: 3, name: 'Cara' })] })
      act(() => { useFilterStore.getState().setPersonIds(new Set([3])) })
      renderSheet()
      fireEvent.click(screen.getByText('People'))
      const search = screen.getByPlaceholderText('Search people...')
      search.focus()
      fireEvent.change(search, { target: { value: 'bo' } })
      const bobBox = screen.getByRole('checkbox', { name: 'Bob' })
      // A press on the row keeps the focus in the search.
      expect(fireEvent.mouseDown(bobBox.closest('label')!)).toBe(false)
      fireEvent.click(bobBox)
      expect(screen.getByPlaceholderText('Search people...')).toHaveValue('')
      expect(screen.getByPlaceholderText('Search people...')).toHaveFocus()
      expect(rowNames()).toEqual(['Bob', 'Cara', 'Unassigned', 'Alice'])
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

    it('tags: the ticked ones first, then the rest; a tick while searching clears the search', () => {
      seedTags()
      act(() => { useFilterStore.getState().setTags(new Set([URGENT_ID])) })
      renderSheet()
      fireEvent.click(screen.getByText('Tags'))
      const names = () => screen.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)
      expect(names()).toEqual(['#urgent', 'No tags', '#soon'])
      fireEvent.change(screen.getByPlaceholderText('Search tags...'), { target: { value: 'so' } })
      fireEvent.click(screen.getByRole('checkbox', { name: '#soon' }))
      expect(screen.getByPlaceholderText('Search tags...')).toHaveValue('')
      expect(names()).toEqual(['#soon', '#urgent', 'No tags'])
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
