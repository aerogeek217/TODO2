import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../data/backup-repository', () => ({
  backupRepository: {
    createSnapshot: vi.fn().mockResolvedValue(1),
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
  })

  describe('concurrent guard', () => {
    it('snapshotBeforeDestructive_whileRunning_returnsWithoutCallingRepo', async () => {
      // Arrange: make createSnapshot hang so running stays true during second call
      let resolveFirst!: () => void
      mockCreateSnapshot.mockReturnValueOnce(
        new Promise<number>(resolve => { resolveFirst = () => resolve(1) })
      )

      // Act: start first call (does not await), then immediately call again
      const first = backupScheduler.snapshotBeforeDestructive()
      const second = backupScheduler.snapshotBeforeDestructive()

      // Second call should return immediately since running=true
      await second

      // Assert: createSnapshot was called only once (by the first invocation)
      expect(mockCreateSnapshot).toHaveBeenCalledTimes(1)

      // Cleanup: resolve the first call so it doesn't leak
      resolveFirst()
      await first
    })
  })
})
