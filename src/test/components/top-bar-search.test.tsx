import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../components/layout/TopBar'
import { useFilterStore } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useProjectStore } from '../../stores/project-store'
import type { Tag } from '../../models'
import { makePerson, makeOrg, makeProject, makeTodo } from '../helpers'

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/list']}>
      <TopBar />
    </MemoryRouter>,
  )
}

describe('TopBar grouped search', () => {
  beforeEach(() => {
    useFilterStore.getState().clearAll()
    useTodoStore.setState({ todos: [], loading: false, error: null })
    usePersonStore.setState({
      people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
      assignedPeopleMap: new Map(),
    })
    useOrgStore.setState({ orgs: [makeOrg({ id: 1, name: 'Acme' })], assignedOrgsMap: new Map(), personOrgMap: new Map() })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
    useProjectStore.setState({ projects: [makeProject({ id: 1, canvasId: 1, name: 'Marketing' })], loading: false, error: null })
  })

  afterEach(cleanup)

  it('renders groups for Title / Notes matches with counts and icons', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Buy milk', notes: '' }),
        makeTodo({ id: 2, title: 'random', notes: 'remember to buy bread' }),
        makeTodo({ id: 3, title: 'buy stamps', notes: 'for the letters' }),
      ],
      loading: false,
      error: null,
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement

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

  it('groups by project name when assigned', async () => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'plan Q4', projectId: 1 }),
        makeTodo({ id: 2, title: 'review brief', projectId: 1 }),
      ],
      loading: false,
      error: null,
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'market' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const projectGroup = within(listbox).getByRole('group', { name: 'Project' })
    expect(within(projectGroup).getAllByRole('option')).toHaveLength(2)
  })

  it('does not show the listbox when no results match', async () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'hello' })],
      loading: false,
      error: null,
    })
    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'zzz' } })
    })
    expect(screen.queryByRole('listbox', { name: /search results/i })).toBeNull()
  })

  // Tag search names are sourced from the registry + assignedTagsMap, not
  // from the legacy inline `todo.tags` field. Seeding tags only on the
  // store (without an inline field on the todo) proves the dropdown reads
  // through the registry path.
  it('renders a Tags group when the query matches a tag via the registry', async () => {
    const urgent: Tag = { id: 10, name: 'urgent', color: '#f00' }
    const today: Tag = { id: 20, name: 'today', color: '#0f0' }
    useTagStore.setState({
      tags: [urgent, today],
      assignedTagsMap: new Map([
        [1, [urgent]],
        [2, [today, urgent]],
      ]),
      loading: false,
      error: null,
    })
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'review budget' }),
        makeTodo({ id: 2, title: 'pick up keys' }),
        makeTodo({ id: 3, title: 'unrelated' }),
      ],
      loading: false,
      error: null,
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'urgent' } })
    })

    const listbox = await screen.findByRole('listbox', { name: /search results/i })
    const tagGroup = within(listbox).getByRole('group', { name: 'Tags' })
    expect(within(tagGroup).getAllByRole('option')).toHaveLength(2)
  })

  it('does not match a Tags group from the legacy inline todo.tags field', async () => {
    // Registry is empty; only the (legacy) inline field carries the tag.
    // Expect the Tags group to be absent — the search path must read the
    // registry, not the inline field.
    useTagStore.setState({
      tags: [],
      assignedTagsMap: new Map(),
      loading: false,
      error: null,
    })
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'review budget', tags: ['urgent'] })],
      loading: false,
      error: null,
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    await act(async () => {
      input.focus()
      fireEvent.change(input, { target: { value: 'urgent' } })
    })

    expect(screen.queryByRole('listbox', { name: /search results/i })).toBeNull()
  })

  it('keyboard roving focus steps into the Tags group', async () => {
    const urgent: Tag = { id: 10, name: 'urgent', color: '#f00' }
    useTagStore.setState({
      tags: [urgent],
      assignedTagsMap: new Map([[1, [urgent]]]),
      loading: false,
      error: null,
    })
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'review budget' })],
      loading: false,
      error: null,
    })

    renderBar()
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
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
