import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { SyncStatusButton } from '../../../components/layout/SyncStatusButton'
import { useFileStorageStore } from '../../../services/file-storage-store'
import { useFileOpsStore } from '../../../stores/file-ops-store'

function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname} ${JSON.stringify(location.state)}`}</output>
}

function renderButton() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SyncStatusButton />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
  useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SyncStatusButton (phone top bar)', () => {
  it('hidden while there is nothing to say (Local only, Syncing)', () => {
    renderButton()
    expect(screen.queryByTestId('sync-status-button')).toBeNull()
    act(() => useFileStorageStore.setState({ isConnected: true, fileName: 'todo2.json' }))
    expect(screen.queryByTestId('sync-status-button')).toBeNull()
  })

  it('announces the first warning that appears (its live region stays mounted)', () => {
    renderButton()
    expect(screen.getByTestId('sync-announcer')).toHaveTextContent('')
    act(() => useFileStorageStore.setState({ isConnected: true, fileName: 'todo2.json', error: 'Failed to save to file' }))
    expect(screen.getByTestId('sync-announcer')).toHaveTextContent('Sync error: Failed to save to file')
  })

  it('a warning shows it, coloured by state, with a count from two; tap → the sheet with the same sections', () => {
    const reconnect = vi.fn().mockResolvedValue(undefined)
    useFileStorageStore.setState({ fileName: 'todo2.json', needsPermission: true, reconnect })
    useFileOpsStore.setState({ snapshotWarning: 'No backup was taken before importing the file — the backup could not be saved.' })
    renderButton()
    const button = screen.getByRole('button', { name: 'Storage: Permission needed, 2 warnings' })
    expect(button).toHaveAttribute('data-state', 'permission')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveTextContent('2')

    fireEvent.click(button)
    const sheet = screen.getByRole('dialog', { name: 'Permission needed' })
    expect([...sheet.querySelectorAll('[data-warning]')].map((s) => s.getAttribute('data-warning'))).toEqual(['permission', 'backup'])
    // No Backups part on the phone: Dismiss only.
    expect(within(sheet).queryByRole('button', { name: 'Open Backups…' })).toBeNull()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Grant access' }))
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a sync error is red; File storage settings opens the Settings page on Database', () => {
    useFileStorageStore.setState({ isConnected: true, fileName: 'todo2.json', error: 'Failed to save to file' })
    renderButton()
    const button = screen.getByRole('button', { name: 'Storage: Sync error' })
    expect(button.querySelector('span')?.className).toMatch(/danger/)
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'File storage settings' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/settings {"section":"database"}')
  })
})
