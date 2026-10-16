import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../data/backup-repository', () => ({
  backupRepository: {
    createSnapshot: vi.fn().mockResolvedValue(1),
    createSnapshotFromJson: vi.fn().mockResolvedValue(2),
    pruneSnapshots: vi.fn().mockResolvedValue(0),
    newestSnapshotAt: vi.fn().mockResolvedValue(null),
    reportSnapshotWarning: vi.fn(),
  },
}))

import { AUTO_BACKUP_FAILED_WARNING, BACKUPS_KEPT, backupScheduler } from '../../data/backup-scheduler'
import { backupRepository } from '../../data/backup-repository'

const mockCreateSnapshot = vi.mocked(backupRepository.createSnapshot)
const mockCreateSnapshotFromJson = vi.mocked(backupRepository.createSnapshotFromJson)
const mockPruneSnapshots = vi.mocked(backupRepository.pruneSnapshots)
const mockNewestSnapshotAt = vi.mocked(backupRepository.newestSnapshotAt)
const mockReportWarning = vi.mocked(backupRepository.reportSnapshotWarning)

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T09:00:00.000Z'))
  vi.resetAllMocks()
  mockCreateSnapshot.mockResolvedValue(1)
  mockCreateSnapshotFromJson.mockResolvedValue(2)
  mockPruneSnapshots.mockResolvedValue(0)
  mockNewestSnapshotAt.mockResolvedValue(null)
})

afterEach(() => {
  backupScheduler.stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('BackupScheduler', () => {
  describe('snapshotFileBeforeOverwrite', () => {
    it('stores the raw text as a sync-file backup, prunes only those, and tolerates a prune failure', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockPruneSnapshots.mockRejectedValueOnce(new Error('prune'))
      await expect(backupScheduler.snapshotFileBeforeOverwrite('{raw')).resolves.toBeUndefined()
      expect(mockCreateSnapshotFromJson).toHaveBeenCalledWith('{raw', 'sync-file')
      expect(mockPruneSnapshots).toHaveBeenCalledWith('sync-file', BACKUPS_KEPT['sync-file'])
    })

    it('rejects when the backup itself cannot be stored', async () => {
      mockCreateSnapshotFromJson.mockRejectedValueOnce(new Error('quota'))
      await expect(backupScheduler.snapshotFileBeforeOverwrite('{raw')).rejects.toThrow('quota')
    })
  })

  describe('start / stop', () => {
    it('start_called_setsUpIntervalTimer', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      backupScheduler.start()
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    })

    it('start_calledTwice_doesNotCreateSecondTimer', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      backupScheduler.start()
      backupScheduler.start()
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    })

    it('stop_afterStart_clearsTimer', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      backupScheduler.start()
      backupScheduler.stop()
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
    })

    it('stop_afterStop_allowsRestartWithNewTimer', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      backupScheduler.start()
      backupScheduler.stop()
      backupScheduler.start()
      expect(setIntervalSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('auto snapshot', () => {
    it('takes one at start when there is none yet, and prunes only auto ones', async () => {
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
      expect(mockCreateSnapshot).toHaveBeenCalledWith('auto')
      expect(mockPruneSnapshots).toHaveBeenCalledTimes(1)
      expect(mockPruneSnapshots).toHaveBeenCalledWith('auto', BACKUPS_KEPT.auto)
    })

    it('takes one at start when the last is a day old', async () => {
      mockNewestSnapshotAt.mockResolvedValue(new Date(Date.now() - DAY))
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
    })

    it('skips the start one when the last is recent, then takes it once due (checked hourly)', async () => {
      mockNewestSnapshotAt.mockResolvedValue(new Date(Date.now() - 20 * HOUR))
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(3 * HOUR)
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(HOUR)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
      // The next one a day after that.
      await vi.advanceTimersByTimeAsync(DAY - HOUR)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(HOUR)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(2)
      // The last backup's time is read once, then tracked.
      expect(mockNewestSnapshotAt).toHaveBeenCalledTimes(1)
    })

    it('a short interval is checked at that interval', async () => {
      backupScheduler.start(1000)
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(3)
    })

    it('skips the hourly check while the tab is hidden', async () => {
      mockNewestSnapshotAt.mockResolvedValue(new Date(Date.now() - 23 * HOUR))
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(2 * HOUR)
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
      visibility.mockReturnValue('visible')
      await vi.advanceTimersByTimeAsync(HOUR)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
    })

    it('a failure (e.g. quota) never rejects: it warns once, is retried at each check, and a success re-arms the warning', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      try {
        mockCreateSnapshot.mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
        backupScheduler.start()
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(mockCreateSnapshot).toHaveBeenCalledTimes(3)
        expect(mockReportWarning).toHaveBeenCalledTimes(1)
        expect(mockReportWarning).toHaveBeenCalledWith(AUTO_BACKUP_FAILED_WARNING)

        mockCreateSnapshot.mockResolvedValue(1)
        await vi.advanceTimersByTimeAsync(HOUR)
        expect(mockCreateSnapshot).toHaveBeenCalledTimes(4)
        mockCreateSnapshot.mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
        await vi.advanceTimersByTimeAsync(DAY)
        expect(mockReportWarning).toHaveBeenCalledTimes(2)
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('a failure reading the last backup time is caught and retried', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockNewestSnapshotAt.mockRejectedValueOnce(new Error('idb'))
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockReportWarning).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(HOUR)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
    })

    it('a prune failure after a stored auto backup is not a failure', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockPruneSnapshots.mockRejectedValueOnce(new Error('prune'))
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
      expect(mockReportWarning).not.toHaveBeenCalled()
    })
  })

  describe('createManualBackup', () => {
    it('stores a manual backup and prunes only manual ones', async () => {
      await backupScheduler.createManualBackup()
      expect(mockCreateSnapshot).toHaveBeenCalledWith('manual')
      expect(mockPruneSnapshots).toHaveBeenCalledTimes(1)
      expect(mockPruneSnapshots).toHaveBeenCalledWith('manual', BACKUPS_KEPT.manual)
    })

    it('rejects when it cannot be stored', async () => {
      mockCreateSnapshot.mockRejectedValueOnce(new Error('quota'))
      await expect(backupScheduler.createManualBackup()).rejects.toThrow('quota')
    })
  })

  describe('snapshotBeforeDestructive', () => {
    it('stores a pre-destructive snapshot and prunes only those', async () => {
      await backupScheduler.snapshotBeforeDestructive()
      expect(mockCreateSnapshot).toHaveBeenCalledWith('pre-destructive')
      expect(mockPruneSnapshots).toHaveBeenCalledTimes(1)
      expect(mockPruneSnapshots).toHaveBeenCalledWith('pre-destructive', BACKUPS_KEPT['pre-destructive'])
    })

    it('creates the snapshot before pruning', async () => {
      const callOrder: string[] = []
      mockCreateSnapshot.mockImplementation(async () => { callOrder.push('create'); return 1 })
      mockPruneSnapshots.mockImplementation(async () => { callOrder.push('prune'); return 0 })
      await backupScheduler.snapshotBeforeDestructive()
      expect(callOrder).toEqual(['create', 'prune'])
    })

    it('rejects when the snapshot cannot be stored', async () => {
      mockCreateSnapshot.mockRejectedValueOnce(new Error('quota'))
      await expect(backupScheduler.snapshotBeforeDestructive()).rejects.toThrow('quota')
    })

    it('a prune failure after a stored snapshot is not a failure', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockPruneSnapshots.mockRejectedValueOnce(new Error('prune'))
      await expect(backupScheduler.snapshotBeforeDestructive()).resolves.toBeUndefined()
    })
  })

  describe('concurrent callers', () => {
    it('a second caller waits for the snapshot in flight instead of starting another', async () => {
      let resolveFirst!: () => void
      mockCreateSnapshot.mockReturnValueOnce(
        new Promise<number>(resolve => { resolveFirst = () => resolve(1) })
      )

      const first = backupScheduler.snapshotBeforeDestructive()
      const second = backupScheduler.snapshotBeforeDestructive()
      let secondDone = false
      void second.then(() => { secondDone = true })
      await Promise.resolve()
      expect(secondDone).toBe(false)

      resolveFirst()
      await Promise.all([first, second])
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
    })

    it('shares a failure with every caller waiting on it', async () => {
      let rejectFirst!: (err: Error) => void
      mockCreateSnapshot.mockReturnValueOnce(
        new Promise<number>((_, reject) => { rejectFirst = reject })
      )

      const first = backupScheduler.snapshotBeforeDestructive()
      const second = backupScheduler.snapshotBeforeDestructive()
      rejectFirst(new Error('quota'))

      await expect(first).rejects.toThrow('quota')
      await expect(second).rejects.toThrow('quota')
    })

    it('starts a fresh snapshot once the previous one settled', async () => {
      mockCreateSnapshot.mockRejectedValueOnce(new Error('quota'))
      await expect(backupScheduler.snapshotBeforeDestructive()).rejects.toThrow('quota')
      await backupScheduler.snapshotBeforeDestructive()
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(2)
    })
  })

  describe('reset', () => {
    it('stops the timer and drops a snapshot in flight, so the next caller starts its own', async () => {
      let finishFirst!: () => void
      mockCreateSnapshot.mockImplementationOnce(() => new Promise((r) => { finishFirst = () => r(1) }))
      const first = backupScheduler.snapshotBeforeDestructive()
      backupScheduler.start()

      backupScheduler.reset()
      const intervalSpy = vi.spyOn(globalThis, 'setInterval')
      await backupScheduler.snapshotBeforeDestructive()
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(3) // first, the start's auto one, the new one
      // The dropped snapshot settling later doesn't clear the next one's slot.
      finishFirst()
      await first
      backupScheduler.start()
      expect(intervalSpy).toHaveBeenCalledTimes(1)
    })

    it('reads the last automatic backup time again after a reset', async () => {
      mockNewestSnapshotAt.mockResolvedValue(new Date(Date.now() - HOUR))
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      backupScheduler.reset()
      backupScheduler.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockNewestSnapshotAt).toHaveBeenCalledTimes(2)
      expect(mockCreateSnapshot).not.toHaveBeenCalled()
    })
  })
})
