import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { buildSearchContextMenuItems } from '../../../components/layout/top-bar-search-menu'
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
 * search dropdown closing when the menu opens. The menu's item list is
 * produced by `buildSearchContextMenuItems` — a pure helper. Testing that
 * helper confirms each menu item dispatches the expected store call. The
 * right-click wiring (`onContextMenu` → parent callback) is trivial and
 * covered by manual testing against the exit criteria.
 */
function itemByLabel(items: ReturnType<typeof buildSearchContextMenuItems>, label: string) {
  const item = items.find((i) => i.label === label)
  if (!item) throw new Error(`no menu item "${label}" in ${items.map((i) => i.label).join(', ')}`)
  return item
}

describe('buildSearchContextMenuItems — search context menu', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes the full menu item sequence with a separator before Delete', () => {
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo' }),
      onOpen: vi.fn(),
    })
    const labels = items.map((i) => i.separator ? '--' : i.label)
    expect(labels).toEqual([
      'Open',
      'Mark complete',
      'Followed up',
      'Mark urgent',
      'Mark important',
      'Add to Focus',
      '--',
      'Delete',
    ])
    expect(items[items.length - 1]!.danger).toBe(true)
  })

  it('shows "Mark incomplete" when the todo is completed', () => {
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 1, title: 'Foo', isCompleted: true }),
      onOpen: vi.fn(),
    })
    expect(items[1]!.label).toBe('Mark incomplete')
  })

  it('Open action calls the onOpen callback with the todo id', () => {
    const onOpen = vi.fn()
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 42, title: 'Foo' }),
      onOpen,
    })
    items[0]!.action()
    expect(onOpen).toHaveBeenCalledWith(42)
  })

  it('Mark complete action calls todoStore.toggleComplete', () => {
    const toggleComplete = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ toggleComplete } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 7, title: 'Foo' }),
      onOpen: vi.fn(),
    })
    items[1]!.action()
    expect(toggleComplete).toHaveBeenCalledWith(7)
  })

  it('Add to Focus puts just this task in focus', () => {
    const bulkSetFocus = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ bulkSetFocus } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 9, title: 'Foo' }),
      onOpen: vi.fn(),
    })
    itemByLabel(items, 'Add to Focus').action()
    expect(bulkSetFocus).toHaveBeenCalledWith([9], true)
  })

  it('Remove from Focus takes a task in focus out', () => {
    const bulkSetFocus = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ bulkSetFocus } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 11, title: 'Foo', focus: true }),
      onOpen: vi.fn(),
    })
    itemByLabel(items, 'Remove from Focus').action()
    expect(bulkSetFocus).toHaveBeenCalledWith([11], false)
  })

  it('Mark important / Remove important flag just this task', () => {
    const bulkSetImportant = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ bulkSetImportant } as never)
    itemByLabel(buildSearchContextMenuItems({ todo: makeTodo({ id: 9 }), onOpen: vi.fn() }), 'Mark important').action()
    expect(bulkSetImportant).toHaveBeenCalledWith([9], true)
    itemByLabel(buildSearchContextMenuItems({ todo: makeTodo({ id: 9, important: true }), onOpen: vi.fn() }), 'Remove important').action()
    expect(bulkSetImportant).toHaveBeenCalledWith([9], false)
  })

  it('Mark urgent flags just this task', () => {
    const bulkSetUrgent = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ bulkSetUrgent } as never)
    itemByLabel(buildSearchContextMenuItems({ todo: makeTodo({ id: 9 }), onOpen: vi.fn() }), 'Mark urgent').action()
    expect(bulkSetUrgent).toHaveBeenCalledWith([9], true)
  })

  it('Followed up stamps just this task (search rows are not part of the selection)', () => {
    const markFollowedUp = vi.fn()
    vi.spyOn(useTodoStore, 'getState').mockReturnValue({ markFollowedUp } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 5, title: 'Foo' }),
      onOpen: vi.fn(),
    })
    itemByLabel(items, 'Followed up').action()
    expect(markFollowedUp).toHaveBeenCalledWith([5])
  })

  it('Delete action queues a single-id bulk confirmation', () => {
    const showBulkConfirmation = vi.fn()
    vi.spyOn(useUIStore, 'getState').mockReturnValue({ showBulkConfirmation } as never)
    const items = buildSearchContextMenuItems({
      todo: makeTodo({ id: 99, title: 'Foo' }),
      onOpen: vi.fn(),
    })
    const deleteItem = items[items.length - 1]!
    deleteItem.action()
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
    useTodoStore.setState({ todos: [], loading: false, error: null })
    usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
  })

  afterEach(cleanup)

  function seedAndOpenResults() {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, title: 'buy milk' })],
      loading: false,
      error: null,
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
