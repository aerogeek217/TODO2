import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { StoragePill } from '../../../components/layout/StoragePill'
import { FileSyncBanner } from '../../../components/layout/FileSyncBanner'
import { removeLegacySyncKeys, storagePillState, type StoragePillInput } from '../../../components/layout/sync-status'
import { useFileStorageStore } from '../../../stores/file-storage-store'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import { useUIStore } from '../../../stores/ui-store'

const base: StoragePillInput = {
  isConnected: false,
  fileName: null,
  needsPermission: false,
  paused: null,
  error: null,
  dismissedError: null,
}

describe('storagePillState', () => {
  it('no file: Local only', () => {
    expect(storagePillState(base)).toEqual({ kind: 'local', text: 'Local only' })
  })

  it('syncing: the file name', () => {
    expect(storagePillState({ ...base, isConnected: true, fileName: 'todo2.json' })).toEqual({ kind: 'syncing', text: 'todo2.json' })
  })

  it('permission needed or paused: Sync paused, ahead of an error', () => {
    expect(storagePillState({ ...base, fileName: 'f.json', needsPermission: true }).kind).toBe('paused')
    expect(storagePillState({ ...base, fileName: 'f.json', paused: { message: 'x' }, error: 'boom' })).toEqual({ kind: 'paused', text: 'Sync paused' })
  })

  it('an error: Sync error until dismissed, then the underlying state', () => {
    const connected = { ...base, isConnected: true, fileName: 'f.json', error: 'Failed to save to file' }
    expect(storagePillState(connected)).toEqual({ kind: 'error', text: 'Sync error' })
    expect(storagePillState({ ...connected, dismissedError: 'Failed to save to file' }).kind).toBe('syncing')
    expect(storagePillState({ ...connected, dismissedError: 'an older error' }).kind).toBe('error')
  })
})

describe('StoragePill', () => {
  beforeEach(() => {
    useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
    useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
    useUIStore.setState(useUIStore.getInitialState(), true)
  })

  afterEach(cleanup)

  it('Local only: the popover leads to Settings → File storage', () => {
    useFileStorageStore.setState({ isSupported: true })
    render(<StoragePill />)
    fireEvent.click(screen.getByRole('button', { name: 'Storage: Local only' }))
    const popover = screen.getByRole('dialog', { name: 'Stored in this browser only' })
    expect(popover).toHaveTextContent('Connect a file')
    fireEvent.click(screen.getByRole('button', { name: 'Set up file storage…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'file-storage' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('without file sync support it offers Import / Export instead', () => {
    useFileStorageStore.setState({ isSupported: false })
    render(<StoragePill />)
    fireEvent.click(screen.getByRole('button', { name: 'Storage: Local only' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('can’t sync to a file')
    fireEvent.click(screen.getByRole('button', { name: 'Import / Export…' }))
    expect(useUIStore.getState().settingsSection).toBe('import-export')
  })

  it('syncing: the file name, and when it last saved', () => {
    useFileStorageStore.setState({ isConnected: true, fileName: 'todo2.json', lastSavedAt: new Date(Date.now() - 120_000) })
    render(<StoragePill />)
    fireEvent.click(screen.getByRole('button', { name: 'Storage: todo2.json' }))
    const popover = screen.getByRole('dialog', { name: 'Syncing to todo2.json' })
    expect(popover).toHaveTextContent('Last saved 2m ago.')
    expect(screen.getByRole('button', { name: 'File storage settings…' })).toBeInTheDocument()
  })

  it('paused: the strip’s message and actions', () => {
    useFileStorageStore.setState({ fileName: 'todo2.json', paused: { reason: 'invalid', message: 'File sync paused — todo2.json contains invalid JSON.' } as never })
    render(<StoragePill />)
    const pill = screen.getByRole('button', { name: 'Storage: Sync paused' })
    expect(pill).toHaveAttribute('data-state', 'paused')
    fireEvent.click(pill)
    const popover = screen.getByRole('dialog', { name: 'Sync paused' })
    expect(popover).toHaveTextContent('invalid JSON')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep browser data…' })).toBeInTheDocument()
  })
})

describe('sync warning strip', () => {
  beforeEach(() => {
    useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
    useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
  })

  afterEach(cleanup)

  it('has no "stored locally" info branch', () => {
    useFileStorageStore.setState({ isSupported: true })
    const { container } = render(<FileSyncBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('an error shows until dismissed; the pill follows', () => {
    useFileStorageStore.setState({ isConnected: true, fileName: 'f.json', error: 'Failed to save to file' })
    render(<><FileSyncBanner /><StoragePill /></>)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save to file')
    expect(screen.getByTestId('storage-pill')).toHaveAttribute('data-state', 'error')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('storage-pill')).toHaveAttribute('data-state', 'syncing')
    // A new error shows again.
    act(() => useFileStorageStore.setState({ error: 'Failed to read file' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to read file')
  })

  it('permission needed: Grant access', () => {
    useFileStorageStore.setState({ fileName: 'f.json', needsPermission: true })
    render(<FileSyncBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('File sync to f.json is paused — permission needed.')
    expect(screen.getByRole('button', { name: 'Grant access' })).toBeInTheDocument()
  })
})

describe('removeLegacySyncKeys', () => {
  it('drops the old info-strip dismissal key', () => {
    localStorage.setItem('todo2-file-sync-banner-dismissed', '1')
    removeLegacySyncKeys()
    expect(localStorage.getItem('todo2-file-sync-banner-dismissed')).toBeNull()
  })
})
