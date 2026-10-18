import { backupRepository } from './backup-repository'
import type { BackupTrigger } from '../models'
import { MS_PER_DAY } from '../utils/date'
import { registerModuleReset } from '../utils/module-reset'

const DEFAULT_INTERVAL_MS = MS_PER_DAY
/** How often a running tab checks whether the automatic backup is due. */
const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * How many backups of each kind are kept. Each kind is pruned on its own, so
 * automatic and pre-destructive snapshots never push out a manual backup or
 * the only copy of an old sync file.
 */
export const BACKUPS_KEPT: Readonly<Record<BackupTrigger, number>> = {
  auto: 10,
  'pre-destructive': 10,
  manual: 10,
  // The sync file's text can be as large as the import cap (50 MB).
  'sync-file': 5,
  // A file at an older schema version: the only copy of what that build
  // wrote, kept until the user deletes it (one per text — see below).
  'sync-file-original': Infinity,
}

/** Shown when an automatic backup can't be stored (e.g. browser storage is full). */
export const AUTO_BACKUP_FAILED_WARNING =
  'The automatic backup could not be saved — browser storage may be full.'

async function prune(trigger: BackupTrigger): Promise<void> {
  // Pruning is housekeeping; the new backup already exists, so don't fail on it.
  await backupRepository.pruneSnapshots(trigger, BACKUPS_KEPT[trigger]).catch((err) => {
    console.warn(`[backup] pruning ${trigger} backups failed`, err)
  })
}

class BackupScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private intervalMs = DEFAULT_INTERVAL_MS
  /** The automatic snapshot in flight (startup check and ticks share it). */
  private autoRun: Promise<void> | null = null
  /** When the newest automatic backup was taken; `undefined` = not read yet. */
  private lastAutoAt: number | null | undefined = undefined
  /** An automatic backup failed and the warning was raised; cleared on success. */
  private autoFailureReported = false
  /** The pre-destructive snapshot in flight; concurrent callers share it. */
  private destructiveSnapshot: Promise<void> | null = null

  /**
   * Takes an automatic backup now if the last one is `intervalMs` old (or
   * there is none — so a short session still gets one), then checks again
   * every hour while the tab is visible.
   */
  start(intervalMs = DEFAULT_INTERVAL_MS) {
    if (this.timer) return
    this.intervalMs = intervalMs
    void this.autoSnapshotIfDue()
    this.timer = setInterval(() => {
      // Don't burn IDB cycles on a backgrounded tab; the next foreground tick
      // will catch up.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void this.autoSnapshotIfDue()
    }, Math.min(intervalMs, CHECK_EVERY_MS))
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Start over on the next start: the backups may have changed meanwhile.
    this.lastAutoAt = undefined
    this.autoFailureReported = false
  }

  /**
   * Back to the state at module load, for tests that share one module
   * instance: stopped, default interval, nothing in flight. A snapshot
   * already running finishes on its own; later callers don't wait for it.
   */
  reset() {
    this.stop()
    this.intervalMs = DEFAULT_INTERVAL_MS
    this.autoRun = null
    this.destructiveSnapshot = null
  }

  /**
   * Snapshots the whole database before a destructive operation. Rejects when
   * the snapshot can't be stored; `services/safety-snapshot` then asks the
   * user whether to go ahead. A caller arriving while a snapshot is in flight
   * waits for that one (it holds the data from before either operation) and
   * shares its outcome.
   */
  snapshotBeforeDestructive(): Promise<void> {
    if (this.destructiveSnapshot) return this.destructiveSnapshot
    const run = (async () => {
      await backupRepository.createSnapshot('pre-destructive')
      await prune('pre-destructive')
    })().finally(() => {
      if (this.destructiveSnapshot === run) this.destructiveSnapshot = null
    })
    this.destructiveSnapshot = run
    return run
  }

  /**
   * Saves a sync file's current text as a backup before the file is
   * overwritten or rewritten (Settings → Backups can restore it). The text
   * of a file at an older schema version (`olderVersion`) goes outside the
   * newest-5 pool, so later overwrites never push it out; the same text
   * again (a retried upgrade) is not stored twice.
   */
  async snapshotFileBeforeOverwrite(fileText: string, opts: { olderVersion?: boolean } = {}): Promise<void> {
    if (opts.olderVersion) {
      if (await backupRepository.newestSnapshotDataIs('sync-file-original', fileText)) return
      // Throws if the backup can't be stored — callers must not overwrite then.
      await backupRepository.createSnapshotFromJson(fileText, 'sync-file-original')
      return
    }
    await backupRepository.createSnapshotFromJson(fileText, 'sync-file')
    await prune('sync-file')
  }

  /** Settings → Backups → Create Backup Now. Rejects when it can't be stored. */
  async createManualBackup(): Promise<void> {
    await backupRepository.createSnapshot('manual')
    await prune('manual')
  }

  private autoSnapshotIfDue(): Promise<void> {
    if (this.autoRun) return this.autoRun
    const run: Promise<void> = this.runAutoSnapshot().finally(() => {
      if (this.autoRun === run) this.autoRun = null
    })
    this.autoRun = run
    return run
  }

  /** Never rejects: a failure is logged and raised once as a backup warning. */
  private async runAutoSnapshot(): Promise<void> {
    try {
      if (this.lastAutoAt === undefined) {
        this.lastAutoAt = (await backupRepository.newestSnapshotAt('auto'))?.getTime() ?? null
      }
      if (this.lastAutoAt !== null && Date.now() - this.lastAutoAt < this.intervalMs) return
      await backupRepository.createSnapshot('auto')
      this.lastAutoAt = Date.now()
      this.autoFailureReported = false
      await prune('auto')
    } catch (err) {
      console.warn('[backup] automatic backup failed', err)
      // Retried at the next check; warn once until one succeeds.
      if (!this.autoFailureReported) {
        this.autoFailureReported = true
        backupRepository.reportSnapshotWarning(AUTO_BACKUP_FAILED_WARNING)
      }
    }
  }
}

export const backupScheduler = new BackupScheduler()
registerModuleReset(() => backupScheduler.reset())

// Stop the interval on Vite HMR dispose so a hot-reloaded module doesn't leak
// a second timer per edit. No-op in production builds.
if (import.meta.hot) {
  import.meta.hot.dispose(() => backupScheduler.stop())
}
