import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FileSyncBanner } from '../../../components/layout/FileSyncBanner'
import { useFileOpsStore } from '../../../stores/file-ops-store'
import { useFileStorageStore } from '../../../stores/file-storage-store'
import { backupRepository } from '../../../data/backup-repository'
import { db } from '../../../data/database'
import { makeTodo } from '../../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useFileOpsStore.setState({ snapshotWarning: null })
  useFileStorageStore.setState({ error: null, needsPermission: false })
})

describe('FileSyncBanner — backup snapshot self-check warning', () => {
  it('surfaces a snapshot that would not restore, until dismissed', async () => {
    const canvasId = await db.canvases.add({ name: 'Main', sortOrder: 0, createdAt: new Date() }) as number
    await db.todos.add(makeTodo({ id: 1, canvasId, title: '' }))

    render(<FileSyncBanner />)
    await act(async () => {
      await backupRepository.createSnapshot('auto')
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Backup snapshot (auto) would not restore')
    expect(alert).toHaveTextContent('bad field "title"')

    fireEvent.click(screen.getByTitle('Dismiss'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useFileOpsStore.getState().snapshotWarning).toBeNull()
  })
})
