import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useFileStorageStore } from '../../../stores/file-storage-store'

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
    fireEvent.click(screen.getByTitle('Clear all filters'))
    expect(tray).not.toHaveAttribute('data-filtered')
  })
})
