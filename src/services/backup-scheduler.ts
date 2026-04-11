import { backupRepository } from '../data/backup-repository'

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_BACKUPS = 10

class BackupScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private autoRunning = false
  private destructiveRunning = false

  start(intervalMs = DEFAULT_INTERVAL_MS) {
    if (this.timer) return
    this.timer = setInterval(() => this.autoSnapshot(), intervalMs)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async snapshotBeforeDestructive(): Promise<void> {
    if (this.destructiveRunning) return
    this.destructiveRunning = true
    try {
      await backupRepository.createSnapshot('pre-destructive')
      await backupRepository.pruneSnapshots(MAX_BACKUPS)
    } finally {
      this.destructiveRunning = false
    }
  }

  private async autoSnapshot(): Promise<void> {
    if (this.autoRunning) return
    this.autoRunning = true
    try {
      await backupRepository.createSnapshot('auto')
      await backupRepository.pruneSnapshots(MAX_BACKUPS)
    } finally {
      this.autoRunning = false
    }
  }
}

export const backupScheduler = new BackupScheduler()
