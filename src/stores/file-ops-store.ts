import { create } from 'zustand'
import { backupRepository, type BackupSummary } from '../data/backup-repository'
import { auditData, cleanupIssues, type AuditReport } from '../data/audit'
import { restoreFromImportData } from '../data/restore'
import { prepareImportText } from '../data/import-pipeline'
import type { ImportData } from '../data/import-validation'
import { takeSafetySnapshot } from '../services/safety-snapshot'
import { backupScheduler } from '../services/backup-scheduler'
import { refreshAllStores } from './refresh-all'

export type { BackupSummary, AuditReport }

/**
 * An import that replaces the database. `cancelled`: the backup snapshot of
 * the current data failed and the user didn't continue — nothing changed.
 * `noBackup`: it ran without that snapshot (the user chose to continue).
 */
export type ImportOutcome =
  | { status: 'done'; noBackup: boolean }
  | { status: 'cancelled' }

/** A backup restore: an import's outcome, or the backup is missing / unreadable. */
export type RestoreOutcome = ImportOutcome | { status: 'error'; error: string }

interface FileOpsState {
  backups: BackupSummary[]
  auditReport: AuditReport | null

  loadBackups: () => Promise<void>
  /** Create Backup Now. Rejects when the backup can't be stored. */
  createBackup: () => Promise<void>
  deleteBackup: (id: number) => Promise<void>
  /** Returns the raw snapshot data for legacy-format detection before restore. */
  peekBackupData: (id: number) => Promise<string | null>
  /** Restores a backup, snapshotting the current data first. */
  restoreBackup: (id: number) => Promise<RestoreOutcome>

  runAudit: () => Promise<void>
  setAuditReport: (report: AuditReport | null) => void
  /** Cleans the issues in the current report; returns the cleaned count. */
  cleanupCurrentAudit: () => Promise<number>

  /** Replaces the database with imported data, snapshotting the current data first. */
  restoreFromImport: (data: ImportData) => Promise<ImportOutcome>

  /**
   * Set when a backup snapshot fails its import self-check (the snapshot is
   * still saved), or when a destructive operation ran without a backup.
   * Surfaced by `FileSyncBanner` until dismissed.
   */
  snapshotWarning: string | null
  dismissSnapshotWarning: () => void
}

export const useFileOpsStore = create<FileOpsState>((set, get) => ({
  backups: [],
  auditReport: null,
  snapshotWarning: null,

  dismissSnapshotWarning: () => set({ snapshotWarning: null }),

  loadBackups: async () => {
    set({ backups: await backupRepository.listSnapshots() })
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

  restoreBackup: async (id) => {
    // Read and check the backup before snapshotting: the snapshot's pruning
    // may delete the oldest backup — possibly this one.
    const backup = await backupRepository.getSnapshot(id)
    if (!backup) return { status: 'error', error: 'Backup not found' }
    const prepared = prepareImportText(backup.data)
    if (!prepared.ok) return { status: 'error', error: prepared.error }
    const snapshot = await takeSafetySnapshot('restoring the backup')
    if (snapshot === 'cancelled') return { status: 'cancelled' }
    await restoreFromImportData(prepared.data)
    await refreshAllStores()
    await get().loadBackups()
    return { status: 'done', noBackup: snapshot === 'without-backup' }
  },

  runAudit: async () => {
    set({ auditReport: await auditData() })
  },

  setAuditReport: (report) => set({ auditReport: report }),

  cleanupCurrentAudit: async () => {
    const report = get().auditReport
    if (!report) return 0
    const cleaned = await cleanupIssues(report.issues)
    await refreshAllStores()
    set({ auditReport: null })
    return cleaned
  },

  restoreFromImport: async (data) => {
    const snapshot = await takeSafetySnapshot('importing the file')
    if (snapshot === 'cancelled') return { status: 'cancelled' }
    await restoreFromImportData(data)
    await refreshAllStores()
    return { status: 'done', noBackup: snapshot === 'without-backup' }
  },
}))

// Backup warnings (see `backupRepository.reportSnapshotWarning`) land in the
// store so `FileSyncBanner` can surface them.
backupRepository.onSnapshotWarning((message) => useFileOpsStore.setState({ snapshotWarning: message }))
