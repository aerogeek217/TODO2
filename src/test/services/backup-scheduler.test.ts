import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../data/backup-repository', () => ({
  backupRepository: {
    createSnapshot: vi.fn().mockResolvedValue(1),
    createSnapshotFromJson: vi.fn().mockResolvedValue(2),
    pruneSnapshots: vi.fn().mockResolvedValue(0),
  },
}))

import { backupScheduler } from '../../services/backup-scheduler'
import { backupRepository } from '../../data/backup-repository'

const mockCreateSnapshot = vi.mocked(backupRepository.createSnapshot)
const mockPruneSnapshots = vi.mocked(backupRepository.pruneSnapshots)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  backupScheduler.stop()
  vi.useRealTimers()
})

describe('BackupScheduler', () => {
  describe('snapshotFileBeforeOverwrite', () => {
    it('stores the raw text and tolerates a prune failure', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockPruneSnapshots.mockRejectedValueOnce(new Error('prune'))
      await expect(backupScheduler.snapshotFileBeforeOverwrite('{raw')).resolves.toBeUndefined()
      expect(vi.mocked(backupRepository.createSnapshotFromJson)).toHaveBeenCalledWith('{raw', 'pre-destructive')
    })

    it('rejects when the backup itself cannot be stored', async () => {
      vi.mocked(backupRepository.createSnapshotFromJson).mockRejectedValueOnce(new Error('quota'))
      await expect(backupScheduler.snapshotFileBeforeOverwrite('{raw')).rejects.toThrow('quota')
    })
  })

  describe('start', () => {
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
  })

  describe('stop', () => {
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
    it('autoSnapshot_afterIntervalElapses_firesOnce', async () => {
      const INTERVAL_MS = 1000

      backupScheduler.start(INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)

      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)
    })

    it('autoSnapshot_afterIntervalElapses_callsCreateSnapshotWithAutoTrigger', async () => {
      const INTERVAL_MS = 1000

      backupScheduler.start(INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)

      expect(mockCreateSnapshot).toHaveBeenCalledWith('auto')
    })

    it('autoSnapshot_afterIntervalElapses_callsPruneSnapshotsWith10', async () => {
      const INTERVAL_MS = 1000

      backupScheduler.start(INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)

      expect(mockPruneSnapshots).toHaveBeenCalledWith(10)
    })

    it('autoSnapshot_afterTwoIntervals_firesCreateSnapshotTwice', async () => {
      const INTERVAL_MS = 1000

      backupScheduler.start(INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)

      expect(mockCreateSnapshot).toHaveBeenCalledTimes(2)
    })
  })

  describe('snapshotBeforeDestructive', () => {
    it('snapshotBeforeDestructive_called_callsCreateSnapshotWithPreDestructiveTrigger', async () => {
      await backupScheduler.snapshotBeforeDestructive()

      expect(mockCreateSnapshot).toHaveBeenCalledWith('pre-destructive')
    })

    it('snapshotBeforeDestructive_called_callsPruneSnapshotsWith10', async () => {
      await backupScheduler.snapshotBeforeDestructive()

      expect(mockPruneSnapshots).toHaveBeenCalledWith(10)
    })

    it('snapshotBeforeDestructive_called_callsCreateSnapshotBeforePruneSnapshots', async () => {
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
})
