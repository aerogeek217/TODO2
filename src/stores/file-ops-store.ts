import { create } from 'zustand'
import { backupRepository, type BackupSummary } from '../data/backup-repository'
import { auditData, type AuditReport } from '../data/audit'
import { backupScheduler } from '../data/backup-scheduler'

export type { BackupSummary, AuditReport }

/**
 * Settings' backups and data-integrity state: the backup list, the audit
 * report, the Backup warning. The data replaces they lead to (restore a
 * backup, clean up the audit's issues, import) are `services/replace-data`'s.
 */
interface FileOpsState {
  backups: BackupSummary[]
  auditReport: AuditReport | null

  loadBackups: () => Promise<void>
  /** Create Backup Now. Rejects when the backup can't be stored. */
  createBackup: () => Promise<void>
  deleteBackup: (id: number) => Promise<void>
  /** Returns the raw snapshot data for legacy-format detection before restore. */
  peekBackupData: (id: number) => Promise<string | null>

  runAudit: () => Promise<void>
  setAuditReport: (report: AuditReport | null) => void

  /**
   * Set when a backup snapshot fails its import self-check (the snapshot is
   * still saved), or when a destructive operation ran without a backup.
   * Surfaced by the storage pill (Backup warning) until dismissed.
   */
  snapshotWarning: string | null
  dismissSnapshotWarning: () => void
}

export const useFileOpsStore = create<FileOpsState>((set, get) => {
  /** The latest `loadBackups` call: an older read that resolves later is dropped. */
  let latestBackupsLoad = 0
  return {
  backups: [],
  auditReport: null,
  snapshotWarning: null,

  dismissSnapshotWarning: () => set({ snapshotWarning: null }),

  loadBackups: async () => {
    const run = ++latestBackupsLoad
    const backups = await backupRepository.listSnapshots()
    if (run === latestBackupsLoad) set({ backups })
  },

  createBackup: async () => {
    await backupScheduler.createManualBackup()
    await get().loadBackups()
  },

  deleteBackup: async (id) => {
    await backupRepository.deleteSnapshot(id)
    await get().loadBackups()
  },

  peekBackupData: async (id) => {
    const backup = await backupRepository.getSnapshot(id)
    return backup?.data ?? null
  },

  runAudit: async () => {
    set({ auditReport: await auditData() })
  },

  setAuditReport: (report) => set({ auditReport: report }),
  }
})

// Backup warnings (see `backupRepository.reportSnapshotWarning`) land in the
// store so the storage pill can surface them.
backupRepository.onSnapshotWarning((message) => useFileOpsStore.setState({ snapshotWarning: message }))
