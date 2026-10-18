import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { StoragePill } from '../../../components/layout/StoragePill'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import { useFileStorageStore } from '../../../services/file-storage-store'
import { backupRepository } from '../../../data/backup-repository'
import { db } from '../../../data/database'
import { makeTodo } from '../../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useFileOpsStore.setState({ snapshotWarning: null })
  useFileStorageStore.setState({ error: null, needsPermission: false, isConnected: true, fileName: 'todo2.json' })
})

afterEach(cleanup)

describe('storage pill — backup snapshot self-check warning', () => {
  it('a snapshot that would not restore turns the pill to Backup warning, until dismissed', async () => {
    await db.todos.add(makeTodo({ id: 1, title: '' }))

    render(<StoragePill />)
    expect(screen.getByTestId('storage-pill')).toHaveAttribute('data-state', 'syncing')
    await act(async () => {
      await backupRepository.createSnapshot('auto')
    })

    const pill = screen.getByRole('button', { name: 'Storage: Backup warning' })
    expect(pill).toHaveAttribute('data-state', 'backup')
    // Announced once, politely.
    expect(screen.getByTestId('sync-announcer')).toHaveTextContent(/^Backup warning: Backup snapshot \(auto\) would not restore/)
    fireEvent.click(pill)
    const popover = screen.getByRole('dialog', { name: 'Backup warning' })
    expect(popover).toHaveTextContent('Backup snapshot (auto) would not restore')
    expect(popover).toHaveTextContent('bad field "title"')
    expect(popover).toHaveTextContent('It was saved anyway — a partly restorable backup beats none.')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useFileOpsStore.getState().snapshotWarning).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('storage-pill')).toHaveAttribute('data-state', 'syncing')
  })
})
