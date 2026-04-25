import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { buildSearchContextMenuItems } from '../../../components/layout/top-bar-search-menu'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useProjectStore } from '../../../stores/project-store'
import { useTaskboardStore } from '../../../stores/taskboard-store'
import { useUIStore } from '../../../stores/ui-store'
import { makeTodo } from '../../helpers'

/**
 * P4 (features-batch-2026-04) — search-result right-click menu.
 *
 * The menu lives on `TopBar` (not `SearchResultRow`) so it outlives the
 * search dropdown closing when the menu opens. The menu's item list is
 * produced by `buildSearchContextMenuItems` — a pure helper. Testing that
 * helper confirms each menu item dispatches the expected store call. The
 * right-click wiring (`onContextMenu` → parent callback) is trivial and
 * covered by manual testing against the exit criteria.
 */
describe('buildSearchContextMenuItems — P4 search context menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes the full menu item sequence with a separator before Delete', () => {
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo' }),
      onBoard: false,
      onOpen: vi.fn(),
      onMoveToProject: vi.fn(),
    })
    const labels = items.map((i) => i.separator ? '--' : i.label)
    expect(labels).toEqual([
      'Open',
      'Mark complete',
      'Add to Taskboard',
      'Move to project…',
      '--',
      'Delete',
    ])
    expect(items[items.length - 1].danger).toBe(true)
  })

  it('shows "Mark incomplete" when the todo is completed', () => {
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo', isCompleted: true }),
      onBoard: false,
      onOpen: vi.fn(),
      onMoveToProject: vi.fn(),
    })
    expect(items[1].label).toBe('Mark incomplete')
  })

  it('shows "Remove from Taskboard" when the todo is already on the board', () => {
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo' }),
      onBoard: true,
      onOpen: vi.fn(),
      onMoveToProject: vi.fn(),
    })
    expect(items[2].label).toBe('Remove from Taskboard')
  })

  it('Open action calls the onOpen callback with the todo id', () => {
    const onOpen = vi.fn()
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 42, title: 'Foo' }),
      onBoard: false,
      onOpen,
      onMoveToProject: vi.fn(),
    })
    items[0].action()
    expect(onOpen).toHaveBeenCalledWith(42)
  })

  it('Mark complete action calls todoStore.toggleComplete', () => {
    const toggleComplete = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ toggleComplete } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 7, title: 'Foo' }),
      onBoard: false,
      onOpen: vi.fn(),
      onMoveToProject: vi.fn(),
    })
    items[1].action()
    expect(toggleComplete).toHaveBeenCalledWith(7)
  })

  it('Add to Taskboard action calls taskboardStore.add', () => {
    const add = vi.fn()
    vi.spyOn(useTaskboardStore, 'getState').mockReturnValue({ add } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 9, title: 'Foo' }),
      onBoard: false,
      onOpen: vi.fn(),
      onMoveToProject: vi.fn(),
    })
    items[2].action()
    expect(add).toHaveBeenCalledWith(9)
  })

  it('Remove from Taskboard action calls taskboardStore.removeEntry when on board', () => {
    const removeEntry = vi.fn()
    vi.spyOn(useTaskboardStore, 'getState').mockReturnValue({ removeEntry } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 11, title: 'Foo' }),
      onBoard: true,
      onOpen: vi.fn(),
      onMoveToProject: vi.fn(),
    })
    items[2].action()
    expect(removeEntry).toHaveBeenCalledWith(11)
  })

  it('Move to project… action calls the onMoveToProject callback', () => {
    const onMoveToProject = vi.fn()
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 3, title: 'Foo' }),
      onBoard: false,
      onOpen: vi.fn(),
      onMoveToProject,
    })
    items[3].action()
    expect(onMoveToProject).toHaveBeenCalled()
  })

  it('Delete action queues a single-id bulk confirmation', () => {
    const showBulkConfirmation = vi.fn()
    vi.spyOn(useUIStore, 'getState').mockReturnValue({ showBulkConfirmation } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 99, title: 'Foo' }),
      onBoard: false,
      onOpen: vi.fn(),
      onMoveToProject: vi.fn(),
    })
    const deleteItem = items[items.length - 1]
    deleteItem.action()
    expect(showBulkConfirmation).toHaveBeenCalledWith('delete', [99])
  })
})

/**
 * P2 (search-and-notes-bugs) — the search dropdown must stay mounted
 * underneath the context menu on right-click. The previous P4 implementation
 * eagerly blurred the input + flipped `searchFocused` to false when the menu
 * opened; that collapsed the result list out from under the user. The fix in
 * `handleOpenSearchContextMenu` drops those two lines and relies on the row's
 * `onMouseDown preventDefault` to keep the input focused while the menu is
 * visible. When the user picks a menu item, the menu button receives focus
 * on mousedown — the input's natural blur still collapses the dropdown, so
 * actions still clean up both surfaces.
 */
describe('TopBar search right-click — P2 dropdown survival', () => {
  beforeEach(() => {
    useFilterStore.getState().clearAll()
    useTodoStore.setState({ todos: [], loading: false, error: null })
    usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
    useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
    useProjectStore.setState({ projects: [], loading: false, error: null })
    useTaskboardStore.setState({ board: null, loading: false, error: null })
  })

  afterEach(cleanup)

  function seedAndOpenResults() {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'buy milk' })],
      loading: false,
      error: null,
    })
    render(
      <MemoryRouter initialEntries={['/list']}>
        <TopBar />
      </MemoryRouter>,
    )
    const input = screen.getByPlaceholderText('Search...') as HTMLInputElement
    act(() => {
      input.focus()
      fireEvent.change(input, { target: { value: 'buy' } })
    })
    const listbox = screen.getByRole('listbox', { name: /search results/i })
    const row = within(listbox).getByRole('option')
    return { input, listbox, row }
  }

  it('keeps the listbox mounted when a row is right-clicked', () => {
    const { listbox, row } = seedAndOpenResults()
    act(() => {
      fireEvent.contextMenu(row, { clientX: 50, clientY: 50 })
    })
    expect(screen.getByRole('listbox', { name: /search results/i })).toBe(listbox)
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument()
  })

  it('closes both the menu and the listbox when a menu action runs', () => {
    const toggleComplete = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ toggleComplete } as never)

    const { input, row } = seedAndOpenResults()
    act(() => {
      fireEvent.contextMenu(row, { clientX: 50, clientY: 50 })
    })
    const markComplete = screen.getByRole('button', { name: 'Mark complete' })

    // Simulate the real mousedown → focus-transfer → blur sequence. JSDOM
    // only blurs the input when another element actually takes focus, so
    // moving focus to the menu button before `click` matches what the
    // browser does on a real pointer press.
    act(() => {
      markComplete.focus()
      fireEvent.click(markComplete)
    })

    expect(toggleComplete).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('listbox', { name: /search results/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull()
    expect(document.activeElement).not.toBe(input)
  })
})
