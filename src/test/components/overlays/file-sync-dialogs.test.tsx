import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SyncConflictDialog } from '../../../components/overlays/SyncConflictDialog'
import { FileUpgradeDialog } from '../../../components/overlays/FileUpgradeDialog'
import { FileSyncBanner } from '../../../components/layout/FileSyncBanner'
import { useFileStorageStore } from '../../../services/file-storage-store'
import type { SyncConflictInfo } from '../../../services/file-storage'

afterEach(() => cleanup())

const info: SyncConflictInfo = {
  fileName: 'todo2-data.json',
  reason: 'browser-changes',
  browser: { taskCount: 12, schemaVersion: 49, unsyncedSince: '2026-10-02T09:00:00.000Z' },
  file: {
    taskCount: 10, schemaVersion: 48, savedAt: '2026-10-01T10:00:00.000Z',
    lastModified: '2026-10-01T10:00:00.000Z', changedSinceLastSync: true,
  },
}

describe('SyncConflictDialog', () => {
  it('shows both sides and maps buttons to choices', () => {
    const onChoose = vi.fn()
    render(<SyncConflictDialog info={info} onChoose={onChoose} />)

    const sides = screen.getByTestId('sync-conflict-sides')
    expect(sides).toHaveTextContent('12 tasks')
    expect(sides).toHaveTextContent('10 tasks')
    expect(sides).toHaveTextContent('Schema v48 (older format)')
    expect(screen.getByRole('dialog')).toHaveTextContent('the file was also changed elsewhere')
    expect(screen.getByRole('dialog')).toHaveTextContent('Nothing has changed yet')

    fireEvent.click(screen.getByRole('button', { name: 'Use file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use browser data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel (pause sync)' }))
    expect(onChoose.mock.calls.map((c) => c[0])).toEqual(['file', 'browser', 'cancel'])
  })

  it('Escape cancels (stays paused)', () => {
    const onChoose = vi.fn()
    render(<SyncConflictDialog info={info} onChoose={onChoose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onChoose).toHaveBeenCalledWith('cancel')
  })
})

describe('FileUpgradeDialog', () => {
  it('confirms or cancels', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<FileUpgradeDialog info={{ fileName: 'f.json', fromVersion: 49, toVersion: 50 }} onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('schema v49')
    expect(screen.getByRole('dialog')).toHaveTextContent('A copy of the file as it is now is saved first')
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel (pause sync)' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('FileSyncBanner — paused', () => {
  const retry = vi.fn().mockResolvedValue(undefined)
  const overwrite = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    retry.mockClear()
    overwrite.mockClear()
    useFileStorageStore.setState({
      paused: { reason: 'too-new', message: 'File sync paused — newer version' },
      fileName: 'todo2-data.json',
      needsPermission: false,
      error: null,
      retry,
      overwriteFileWithBrowser: overwrite,
    })
  })

  it('shows the reason with Retry and a confirmed overwrite', () => {
    render(<FileSyncBanner />)
    expect(screen.getByTestId('file-sync-paused')).toHaveTextContent('File sync paused — newer version')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Keep browser data…' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('written by a newer version of TODO2')
    expect(overwrite).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite file' }))
    expect(overwrite).toHaveBeenCalledTimes(1)
  })

  it('cancelling the overwrite confirmation changes nothing', () => {
    render(<FileSyncBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep browser data…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(overwrite).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
