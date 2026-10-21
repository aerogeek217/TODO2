import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { backupRepository } from '../../data/backup-repository'
import { useFileOpsStore } from '../../stores/file-ops-store'
import { resetDb } from '../helpers'

beforeEach(async () => {
  await resetDb()
  useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadBackups', () => {
  it('a read that resolves after a later one does not put back the older list', async () => {
    const older: Array<(rows: never[]) => void> = []
    const list = vi.spyOn(backupRepository, 'listSnapshots')
    list.mockImplementationOnce(() => new Promise((resolve) => { older.push(resolve) }))
    const first = useFileOpsStore.getState().loadBackups()
    await backupRepository.createSnapshot('manual')
    await useFileOpsStore.getState().loadBackups()
    expect(useFileOpsStore.getState().backups).toHaveLength(1)
    older[0]!([])
    await first
    expect(useFileOpsStore.getState().backups).toHaveLength(1)
  })
})
