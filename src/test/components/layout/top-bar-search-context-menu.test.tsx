import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { searchMenuHandlers } from '../../../components/layout/top-bar-search-menu'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { makeTodo } from '../../helpers'

/**
 * Search-result right-click menu.
 *
 * The menu lives on `TopBar` (not `SearchResultRow`) so it outlives the
 * search dropdown closing when the menu opens. It is the shared task menu
 * (`TaskMenu`) driven by `searchMenuHandlers`, which act on just the one
 * task (search rows aren't part of the selection) and leave out the picker
 * items (the row has none). These tests pin that each handler dispatches
 * the expected store call.
 */
describe('searchMenuHandlers — search context menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('has no picker handlers, so the menu leaves those items out', () => {
    const h = searchMenuHandlers({ todo: makeTodo({ id: 1 }), onOpen: vi.fn() })
    expect(h.onSetDueDate).toBeUndefined()
    expect(h.onPickFollowup).toBeUndefined()
    expect(h.onAssignPeople).toBeUndefined()
    expect(h.onAddTag).toBeUndefined()
  })

  it('Open calls onOpen with the todo id', () => {
    const onOpen = vi.fn()
    searchMenuHandlers({ todo: makeTodo({ id: 42 }), onOpen }).onOpen!()
    expect(onOpen).toHaveBeenCalledWith(42)
  })

  it('Mark complete calls todoStore.toggleComplete', () => {
    const toggleComplete = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ toggleComplete } as never)
    searchMenuHandlers({ todo: makeTodo({ id: 7 }), onOpen: vi.fn() }).onToggleComplete()
    expect(toggleComplete).toHaveBeenCalledWith(7)
  })

  it('markers act on just this task', () => {
    const bulkSetFocus = vi.fn()
    const bulkSetImportant = vi.fn()
    const bulkSetUrgent = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ bulkSetFocus, bulkSetImportant, bulkSetUrgent, todos: [] } as never)
    const h = searchMenuHandlers({ todo: makeTodo({ id: 9 }), onOpen: vi.fn() })
    h.onSetMarker('focus', true)
    h.onSetMarker('important', false)
    h.onSetMarker('urgent', true)
    expect(bulkSetFocus).toHaveBeenCalledWith([9], true)
    expect(bulkSetImportant).toHaveBeenCalledWith([9], false)
    expect(bulkSetUrgent).toHaveBeenCalledWith([9], true)
  })

  it('Follow-up and Followed up act on just this task', () => {
    const markFollowedUp = vi.fn()
    const bulkSetFollowup = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ markFollowedUp, bulkSetFollowup } as never)
    const h = searchMenuHandlers({ todo: makeTodo({ id: 5 }), onOpen: vi.fn() })
    h.onFollowedUp()
    h.onSetFollowup(null)
    expect(markFollowedUp).toHaveBeenCalledWith([5])
    expect(bulkSetFollowup).toHaveBeenCalledWith([5], null)
  })

  it('Delete queues a single-id bulk confirmation', () => {
    const showBulkConfirmation = vi.fn()
    vi.spyOn(useUIStore, 'getState').mockReturnValue({ showBulkConfirmation } as never)
    searchMenuHandlers({ todo: makeTodo({ id: 99 }), onOpen: vi.fn() }).onDelete()
    expect(showBulkConfirmation).toHaveBeenCalledWith('delete', [99])
  })
})

/**
 * The search dropdown must stay mounted underneath the context menu on
 * right-click. `handleOpenSearchContextMenu` neither blurs the input nor
 * flips `searchFocused`; the row's `onMouseDown preventDefault` keeps the
 * input focused while the menu is visible. When the user picks a menu item,
 * the menu button receives focus on mousedown — the input's natural blur
 * still collapses the dropdown, so actions clean up both surfaces.
 */
describe('TopBar search right-click — dropdown survival', () => {
  beforeEach(() => {
    useFilterStore.getState().clearAll()
    useTodoStore.setState({ todos: [] })
    usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  })

  afterEach(cleanup)

  function seedAndOpenResults() {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'buy milk' })],
    })
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    )
    const input = screen.getByPlaceholderText('Search…') as HTMLInputElement
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
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Mark complete' })).toBeInTheDocument()
  })

  it('closes both the menu and the listbox when a menu action runs', () => {
    const toggleComplete = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ toggleComplete } as never)

    const { input, row } = seedAndOpenResults()
    act(() => {
      fireEvent.contextMenu(row, { clientX: 50, clientY: 50 })
    })
    const markComplete = screen.getByRole('menuitem', { name: 'Mark complete' })

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
    expect(screen.queryByRole('menuitem', { name: 'Mark complete' })).toBeNull()
    expect(document.activeElement).not.toBe(input)
  })
})
