import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { StoragePill } from '../../../components/layout/StoragePill'
import {
  removeLegacySyncKeys,
  storagePillLabel,
  storagePillState,
  syncWarningCopy,
  syncWarnings,
  type StoragePillInput,
} from '../../../components/layout/sync-status'
import { useFileStorageStore } from '../../../services/file-storage-store'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import { useUIStore } from '../../../stores/ui-store'

const base: StoragePillInput = {
  isConnected: false,
  fileName: null,
  needsPermission: false,
  paused: null,
  error: null,
  dismissedError: null,
  snapshotWarning: null,
}

const conflictPause = { reason: 'conflict-cancelled' as const, message: 'File sync paused — this browser and f.json have different data. Choose which version to keep.' }

/** Each warning state on its own (an error needs no permission / pause to count). */
const ON: Record<'permission' | 'paused' | 'error' | 'backup', Partial<StoragePillInput>> = {
  permission: { needsPermission: true },
  paused: { paused: conflictPause },
  error: { error: 'Failed to save to file' },
  backup: { snapshotWarning: 'No backup was taken before importing the file — the backup could not be saved.' },
}

describe('storagePillState', () => {
  it('no file: Local only', () => {
    expect(storagePillState(base)).toEqual({ kind: 'local', text: 'Local only', warningCount: 0 })
  })

  it('syncing: the file name', () => {
    expect(storagePillState({ ...base, isConnected: true, fileName: 'todo2.json' })).toEqual({ kind: 'syncing', text: 'todo2.json', warningCount: 0 })
  })

  it('each warning on its own: its text, one warning', () => {
    const texts = { permission: 'Permission needed', paused: 'Sync paused', error: 'Sync error', backup: 'Backup warning' }
    for (const kind of ['permission', 'paused', 'error', 'backup'] as const) {
      expect(storagePillState({ ...base, fileName: 'f.json', isConnected: true, ...ON[kind] })).toEqual({ kind, text: texts[kind], warningCount: 1 })
    }
  })

  it('every pair: the more urgent wins — Permission needed › Sync paused › Sync error › Backup warning', () => {
    const order = ['permission', 'paused', 'error', 'backup'] as const
    for (const [i, a] of order.entries()) {
      for (const b of order.slice(i + 1)) {
        const s = { ...base, fileName: 'f.json', ...ON[a], ...ON[b] }
        // An error is that state's cause while permission is needed or sync is paused, not its own warning.
        const errorHidden = b === 'error' && (a === 'permission' || a === 'paused')
        expect(storagePillState(s), `${a} + ${b}`).toMatchObject({ kind: a, warningCount: errorHidden ? 1 : 2 })
      }
    }
  })

  it('an error shows until dismissed, then the state underneath; a different error shows again', () => {
    const connected = { ...base, isConnected: true, fileName: 'f.json', error: 'Failed to save to file' }
    expect(storagePillState(connected).kind).toBe('error')
    expect(storagePillState({ ...connected, dismissedError: 'Failed to save to file' }).kind).toBe('syncing')
    expect(storagePillState({ ...connected, dismissedError: 'an older error' }).kind).toBe('error')
    expect(storagePillState({ ...connected, dismissedError: 'Failed to save to file', snapshotWarning: 'x' }).kind).toBe('backup')
  })

  it('the accessible name counts several warnings', () => {
    expect(storagePillLabel(storagePillState({ ...base, ...ON.paused, ...ON.backup }))).toBe('Storage: Sync paused, 2 warnings')
    expect(storagePillLabel(storagePillState({ ...base, ...ON.paused }))).toBe('Storage: Sync paused')
  })
})

describe('syncWarningCopy', () => {
  it('permission: the why, and the flag after a refused grant', () => {
    const [w] = syncWarnings({ ...base, fileName: 'f.json', needsPermission: true, error: 'Permission denied' })
    expect(syncWarningCopy(w!)).toEqual({
      title: 'Permission needed',
      why: 'Sync to f.json is paused until your browser lets TODO2 open the file.',
      flag: 'Your browser refused access last time.',
      body: 'You’re working on this browser’s data. Nothing is written to the file meanwhile.',
    })
    const [plain] = syncWarnings({ ...base, fileName: 'f.json', needsPermission: true })
    expect(syncWarningCopy(plain!).flag).toBeNull()
  })

  it('paused: the message without its prefix, as a sentence, and the body per reason', () => {
    const copy = (paused: StoragePillInput['paused']) => syncWarningCopy(syncWarnings({ ...base, fileName: 'f.json', paused })[0]!)
    expect(copy(conflictPause)).toMatchObject({
      why: 'This browser and f.json have different data. Choose which version to keep.',
      body: 'Nothing has been written to either side. Retry shows the choice again; Keep browser data… overwrites the file after a backup of it.',
    })
    expect(copy({ reason: 'too-new', message: 'File sync paused — f.json was saved by a newer version of TODO2.' })).toMatchObject({
      why: 'f.json was saved by a newer version of TODO2.',
      body: 'Nothing has been written to either side. Update TODO2 to keep what that version saved, or keep this browser’s data.',
    })
    expect(copy({ reason: 'invalid-json', message: 'File sync paused — the file contains invalid JSON' }))
      .toMatchObject({ why: 'The file contains invalid JSON', body: 'Nothing has been written to either side.' })
    // After a failed write-back the browser holds the file's data: no "nothing written".
    expect(copy({ reason: 'write-failed', message: 'File sync paused — f.json could not be written.' }).body).toBeNull()
  })

  it('error and backup: their text, and what to do', () => {
    expect(syncWarningCopy({ kind: 'error', message: 'Failed to save to file' }).body)
      .toBe('Your changes are still kept in this browser. Dismiss hides this until a different error happens.')
    expect(syncWarningCopy({ kind: 'backup', message: 'Backup snapshot (auto) would not restore: x' }).body)
      .toBe('It was saved anyway — a partly restorable backup beats none. Check it in Settings › Database › Backups.')
    expect(syncWarningCopy({ kind: 'backup', message: 'No backup was taken before importing the file — the backup could not be saved.' }).body)
      .toBe('Free up browser storage so the next one works, or delete old backups.')
  })
})

describe('StoragePill', () => {
  beforeEach(() => {
    useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
    useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
    useUIStore.setState(useUIStore.getInitialState(), true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('Local only: the popover leads to Settings → Database, at File storage', () => {
    useFileStorageStore.setState({ isSupported: true })
    render(<StoragePill />)
    fireEvent.click(screen.getByRole('button', { name: 'Storage: Local only' }))
    const popover = screen.getByRole('dialog', { name: 'Stored in this browser only' })
    expect(popover).toHaveTextContent('Connect a file')
    fireEvent.click(screen.getByRole('button', { name: 'Set up file storage…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'database', settingsPart: 'file-storage' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('without file sync support it offers Import / Export instead', () => {
    useFileStorageStore.setState({ isSupported: false })
    render(<StoragePill />)
    fireEvent.click(screen.getByRole('button', { name: 'Storage: Local only' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('can’t sync to a file')
    fireEvent.click(screen.getByRole('button', { name: 'Import / Export…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsSection: 'database', settingsPart: 'import-export' })
  })

  it('syncing: the file name, and when it last saved', () => {
    useFileStorageStore.setState({ isConnected: true, fileName: 'todo2.json', lastSavedAt: new Date(Date.now() - 120_000) })
    render(<StoragePill />)
    fireEvent.click(screen.getByRole('button', { name: 'Storage: todo2.json' }))
    const popover = screen.getByRole('dialog', { name: 'Syncing to todo2.json' })
    expect(popover).toHaveTextContent('Last saved 2m ago.')
    expect(screen.getByRole('button', { name: 'File storage settings…' })).toBeInTheDocument()
  })

  it('permission needed: the lock, Grant access asks the browser and closes the popover', () => {
    const reconnect = vi.fn().mockResolvedValue(undefined)
    useFileStorageStore.setState({ fileName: 'todo2.json', needsPermission: true, error: 'Permission denied', reconnect })
    render(<StoragePill />)
    const pill = screen.getByRole('button', { name: 'Storage: Permission needed' })
    expect(pill).toHaveAttribute('data-state', 'permission')
    expect(pill.querySelector('svg')).not.toBeNull()
    fireEvent.click(pill)
    const popover = screen.getByRole('dialog', { name: 'Permission needed' })
    expect(popover).toHaveTextContent('Sync to todo2.json is paused until your browser lets TODO2 open the file.')
    expect(popover).toHaveTextContent('Your browser refused access last time.')
    fireEvent.click(within(popover).getByRole('button', { name: 'Grant access' }))
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('paused: Retry (closes) and a confirmed Keep browser data… in place', () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const overwrite = vi.fn().mockResolvedValue(undefined)
    useFileStorageStore.setState({ fileName: 'todo2.json', paused: { reason: 'too-new', message: 'File sync paused — todo2.json was saved by a newer version of TODO2.' }, retry, overwriteFileWithBrowser: overwrite })
    render(<StoragePill />)
    const pill = screen.getByRole('button', { name: 'Storage: Sync paused' })
    fireEvent.click(pill)
    expect(screen.getByRole('dialog', { name: 'Sync paused' })).toHaveTextContent('todo2.json was saved by a newer version of TODO2.')

    fireEvent.click(screen.getByRole('button', { name: 'Keep browser data…' }))
    const confirm = screen.getByRole('dialog', { name: 'Overwrite the sync file?' })
    expect(confirm).toHaveTextContent('written by a newer version of TODO2')
    // In place: the popover stays open under its confirm.
    expect(screen.getByRole('dialog', { name: 'Sync paused' })).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(overwrite).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep browser data…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite file' }))
    expect(overwrite).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sync error is red; Dismiss drops back to the state underneath and closes the popover', () => {
    useFileStorageStore.setState({ isConnected: true, fileName: 'f.json', error: 'Failed to save to file' })
    render(<StoragePill />)
    const pill = screen.getByTestId('storage-pill')
    expect(pill).toHaveAttribute('data-state', 'error')
    expect(pill.className).toMatch(/danger/)
    fireEvent.click(pill)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(pill).toHaveAttribute('data-state', 'syncing')
    expect(screen.queryByRole('dialog')).toBeNull()
    // A new error shows again.
    act(() => useFileStorageStore.setState({ error: 'Failed to read file' }))
    expect(pill).toHaveAttribute('data-state', 'error')
  })

  it('two warnings: the count, one section each in order; dismissing one keeps the popover on the other', () => {
    useFileStorageStore.setState({ fileName: 'f.json', paused: conflictPause })
    useFileOpsStore.setState({ snapshotWarning: 'No backup was taken before importing the file — the backup could not be saved.' })
    render(<StoragePill />)
    const pill = screen.getByRole('button', { name: 'Storage: Sync paused, 2 warnings' })
    expect(pill).toHaveTextContent('Sync paused2')
    expect(pill.className).toMatch(/warning/)
    fireEvent.click(pill)
    const popover = screen.getByRole('dialog', { name: 'Sync paused' })
    expect([...popover.querySelectorAll('[data-warning]')].map((s) => s.getAttribute('data-warning'))).toEqual(['paused', 'backup'])

    fireEvent.click(within(popover).getByRole('button', { name: 'Open Backups…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'database', settingsPart: 'backups' })
    expect(screen.queryByRole('dialog', { name: 'Sync paused' })).toBeNull()

    fireEvent.click(pill)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Sync paused' })).getByRole('button', { name: 'Dismiss' }))
    expect(useFileOpsStore.getState().snapshotWarning).toBeNull()
    const after = screen.getByRole('dialog', { name: 'Sync paused' })
    expect(after.querySelectorAll('[data-warning]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Storage: Sync paused' })).toBeInTheDocument()
  })

  it('the footer leads to Settings on File storage', () => {
    useFileStorageStore.setState({ fileName: 'f.json', needsPermission: true })
    render(<StoragePill />)
    fireEvent.click(screen.getByTestId('storage-pill'))
    fireEvent.click(screen.getByRole('button', { name: 'File storage settings…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'database', settingsPart: 'file-storage' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('announces a warning that appears, once; not one already showing', () => {
    useFileStorageStore.setState({ isConnected: true, fileName: 'f.json', needsPermission: false })
    useFileOpsStore.setState({ snapshotWarning: 'Backup snapshot (auto) would not restore: x' })
    render(<StoragePill />)
    const region = screen.getByTestId('sync-announcer')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('')
    act(() => useFileStorageStore.setState({ paused: conflictPause }))
    expect(region).toHaveTextContent('Sync paused: This browser and f.json have different data. Choose which version to keep.')
  })
})

describe('removeLegacySyncKeys', () => {
  it('drops the old info-strip dismissal key', () => {
    localStorage.setItem('todo2-file-sync-banner-dismissed', '1')
    removeLegacySyncKeys()
    expect(localStorage.getItem('todo2-file-sync-banner-dismissed')).toBeNull()
  })
})
