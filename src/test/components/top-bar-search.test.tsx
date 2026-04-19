import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../components/layout/TopBar'
import { useFilterStore } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useTodoStore } from '../../stores/todo-store'
import { useProjectStore } from '../../stores/project-store'
import { makePerson, makeTag, makeOrg, makeProject, makeTodo } from '../helpers'

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
    useTagStore.setState({ tags: [makeTag({ id: 1, name: 'urgent' })], assignedTagsMap: new Map() })
    useOrgStore.setState({ orgs: [makeOrg({ id: 1, name: 'Acme' })], assignedOrgsMap: new Map(), personOrgMap: new Map() })
    useStatusStore.setState({ statuses: [] })
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
})
