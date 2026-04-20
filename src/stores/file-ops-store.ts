import { create } from 'zustand'
import { backupRepository, type BackupSummary } from '../data/backup-repository'
import { auditData, cleanupIssues, type AuditReport } from '../data/audit'
import { restoreFromImportData } from '../data/restore'
import type { ImportData } from '../data/import-validation'
import { backupScheduler } from '../services/backup-scheduler'
import { refreshAllStores } from './file-storage-store'

export type { BackupSummary, AuditReport }

interface FileOpsState {
  backups: BackupSummary[]
  auditReport: AuditReport | null

  loadBackups: () => Promise<void>
  createBackup: (trigger: 'manual') => Promise<void>
  deleteBackup: (id: number) => Promise<void>
  /** Returns the raw snapshot data for legacy-format detection before restore. */
  peekBackupData: (id: number) => Promise<string | null>
  restoreBackup: (id: number) => Promise<{ ok: true } | { ok: false; error: string }>

  runAudit: () => Promise<void>
  setAuditReport: (report: AuditReport | null) => void
  /** Cleans the issues in the current report; returns the cleaned count. */
  cleanupCurrentAudit: () => Promise<number>

  restoreFromImport: (data: ImportData) => Promise<void>
}

export const useFileOpsStore = create<FileOpsState>((set, get) => ({
  backups: [],
  auditReport: null,

  loadBackups: async () => {
    set({ backups: await backupRepository.listSnapshots() })
  },

  createBackup: async (trigger) => {
    await backupRepository.createSnapshot(trigger)
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
    const result = await backupRepository.restoreSnapshot(id)
    if (result.ok) await refreshAllStores()
    return result
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
    await backupScheduler.snapshotBeforeDestructive().catch(() => {})
    await restoreFromImportData(data)
    await refreshAllStores()
  },
}))
