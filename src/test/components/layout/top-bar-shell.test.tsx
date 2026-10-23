import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useFileStorageStore } from '../../../services/file-storage-store'
import { makeTodo } from '../../helpers'

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  )
}

describe('TopBar — app shell', () => {
  beforeEach(() => {
    useFilterStore.setState(useFilterStore.getInitialState(), true)
    useUIStore.setState(useUIStore.getInitialState(), true)
    useTodoStore.setState(useTodoStore.getInitialState(), true)
    usePersonStore.setState(usePersonStore.getInitialState(), true)
    useStatusStore.setState(useStatusStore.getInitialState(), true)
    useTagStore.setState(useTagStore.getInitialState(), true)
    useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
  })

  afterEach(cleanup)

  it('New task opens quick add', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    expect(useUIStore.getState().quickAddOpen).toBe(true)
  })

  it('the gear opens Settings, without leaving the route', () => {
    renderBar()
    const gear = screen.getByRole('button', { name: 'Settings' })
    expect(gear).toHaveAttribute('title', 'Settings (G then S)')
    fireEvent.click(gear)
    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it('has no theme toggle', () => {
    renderBar()
    expect(screen.queryByRole('button', { name: /theme/i })).toBeNull()
  })

  it('the filter tray is marked filtered while any screen filter is on', () => {
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    expect(tray).not.toHaveAttribute('data-filtered')
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(tray).toHaveAttribute('data-filtered', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(tray).not.toHaveAttribute('data-filtered')
  })

  it('the funnel, left of search, clears every screen filter; disabled while none is on; no Clear all text', () => {
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    const funnel = within(tray).getByRole('button', { name: 'Clear all filters' })
    const search = within(tray).getByRole('textbox', { name: 'Search tasks' })
    expect(funnel.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(funnel).toBeDisabled()
    act(() => {
      useFilterStore.getState().setPersonIds(new Set([1]))
      useFilterStore.getState().setShowCompleted(true)
    })
    expect(funnel).toBeEnabled()
    expect(within(tray).queryByText('Clear all')).toBeNull()
    fireEvent.click(funnel)
    expect(useFilterStore.getState().isActive).toBe(false)
    expect(useFilterStore.getState().filters.personIds).toBeNull()
    expect(funnel).toBeDisabled()
  })

  it('Show N tasks ends the tray while a filter is on: the tasks it matches; a click opens the filtered-tasks panel', () => {
    useTodoStore.setState({ todos: [
      makeTodo({ id: 1, title: 'Alpha' }),
      makeTodo({ id: 2, title: 'Alpha done', isCompleted: true }),
      makeTodo({ id: 3, title: 'Beta' }),
    ] })
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    expect(within(tray).queryByRole('button', { name: /^Show \d+ tasks?$/ })).toBeNull()
    act(() => useFilterStore.getState().setSearchText('alpha'))
    // Open ones only…
    expect(within(tray).getByRole('button', { name: 'Show 1 task' })).toBeTruthy()
    // …completed too under Show completed; a task write updates it.
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(within(tray).getByRole('button', { name: 'Show 2 tasks' })).toBeTruthy()
    act(() => useTodoStore.setState({ todos: [...useTodoStore.getState().todos, makeTodo({ id: 4, title: 'Alpha two' })] }))
    const button = within(tray).getByRole('button', { name: 'Show 3 tasks' })
    expect(tray.lastElementChild).toBe(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(useUIStore.getState().filterPanelOpen).toBe(true)
    expect(useUIStore.getState().taskDialog).toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    // Cleared with the panel open: the button stays (the panel's toggle), now every open task.
    act(() => useFilterStore.getState().clearAll())
    expect(within(tray).getByRole('button', { name: 'Show 3 tasks' })).toBe(button)
    fireEvent.click(button)
    expect(useUIStore.getState().filterPanelOpen).toBe(false)
    // Closed with no filter: it goes.
    expect(within(tray).queryByRole('button', { name: /^Show \d+ tasks?$/ })).toBeNull()
  })
})
