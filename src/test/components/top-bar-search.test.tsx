import { Profiler } from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../components/layout/TopBar'
import { useFilterStore } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import type { Tag } from '../../models'
import { makePerson, makeTodo } from '../helpers'
import { SEARCH_DEBOUNCE_MS } from '../../constants'

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  )
}

describe('TopBar grouped search', () => {
  beforeEach(() => {
    useFilterStore.getState().clearAll()
    useTodoStore.setState({ todos: [] })
    usePersonStore.setState({
      people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
      assignedPeopleMap: new Map(),
    })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  })

  afterEach(cleanup)

  it('renders groups for Title / Notes matches with counts and icons', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Buy milk', notes: '' }),
        makeTodo({ id: 2, title: 'random', notes: 'remember to buy bread' }),
        makeTodo({ id: 3, title: 'buy stamps', notes: 'for the letters' }),
      ],
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement

    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'buy' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const groups = within(listbox).getAllByRole('group')
    const labels = groups.map(g => g.getAttribute('aria-label'))
    expect(labels).toContain('Title')
    expect(labels).toContain('Notes')

    const titleGroup = groups.find(g => g.getAttribute('aria-label') === 'Title')!
    expect(within(titleGroup).getAllByRole('option')).toHaveLength(2)
    expect(within(titleGroup).getByText('2')).toBeInTheDocument()

    const notesGroup = groups.find(g => g.getAttribute('aria-label') === 'Notes')!
    expect(within(notesGroup).getAllByRole('option')).toHaveLength(1)
  })

  it('"Show all" expansion resets when the query changes', async () => {
    useTodoStore.setState({
      todos: Array.from({ length: 7 }, (_, i) => makeTodo({ id: i + 1, title: `task ${i + 1}`, notes: '' })),
    })
    renderBar()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'task' } })
    })
    fireEvent.mouseDown(await screen.findByText('Show all 7'))
    const listbox = screen.getByRole('listbox', { name: /search results/i })
    expect(within(listbox).getAllByRole('option')).toHaveLength(7)
    expect(screen.queryByText('Show all 7')).toBeNull()

    await act(async () => {
      fireEvent.change(input, { target: { value: 'tas' } })
    })
    await waitFor(() => {
      expect(within(screen.getByRole('listbox', { name: /search results/i })).getAllByRole('option')).toHaveLength(5)
    })
    expect(screen.getByText('Show all 7')).toBeInTheDocument()
  })

  it('does not show the listbox when no results match', async () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'hello' })],
    })
    renderBar()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'zzz' } })
    })
    expect(screen.queryByRole('listbox', { name: /search results/i })).toBeNull()
  })

  // Tag search names are sourced from the registry + assignedTagsMap.
  // Seeding tags only on the store proves the dropdown reads through the
  // registry path.
  it('renders a Tags group when the query matches a tag via the registry', async () => {
    const urgent: Tag = { id: 10, name: 'urgent', color: '#f00' }
    const today: Tag = { id: 20, name: 'today', color: '#0f0' }
    useTagStore.setState({
      tags: [urgent, today],
      assignedTagsMap: new Map([
        [1, [urgent]],
        [2, [today, urgent]],
      ]),
    })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'review budget' }),
        makeTodo({ id: 2, title: 'pick up keys' }),
        makeTodo({ id: 3, title: 'unrelated' }),
      ],
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'urgent' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const tagGroup = within(listbox).getByRole('group', { name: 'Tags' })
    expect(within(tagGroup).getAllByRole('option')).toHaveLength(2)
  })

  // Regression: the previous test's pending 150 ms debounce fired during the
  // next test (after unmount) and wrote its stale query into the filter
  // store, which re-synced the new bar's input and unmounted the focused
  // option — the intermittent "roving focus" failure under full-suite load.
  it('an unmounted bar does not write its pending search into the filter store', async () => {
    const view = renderBar()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'zzz' } })
    })
    view.unmount()
    await act(async () => { await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 100)) })
    expect(useFilterStore.getState().filters.searchText).toBe('')
  })

  it('keyboard roving focus steps into the Tags group', async () => {
    const urgent: Tag = { id: 10, name: 'urgent', color: '#f00' }
    useTagStore.setState({
      tags: [urgent],
      assignedTagsMap: new Map([[1, [urgent]]]),
    })
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'review budget' })],
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'urgent' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const tagGroup = within(listbox).getByRole('group', { name: 'Tags' })
    const tagOption = within(tagGroup).getByRole('option')

    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' })
    })
    expect(document.activeElement).toBe(tagOption)
  })
})

describe('TopBar search box and the filter store', () => {
  afterEach(cleanup)

  it('shows the store’s search text when it changes elsewhere (e.g. Clear all)', async () => {
    renderBar()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'budget' } })
    })
    await waitFor(() => expect(useFilterStore.getState().filters.searchText).toBe('budget'))
    expect(input.value).toBe('budget')
    act(() => useFilterStore.getState().clearAll())
    expect(input.value).toBe('')
    act(() => useFilterStore.getState().setSearchText('from elsewhere'))
    expect(input.value).toBe('from elsewhere')
  })
})

describe('TopBar renders for the tasks only while it searches them', () => {
  beforeEach(() => {
    useFilterStore.getState().clearAll()
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Buy milk' }), makeTodo({ id: 2, title: 'Call Bob' })] })
    usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  })

  afterEach(cleanup)

  function renderCounted() {
    const renders = { n: 0 }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Profiler id="bar" onRender={() => { renders.n++ }}>
          <TopBar />
        </Profiler>
      </MemoryRouter>,
    )
    return renders
  }

  const rename = (id: number, title: string) => act(() => {
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, title } : t)) })
    usePersonStore.setState({ assignedPeopleMap: new Map() })
    useTagStore.setState({ assignedTagsMap: new Map() })
  })

  it('a task write, or an assignment, renders nothing while no search is typed', () => {
    const renders = renderCounted()
    renders.n = 0
    rename(2, 'Call Bob back')
    expect(renders.n).toBe(0)
  })

  it('while the dropdown shows, it follows a task changed meanwhile', async () => {
    renderCounted()
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'buy' } })
    })
    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['Buy milk'])
    rename(2, 'Buy stamps')
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['Buy milk', 'Buy stamps'])
  })
})
