import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useProjectStore } from '../../../stores/project-store'
import { useUIStore } from '../../../stores/ui-store'
import type { Status } from '../../../models'
import { makePerson, makeOrg, makeProject, makeTodo } from '../../helpers'

/**
 * Phase 5 (`bugs-ui-2026-04-24`) — search-result pill bar.
 *
 * `SearchResultRow` previously rendered title + notes snippet + bare date
 * spans. It now mirrors `TaskRow`'s pill bar (people + orgs avatars,
 * scheduled/deadline chips, status icon) as a read-only display. Two
 * non-negotiables:
 *
 *  - Pills must render for a todo with assigned people / orgs / status.
 *  - Clicking anywhere on the row — including over a chip — must still fire
 *    `onOpen` (no nested pickers, no swallowed events). The pill container
 *    is `pointer-events: none` so the row's `<button>` keeps every click.
 */
function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/list']}>
      <TopBar />
    </MemoryRouter>,
  )
}

describe('TopBar search-result pill bar — Phase 5', () => {
  beforeEach(async () => {
    // Drain any pending debounced timers from a prior test (TopBar's
    // `handleSearchChange` debounces setSearchText by 150 ms; if a prior
    // test's debounce fires during this one, it will overwrite localSearch
    // mid-test and unmount the search row before our click reaches it).
    await new Promise(r => setTimeout(r, 200))
    useFilterStore.getState().clearAll()
    useTodoStore.setState({ todos: [], loading: false, error: null })
    usePersonStore.setState({
      people: [makePerson({ id: 1, name: 'Alice', initials: 'AL' })],
      assignedPeopleMap: new Map(),
    })
    useOrgStore.setState({
      orgs: [makeOrg({ id: 1, name: 'Acme', color: '#ff0000' })],
      assignedOrgsMap: new Map(),
      personOrgMap: new Map(),
    })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
    useProjectStore.setState({ projects: [makeProject({ id: 1, canvasId: 1, name: 'Marketing' })], loading: false, error: null })
    useUIStore.setState({ selectedTodoId: null, editPopupMode: null } as never)
  })

  afterEach(cleanup)

  it('renders people, org, status, and date pills on a search-result row', async () => {
    const inProgress: Status = { id: 5, name: 'In Progress', color: '#00ff00', sortOrder: 1, icon: 'circle' }
    useStatusStore.setState({ statuses: [inProgress] })
    usePersonStore.setState({
      people: [makePerson({ id: 1, name: 'Alice', initials: 'AL' })],
      assignedPeopleMap: new Map([[1, [makePerson({ id: 1, name: 'Alice', initials: 'AL' })]]]),
    })
    useOrgStore.setState({
      orgs: [makeOrg({ id: 1, name: 'Acme', color: '#ff0000' })],
      assignedOrgsMap: new Map([[1, [makeOrg({ id: 1, name: 'Acme', color: '#ff0000' })]]]),
      personOrgMap: new Map(),
    })
    useTodoStore.setState({
      todos: [makeTodo({
        id: 1,
        title: 'Ship Q4 plan',
        scheduledDate: { kind: 'date', value: new Date('2099-01-15') },
        dueDate: new Date('2099-02-01'),
        statusId: 5,
      })],
      loading: false,
      error: null,
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'Q4' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const option = within(listbox).getAllByRole('option')[0]!

    expect(within(option).getByText('AL')).toBeInTheDocument()
    expect(within(option).getByText('AC')).toBeInTheDocument()
    expect(within(option).getByTitle('In Progress')).toBeInTheDocument()
    expect(within(option).getByTitle('Scheduled')).toBeInTheDocument()
    expect(within(option).getByTitle('Deadline')).toBeInTheDocument()
  })

  it('clicking a row routes through onOpen and pill chips are structurally inside the row button', async () => {
    const inProgress: Status = { id: 5, name: 'In Progress', color: '#00ff00', sortOrder: 1, icon: 'circle' }
    useStatusStore.setState({ statuses: [inProgress] })
    useTodoStore.setState({
      todos: [makeTodo({ id: 42, title: 'Click target', statusId: 5 })],
      loading: false,
      error: null,
    })
    useUIStore.setState({ selectedTodoId: null, editPopupMode: null } as never)

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'Click' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const option = within(listbox).getAllByRole('option')[0]!
    const statusPill = within(option).getByTitle('In Progress')

    // Sanity: clicking the row button itself fires onOpen → openEditPopup.
    act(() => {
      fireEvent.click(option)
    })
    expect(useUIStore.getState().selectedTodoId).toBe(42)
    expect(useUIStore.getState().editPopupMode).toBe('edit')

    // The pill container is `aria-hidden` (decorative) and the shared
    // `<TaskPillBar>` read-only wrapper carries `pointer-events: none` via
    // its `barReadOnly` class (post ui-consistency-2026-04-25 P2 the inline
    // `miniListPills` span was retired in favor of the shared primitive).
    // The CSS-driven hit-testing isn't observable in JSDOM, so we can't
    // assert "click on chip routes to button" via fireEvent (which
    // dispatches on the element regardless of CSS). Verify the structural
    // guarantee instead: the pill bar is marked decorative and clicking
    // the chip's ancestor chain ends at the row's <button>.
    const pillBar = statusPill.closest(`[aria-hidden="true"]`)
    expect(pillBar).not.toBeNull()
    expect((pillBar as HTMLElement).className).toMatch(/barReadOnly/)
    expect(statusPill.closest('button')).toBe(option)
  })

  it('renders no pill bar for a bare todo with no people/org/status/dates', async () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'plain todo' })],
      loading: false,
      error: null,
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'plain' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const option = within(listbox).getAllByRole('option')[0]!
    // Title still renders; nothing else.
    expect(within(option).getByText('plain todo')).toBeInTheDocument()
    expect(within(option).queryByTitle('Scheduled')).toBeNull()
    expect(within(option).queryByTitle('Deadline')).toBeNull()
  })
})
